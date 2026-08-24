export async function studioApiError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: string };
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Preserve the status fallback when a proxy returns a non-JSON body.
  }
  return `Studio request failed (${response.status}).`;
}
