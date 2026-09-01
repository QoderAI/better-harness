import { validateUploadPlan } from "../../../../../scripts/task-evidence-upload/index.mjs";
import { resolveUploadsDirectory, storeUploadPlan } from "@/scripts/upload-store.mjs";
import { resolveWorkspace } from "@/scripts/workspace.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 1024 * 1024;

function failure(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function allowedOrganizations() {
  const configured = process.env.BETTER_HARNESS_UPLOAD_ORGANIZATIONS;
  if (!configured) return null;
  const allowed = configured.split(",").map((entry) => entry.trim()).filter(Boolean);
  return allowed.length > 0 ? new Set(allowed) : null;
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    return failure(413, "PLAN_TOO_LARGE", `An upload plan must not exceed ${MAX_REQUEST_BYTES} bytes.`);
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
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
