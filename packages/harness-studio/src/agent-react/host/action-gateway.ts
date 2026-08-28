import type { ActionOutcome, ActionRequest, Digest } from "../contracts/index.js";
import type { CapabilityBroker, CapabilityPolicy } from "./capability.js";
import type { ObservationBridge } from "./observation-bridge.js";

export type ActionHandler = (payload: unknown) => Promise<unknown> | unknown;

export interface ActionGateway {
  dispatch(request: ActionRequest): Promise<ActionOutcome>;
  /** Registers the Host-side effect for one capability. */
  register(capability: string, handler: ActionHandler): void;
}

export interface ActionGatewayOptions {
  readonly broker: CapabilityBroker;
  readonly policy: CapabilityPolicy;
  readonly observations: ObservationBridge;
  readonly artifactDigest?: Digest;
  readonly handlers?: Readonly<Record<string, ActionHandler>>;
}

/**
 * The single point where an Artifact's intent becomes a side effect.
 *
 * Every dispatch is re-validated against the live token, the live grant, and the
 * policy. The compile-time Profile and the ABI are advisory by comparison: a
 * bundle that forged its own manifest, or kept a token after its frame was
 * discarded, is refused right here.
 */
export function createActionGateway(options: ActionGatewayOptions): ActionGateway {
  const handlers = new Map<string, ActionHandler>(Object.entries(options.handlers ?? {}));

  const deny = (reason: string, capability: string, buildDigest?: Digest): ActionOutcome => {
    options.observations.record({
      kind: "actionDenied",
      ...(options.artifactDigest === undefined ? {} : { artifactDigest: options.artifactDigest }),
      ...(buildDigest === undefined ? {} : { buildDigest }),
      detail: { capability, reason },
    });
    return { status: "denied", reason };
  };

  return {
    register(capability, handler) {
      handlers.set(capability, handler);
    },
    async dispatch(request) {
      const frame = options.broker.resolveFrameToken(request.frameToken);
      if (frame === undefined) {
        return deny("Frame token is unknown or has been revoked.", request.capability);
      }

      options.observations.record({
        kind: "actionAttempted",
        ...(options.artifactDigest === undefined ? {} : { artifactDigest: options.artifactDigest }),
        buildDigest: frame.buildDigest,
        detail: { capability: request.capability, actionMode: frame.actionMode },
      });

      if (frame.actionMode === "denied") {
        return deny("Frame is not permitted to run Actions.", request.capability, frame.buildDigest);
      }
      if (!options.broker.isFrameCapabilityGranted(request.frameToken, request.capability)) {
        return deny(`Capability '${request.capability}' is not currently granted to this frame.`, request.capability, frame.buildDigest);
      }
      const verdict = options.policy.validateAction(request.capability, request.payload);
      if (verdict !== true) {
        return deny(verdict, request.capability, frame.buildDigest);
      }
      if (frame.actionMode === "dry-run") {
        // A staging frame must reach this line and stop: running the handler to
        // "see if it works" is indistinguishable from committing the effect.
        return { status: "dry-run" };
      }

      const handler = handlers.get(request.capability);
      if (handler === undefined) {
        return deny(`No Host handler is registered for '${request.capability}'.`, request.capability, frame.buildDigest);
      }
      try {
        return { status: "completed", result: await handler(request.payload) };
      } catch (error) {
        options.observations.record({
          kind: "runtimeException",
          ...(options.artifactDigest === undefined ? {} : { artifactDigest: options.artifactDigest }),
          buildDigest: frame.buildDigest,
          detail: { capability: request.capability, message: error instanceof Error ? error.message : String(error) },
        });
        return { status: "denied", reason: `Action '${request.capability}' failed in the Host.` };
      }
    },
  };
}
