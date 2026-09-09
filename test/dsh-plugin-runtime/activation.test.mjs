import assert from "node:assert/strict";
import { test } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { activateCandidate, withAgentMaintenance } from "../../scripts/dsh-plugin-runtime/activation.mjs";

function harness() {
  let listener;
  const agents = [];
  return { agents: { list: () => agents }, signal: new AbortController().signal,
    onCreated(fn) { listener = fn; return () => { listener = undefined; }; },
    add() {
      listener?.();
      const agent = { busy: false, reserved: false, signal: new AbortController().signal,
        runMaintenance(task) {
          if (this.busy || this.reserved) throw new Error("busy");
          this.reserved = true;
          return Promise.resolve(task(this.signal)).finally(() => { this.reserved = false; });
        },
      };
      agents.push(agent); return agent;
    },
  };
}

test("waits for busy lanes, releases partial reservations and vetoes new agents only during activation", async () => {
  const h = harness(), first = h.add(), busy = h.add(); busy.busy = true;
  let ran = false;
  const job = withAgentMaintenance(h, async () => {
    ran = true;
    assert.equal(first.reserved, true); assert.equal(busy.reserved, true);
    assert.throws(() => h.add(), /activating/);
    await delay(10);
  });
  await delay(10); assert.equal(ran, false); assert.equal(first.reserved, false);
  const addedWhileWaiting = h.add(); busy.busy = false;
  await job;
  assert.equal(ran, true); assert.equal(first.reserved, false); assert.equal(addedWhileWaiting.reserved, false);
  assert.doesNotThrow(() => h.add());
});

test("waiting cancellation and timeout never activate or retain leases", async () => {
  const h = harness(), first = h.add(), busy = h.add(); busy.busy = true;
  const abort = new AbortController();
  const job = withAgentMaintenance({ ...h, signal: abort.signal }, () => assert.fail("activated"));
  abort.abort(); await assert.rejects(job); assert.equal(first.reserved, false);
  await assert.rejects(withAgentMaintenance({ ...h, timeoutMs: 0 }, () => assert.fail("activated")), /stayed busy/);
  assert.equal(first.reserved, false);
});

test("failed activation releases guards, and cancellation during activation does not release early", async () => {
  const h = harness(), agent = h.add(), abort = new AbortController();
  await assert.rejects(withAgentMaintenance(h, async () => { throw new Error("apply failed"); }), /apply failed/);
  let finish;
  const job = withAgentMaintenance({ ...h, signal: abort.signal }, async signal => {
    await new Promise(done => { finish = done; }); signal.throwIfAborted();
  });
  abort.abort(); assert.equal(agent.reserved, true); finish(); await assert.rejects(job);
  assert.equal(agent.reserved, false); assert.doesNotThrow(() => h.add());
});

test("awaits native load before publication; apply failure never publishes; publication failure rolls back", async () => {
  const events = [], signal = new AbortController().signal;
  const entry = { options: { name: "previous" }, async update({ name }) { events.push(name === "previous" ? "rollback" : "loaded"); } };
  const candidate = { artifact: fileURLToPath(new URL("./candidate.mjs", import.meta.url)) };
  const runtime = { async publish() { events.push("publish"); } };
  await activateCandidate({ entry, candidate, runtime, signal });
  assert.deepEqual(events, ["loaded", "publish"]);
  events.length = 0;
  await assert.rejects(activateCandidate({ entry: { ...entry, fiber: { uid: 1 }, async update() { throw new Error("apply failed"); } }, candidate, runtime, signal }), /apply failed/);
  assert.deepEqual(events, []);
  runtime.publish = async () => { events.push("publish"); throw new Error("disk failure"); };
  await assert.rejects(activateCandidate({ entry, candidate, runtime, signal }), /disk failure/);
  assert.deepEqual(events, ["loaded", "publish", "rollback"]);
});

test("restores the full previous module when native callback rollback loses its fiber", async () => {
  const calls = [];
  const entry = { options: { name: "previous" }, async update(options, create, force) {
    calls.push({ ...options, create, force });
    if (!force) throw new Error("native rollback lost inject metadata");
    this.fiber = { uid: 2 };
  } };
  await assert.rejects(activateCandidate({ entry, candidate: { artifact: fileURLToPath(new URL("./candidate.mjs", import.meta.url)) }, runtime: { publish() { assert.fail("published failed candidate"); } }, signal: new AbortController().signal }), /previous plugin restored/);
  assert.deepEqual(calls[1], { name: "previous", create: false, force: true });
  assert.equal(entry.fiber.uid, 2);
});
