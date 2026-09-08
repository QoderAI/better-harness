import { afterEach, expect, it, vi } from "vitest";
import { postAcpRunAction } from "../src/app/run/acp-run-actions.js";

afterEach(() => vi.unstubAllGlobals());

it("posts the selected option to the exact lane/request with encoded identities", async () => {
  const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await postAcpRunAction("run /1", { requestId: "permission/1", optionId: "allow-once" });
  expect(fetch).toHaveBeenCalledWith("api/acp/runs/run%20%2F1/permissions/permission%2F1", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optionId: "allow-once" }),
  });
});

it("rejects a refused action with the server's retryable reason", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "No pending decision" }), { status: 404 }));
  await expect(postAcpRunAction("run", { requestId: "r1", optionId: "allow" })).rejects.toThrow("No pending decision");
});

it("does not silently swallow failed or disconnected cancellation", async () => {
  vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 503, statusText: "Service unavailable" }));
  await expect(postAcpRunAction("run", "cancel")).rejects.toThrow("Service unavailable");
  vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
  await expect(postAcpRunAction("run", "cancel")).rejects.toThrow("offline");
});
