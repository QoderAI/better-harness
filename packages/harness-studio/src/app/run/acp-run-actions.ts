/** A successful HTTP acknowledgement is required before disabling a decision. */
export async function postAcpRunAction(runId: string, action: "cancel" | { requestId: string; optionId: string }): Promise<void> {
  const suffix = action === "cancel" ? "cancel" : `permissions/${encodeURIComponent(action.requestId)}`;
  const response = await fetch(`api/acp/runs/${encodeURIComponent(runId)}/${suffix}`, {
    method: "POST",
    ...(action === "cancel" ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId: action.optionId }),
    }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const detail = body !== null && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : response.statusText;
    throw new Error(`ACP ${action === "cancel" ? "cancel" : "permission"} (${response.status}): ${detail}`);
  }
}
