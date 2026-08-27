import { normalize } from "node:path/posix";
import type { ArtifactDescriptor, ArtifactRevision, ModuleSource } from "../contracts/index.js";
import { digestArtifactRevision } from "./digest.js";

export interface ModulePatch {
  readonly path: string;
  readonly text: string;
  /** `append` continues a streaming module; `replace` restates it in full. */
  readonly mode?: "append" | "replace";
}

/**
 * Turns an agent's token-by-token output into committed Revisions.
 *
 * The assembler refuses to commit a module the agent has not sealed. A half
 * streamed TSX file parses as a syntax error, and a syntax error that is really
 * "the agent is still typing" would be reported to the agent as a compile
 * failure it must fix — so the pipeline would fight the writer.
 */
export class AgentStreamAssembler {
  #pending = new Map<string, string>();
  #sealed = new Map<string, string>();
  #descriptor: ArtifactDescriptor;

  constructor(descriptor: ArtifactDescriptor) {
    if (descriptor.id.trim() === "") throw new Error("Artifact id must be non-empty.");
    assertRevisionPath(descriptor.entry);
    this.#descriptor = Object.freeze({ id: descriptor.id, entry: descriptor.entry });
  }

  applyModulePatch(patch: ModulePatch): void {
    assertRevisionPath(patch.path);
    if (patch.mode === "replace") {
      this.#pending.set(patch.path, patch.text);
      this.#sealed.delete(patch.path);
      return;
    }
    this.#pending.set(patch.path, (this.#pending.get(patch.path) ?? "") + patch.text);
    this.#sealed.delete(patch.path);
  }

  sealModule(path: string): void {
    assertRevisionPath(path);
    const text = this.#pending.get(path);
    if (text === undefined) throw new Error(`Module '${path}' has no streamed content to seal.`);
    this.#pending.delete(path);
    this.#sealed.set(path, text);
  }

  /** Paths that received content but were never sealed. */
  unsealedModules(): readonly string[] {
    return [...this.#pending.keys()].sort();
  }

  commitArtifactRevision(): ArtifactRevision {
    if (this.#pending.size > 0) {
      throw new Error(`Cannot commit a Revision while ${this.unsealedModules().join(", ")} is unsealed.`);
    }
    if (!this.#sealed.has(this.#descriptor.entry)) {
      throw new Error(`Revision is missing its entry module '${this.#descriptor.entry}'.`);
    }
    const modules: ModuleSource[] = [...this.#sealed]
      .map(([path, text]) => Object.freeze({ path, text }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return Object.freeze({
      digest: digestArtifactRevision(this.#descriptor, modules),
      modules: Object.freeze(modules),
      descriptor: this.#descriptor,
    });
  }

  /** Drops in-flight streaming work; already sealed modules survive. */
  abortGeneration(): void {
    this.#pending.clear();
  }
}

export function isNormalizedRevisionPath(path: string): boolean {
  return !(
    !path.startsWith("/")
    || path === "/"
    || path.endsWith("/")
    || path.includes("\\")
    || path.includes("\0")
    || normalize(path) !== path
  );
}

function assertRevisionPath(path: string): void {
  if (!isNormalizedRevisionPath(path)) {
    throw new Error(`Revision module path '${path}' must be a normalized POSIX path rooted at '/'.`);
  }
}
