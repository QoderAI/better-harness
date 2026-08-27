import type {
  ActionMode,
  ArtifactViewDeclaration,
  CapabilityGrant,
  CapabilityRefusal,
  Digest,
  FrameToken,
} from "../contracts/index.js";

export interface CapabilityPolicy {
  /** Capabilities the Host is willing to expose for this Artifact at all. */
  readonly allowedCapabilities: readonly string[];
  requiresApproval(capability: string): boolean;
  /** Re-checked on every dispatch, not only at grant time. */
  validateAction(capability: string, payload: unknown): true | string;
}

export interface CapabilityPolicyOptions {
  readonly allowedCapabilities: readonly string[];
  readonly requiresApproval?: readonly string[];
  readonly validate?: (capability: string, payload: unknown) => true | string;
}

export function createCapabilityPolicy(options: CapabilityPolicyOptions): CapabilityPolicy {
  const allowed = new Set(options.allowedCapabilities);
  const needsApproval = new Set(options.requiresApproval ?? []);
  return {
    allowedCapabilities: Object.freeze([...allowed].sort()),
    requiresApproval(capability) {
      return needsApproval.has(capability);
    },
    validateAction(capability, payload) {
      if (!allowed.has(capability)) return `Capability '${capability}' is not allowed by Host policy.`;
      return options.validate?.(capability, payload) ?? true;
    },
  };
}

export interface CapabilityBroker {
  computeGrant(declaration: Pick<ArtifactViewDeclaration, "capabilities">): CapabilityGrant;
  approve(capability: string): void;
  revokeApproval(capability: string): void;
  issueFrameToken(buildDigest: Digest, actionMode: ActionMode, grant: CapabilityGrant): FrameToken;
  resolveFrameToken(token: string): FrameToken | undefined;
  isFrameCapabilityGranted(token: string, capability: string): boolean;
  revokeFrameToken(token: string): void;
}

export interface CapabilityBrokerOptions {
  readonly policy: CapabilityPolicy;
  readonly approvals?: readonly string[];
  readonly newToken?: () => string;
}

/**
 * Turns capability *requests* into a grant.
 *
 * The intersection is the whole point: declared capabilities are what the code
 * asked for, and code is exactly the thing that cannot be trusted to authorize
 * itself. The refusal reasons are returned rather than dropped so a Surface can
 * explain a missing control instead of rendering a button that silently fails.
 */
export function createCapabilityBroker(options: CapabilityBrokerOptions): CapabilityBroker {
  const approvals = new Set(options.approvals ?? []);
  const tokens = new Map<string, FrameToken>();
  const newToken = options.newToken ?? secureFrameToken;

  return {
    computeGrant(declaration) {
      const granted: string[] = [];
      const refused: { capability: string; reason: CapabilityRefusal }[] = [];
      for (const capability of [...new Set(declaration.capabilities)].sort()) {
        if (!options.policy.allowedCapabilities.includes(capability)) {
          refused.push({ capability, reason: "not-in-policy" });
          continue;
        }
        if (options.policy.requiresApproval(capability) && !approvals.has(capability)) {
          refused.push({ capability, reason: "awaiting-approval" });
          continue;
        }
        granted.push(capability);
      }
      return Object.freeze({ granted: Object.freeze(granted), refused: Object.freeze(refused) });
    },
    approve(capability) {
      approvals.add(capability);
    },
    revokeApproval(capability) {
      approvals.delete(capability);
    },
    issueFrameToken(buildDigest, actionMode, grant) {
      const tokenValue = newToken();
      if (tokens.has(tokenValue)) throw new Error("Frame token generator produced a duplicate token.");
      const token: FrameToken = Object.freeze({
        token: tokenValue,
        buildDigest,
        actionMode,
        granted: Object.freeze([...grant.granted]),
      });
      tokens.set(token.token, token);
      return token;
    },
    resolveFrameToken(token) {
      return tokens.get(token);
    },
    isFrameCapabilityGranted(token, capability) {
      const frame = tokens.get(token);
      if (frame === undefined || !frame.granted.includes(capability)) return false;
      if (!options.policy.allowedCapabilities.includes(capability)) return false;
      return !options.policy.requiresApproval(capability) || approvals.has(capability);
    },
    revokeFrameToken(token) {
      tokens.delete(token);
    },
  };
}

function secureFrameToken(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("A cryptographically secure randomUUID implementation is required for frame tokens.");
  }
  return globalThis.crypto.randomUUID();
}
