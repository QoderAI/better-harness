// Test-only native bridge. Never copied into the Studio distribution/Profile.
export const inject = ["tools", "agents", "webServer"];
export function apply(ctx, config) {
  let release, lease, owner;
  ctx.effect(() => ctx.webServer.register({ kind: "exact", path: "/design-test", async handler(req, res) {
    if (req.headers["x-test-token"] !== config.token) { res.writeHead(403); res.end(); return; }
    try {
      let value;
      const action = new URL(req.url, "http://localhost").searchParams.get("action");
      if (action === "busy") {
        owner = await ctx.agents.create({ sessionId: "design-maintenance-smoke", meta: { cwd: config.cwd } });
        lease = owner.agent.runMaintenance(() => new Promise(done => { release = done; }));
        value = "busy";
      } else if (action === "release") { release?.(); await lease; value = "released"; }
      else if (action === "create") {
        const handle = await ctx.agents.create({ sessionId: `design-create-${Date.now()}`, meta: { cwd: config.cwd } });
        await handle.dispose(); value = "created";
      } else {
        const name = action === "compile" ? "harness_compile_plugin" : action === "greeting" ? "harness_greeting" : "harness_design_status";
        const tool = ctx.tools.get(name); if (!tool) throw new Error(`Missing tool ${name}`);
        value = await tool.execute({}, { signal: new AbortController().signal });
      }
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ value, pid: process.pid }));
    } catch (error) { res.writeHead(409, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
  } }));
  ctx.effect(() => async () => { release?.(); await lease; await owner?.dispose(); });
}
