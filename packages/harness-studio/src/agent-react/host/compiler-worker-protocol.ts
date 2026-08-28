import type { CompileModuleInput, CompileModuleOutput } from "../contracts/index.js";
import type { OxcCompileLimits } from "../kernel/index.js";

export const OXC_WORKER_REQUEST = "agent-react.oxc.compile" as const;
export const OXC_WORKER_RESPONSE = "agent-react.oxc.result" as const;

export interface OxcWorkerRequest {
  readonly type: typeof OXC_WORKER_REQUEST;
  readonly requestId: number;
  readonly input: CompileModuleInput;
  readonly limits: Partial<OxcCompileLimits>;
}

export interface OxcWorkerResponse {
  readonly type: typeof OXC_WORKER_RESPONSE;
  readonly requestId: number;
  readonly output: CompileModuleOutput;
}

export function isOxcWorkerRequest(value: unknown): value is OxcWorkerRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return request.type === OXC_WORKER_REQUEST
    && Number.isSafeInteger(request.requestId)
    && typeof request.input === "object"
    && request.input !== null
    && typeof (request.input as Record<string, unknown>).module === "object"
    && typeof request.limits === "object"
    && request.limits !== null;
}

export function isOxcWorkerResponse(value: unknown): value is OxcWorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  return response.type === OXC_WORKER_RESPONSE
    && Number.isSafeInteger(response.requestId)
    && typeof response.output === "object"
    && response.output !== null;
}
