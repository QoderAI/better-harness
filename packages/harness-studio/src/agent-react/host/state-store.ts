import type { ArtifactStateDeclaration } from "../contracts/index.js";
import { cloneAndFreezePlainData } from "./data-ownership.js";
import type { ObservationBridge } from "./observation-bridge.js";

export type StateValidator = (value: unknown) => true | string;

export interface StateSchema {
  readonly name: string;
  readonly version: number;
  readonly initial: unknown;
  readonly validate: StateValidator;
  /** Upgrades a value written under an older version of the same schema name. */
  readonly migrate?: (value: unknown, fromVersion: number) => unknown;
}

export interface ArtifactStateStore {
  /** Frozen, structurally shared view of every declared path. */
  snapshot(): Readonly<Record<string, unknown>>;
  get(path: string): unknown;
  set(path: string, value: unknown): { readonly ok: true } | { readonly ok: false; readonly reason: string };
  subscribe(path: string, listener: () => void): () => void;
  migrate(path: string, schema: StateSchema): { readonly ok: true } | { readonly ok: false; readonly reason: string };
  declaredSchema(path: string): StateSchema | undefined;
}

export interface ArtifactStateStoreOptions {
  readonly declarations: readonly ArtifactStateDeclaration[];
  readonly schemas: readonly StateSchema[];
  readonly observations?: ObservationBridge;
}

/**
 * Persistent Artifact state, owned by the Host.
 *
 * State cannot live in the artifact bundle: committing a new build replaces the
 * frame, and anything held in a component would vanish with it. Keeping it here is
 * also what lets a staging frame read a frozen copy while the current frame keeps
 * writing.
 */
export function createArtifactStateStore(options: ArtifactStateStoreOptions): ArtifactStateStore {
  const schemasByName = new Map(options.schemas.map((schema) => [`${schema.name}@${schema.version}`, schema]));
  const bound = new Map<string, StateSchema>();
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();

  for (const declaration of options.declarations) {
    const schema = schemasByName.get(`${declaration.schema}@${declaration.version}`);
    if (schema === undefined) {
      throw new Error(
        `Artifact declares state '${declaration.path}' as '${declaration.schema}@${declaration.version}', which the Host does not provide.`,
      );
    }
    bound.set(declaration.path, schema);
    values.set(declaration.path, cloneAndFreezePlainData(schema.initial, "Artifact state"));
  }

  const notify = (path: string): void => {
    for (const listener of listeners.get(path) ?? []) listener();
  };

  return {
    snapshot() {
      return Object.freeze(Object.fromEntries(values));
    },
    get(path) {
      return values.get(path);
    },
    set(path, value) {
      const schema = bound.get(path);
      if (schema === undefined) {
        const reason = `State path '${path}' is not declared by this Artifact View.`;
        options.observations?.record({ kind: "stateValidationFailed", detail: { path, reason } });
        return { ok: false, reason };
      }
      const verdict = schema.validate(value);
      if (verdict !== true) {
        // The previous value stays in place: accepting a rejected write "for now"
        // would let an invalid value reach the next reader that trusts the schema.
        options.observations?.record({
          kind: "stateValidationFailed",
          detail: { path, schema: schema.name, version: schema.version, reason: verdict },
        });
        return { ok: false, reason: verdict };
      }
      let owned: unknown;
      try {
        owned = cloneAndFreezePlainData(value, "Artifact state");
      } catch (error) {
        const reason = stateOwnershipFailure(error);
        options.observations?.record({
          kind: "stateValidationFailed",
          detail: { path, schema: schema.name, version: schema.version, reason },
        });
        return { ok: false, reason };
      }
      values.set(path, owned);
      notify(path);
      return { ok: true };
    },
    subscribe(path, listener) {
      const set = listeners.get(path) ?? new Set();
      set.add(listener);
      listeners.set(path, set);
      return () => {
        set.delete(listener);
      };
    },
    migrate(path, schema) {
      const current = bound.get(path);
      if (current === undefined) return { ok: false, reason: `State path '${path}' is not declared.` };
      if (current.name !== schema.name) {
        return { ok: false, reason: `State path '${path}' cannot change schema from '${current.name}' to '${schema.name}'.` };
      }
      if (schema.version <= current.version) {
        return { ok: false, reason: `State path '${path}' is already at version ${current.version}.` };
      }
      const migrated = schema.migrate === undefined
        ? schema.initial
        : schema.migrate(values.get(path), current.version);
      const verdict = schema.validate(migrated);
      if (verdict !== true) {
        options.observations?.record({
          kind: "stateValidationFailed",
          detail: { path, schema: schema.name, version: schema.version, reason: verdict },
        });
        return { ok: false, reason: verdict };
      }
      let owned: unknown;
      try {
        owned = cloneAndFreezePlainData(migrated, "Artifact state");
      } catch (error) {
        const reason = stateOwnershipFailure(error);
        options.observations?.record({
          kind: "stateValidationFailed",
          detail: { path, schema: schema.name, version: schema.version, reason },
        });
        return { ok: false, reason };
      }
      bound.set(path, schema);
      values.set(path, owned);
      notify(path);
      return { ok: true };
    },
    declaredSchema(path) {
      return bound.get(path);
    },
  };
}

/**
 * A staging frame is handed the snapshot directly, so a shallow freeze would still
 * let it mutate a nested array and change what the current frame reads.
 */
function stateOwnershipFailure(error: unknown): string {
  return error instanceof Error ? error.message : "Artifact state could not be copied into Host ownership.";
}
