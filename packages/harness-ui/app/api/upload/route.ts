import { validateUploadPlan } from "../../../../../scripts/task-evidence-upload/index.mjs";
import { resolveUploadsDirectory, storeUploadPlan } from "@/scripts/upload-store.mjs";
import { resolveWorkspace } from "@/scripts/workspace.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 1024 * 1024;

class RequestTooLargeError extends Error {}

function failure(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function allowedOrganizations() {
  const configured = process.env.BETTER_HARNESS_UPLOAD_ORGANIZATIONS;
  if (!configured) return null;
  const allowed = configured.split(",").map((entry) => entry.trim()).filter(Boolean);
  return allowed.length > 0 ? new Set(allowed) : null;
}

function isJsonRequest(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || undefined;
}

function requestEndpoint(request: Request) {
  const endpoint = new URL(request.url);
  const host = firstForwardedValue(request.headers.get("x-forwarded-host"))
    ?? request.headers.get("host")
    ?? undefined;
  const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  if (host) endpoint.host = host;
  if (protocol === "http" || protocol === "https") endpoint.protocol = `${protocol}:`;
  return endpoint.toString();
}

async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new RequestTooLargeError();
  }
  if (request.body === null) return "";

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RequestTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function POST(request: Request) {
  if (!isJsonRequest(request)) {
    return failure(415, "JSON_REQUIRED", "Task evidence uploads require Content-Type: application/json.");
  }
  let body: string;
  try {
    body = await readBoundedBody(request);
  } catch (error) {
    if (!(error instanceof RequestTooLargeError)) throw error;
    return failure(413, "PLAN_TOO_LARGE", `An upload plan must not exceed ${MAX_REQUEST_BYTES} bytes.`);
  }

  let submitted: unknown;
  try {
    submitted = JSON.parse(body);
  } catch {
    return failure(400, "INVALID_JSON", "The request body is not valid JSON.");
  }

  let plan;
  try {
    plan = validateUploadPlan(submitted);
  } catch (error) {
    const rejection = error as { code?: string; message?: string };
    return failure(400, rejection.code ?? "INVALID_PLAN", rejection.message ?? "The upload plan is not valid.");
  }

  if (plan.destination.endpoint !== requestEndpoint(request)) {
    return failure(400, "DESTINATION_MISMATCH", "The upload plan is addressed to a different destination endpoint.");
  }

  const allowed = allowedOrganizations();
  if (allowed && !allowed.has(plan.destination.organization)) {
    return failure(403, "ORGANIZATION_NOT_ALLOWED", "This destination does not accept that organization.");
  }

  try {
    const stored = await storeUploadPlan(plan, {
      directory: resolveUploadsDirectory({ workspace: resolveWorkspace() }),
    });
    return Response.json(stored.receipt, { status: 200 });
  } catch {
    return failure(500, "STORE_FAILED", "The upload plan could not be stored.");
  }
}
