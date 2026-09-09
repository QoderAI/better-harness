import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

/** Claim every native idle lane in one synchronous turn, or release and retry. */
export async function withAgentMaintenance({ agents, onCreated, signal, timeoutMs = 60000 }, task) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    signal.throwIfAborted();
    const snapshot = agents.list();
    if (snapshot.some(agent => typeof agent.runMaintenance !== "function")) throw new Error("This DSH version lacks the required native maintenance API.");
    let release;
    const gate = new Promise(done => { release = done; });
    const leases = [], signals = [];
    let acquired = true;
    try {
      for (const agent of snapshot) {
        let claimed = false;
        const lease = agent.runMaintenance(maintenanceSignal => {
          claimed = true; signals.push(maintenanceSignal); return gate;
        });
        leases.push(Promise.resolve(lease));
        if (!claimed) throw new Error("Native maintenance did not claim synchronously.");
      }
    } catch { acquired = false; }
    if (!acquired) {
      release(); await Promise.allSettled(leases);
      if (Date.now() >= deadline) throw new Error("Agent stayed busy; retry compilation after the current turn.");
      await delay(50, undefined, { signal }); continue;
    }
    // Registry publication is synchronous. Throwing vetoes creation until all
    // maintenance lanes are released, rather than permitting an unreserved agent.
    const unguard = onCreated(() => { throw new Error("Harness Design is activating a plugin; retry agent creation shortly."); });
    const activationSignal = AbortSignal.any([signal, ...signals]);
    try { activationSignal.throwIfAborted(); return await task(activationSignal); }
    finally { unguard(); release(); await Promise.allSettled(leases); }
  }
}

/** Native Entry.update awaits lifecycle completion and handles apply rollback. */
export async function activateCandidate({ entry, runtime, candidate, signal }) {
  const previous = entry.options.name;
  signal.throwIfAborted();
  try { await entry.update({ name: pathToFileURL(candidate.artifact).href }); }
  catch (error) {
    // DSH 0.1.2-rc.1's callback-only rollback can lose a module's `inject`
    // declaration. Force a fresh import of the previous full module if native
    // rollback left its fiber absent; never mutate Cordis internals.
    if (!entry.fiber?.uid) {
      try { await entry.update({ name: previous }, false, true); }
      catch (rollback) { throw new Error("Plugin activation and restoration both failed; restart DSH with the retained configuration.", { cause: new AggregateError([error, rollback]) }); }
      throw new Error("Plugin activation failed; previous plugin restored.", { cause: error });
    }
    throw error;
  }
  try {
    signal.throwIfAborted();
    await runtime.publish(candidate);
  } catch (error) {
    try { await entry.update({ name: previous }); }
    catch (rollback) { throw new Error(`Publication failed: ${error.message}; rollback failed: ${rollback.message}`); }
    throw error;
  }
}
