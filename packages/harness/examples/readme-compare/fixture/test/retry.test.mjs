import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MAX_ATTEMPTS,
  RetryExhaustedError,
  retry,
} from "@fixture/retry-kit";

test("retries three times by default and reports exhaustion", async () => {
  let attempts = 0;
  await assert.rejects(
    retry(async () => {
      attempts += 1;
      throw new Error("still failing");
    }),
    (error) => error instanceof RetryExhaustedError && error.attempts === DEFAULT_MAX_ATTEMPTS,
  );
  assert.equal(attempts, 3);
});

test("returns the first successful value", async () => {
  const value = await retry(async (attempt) => {
    if (attempt < 2) throw new Error("transient");
    return "ready";
  });
  assert.equal(value, "ready");
});

test("honors an already-aborted signal before invoking the operation", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  let called = false;
  await assert.rejects(retry(async () => { called = true; }, { signal: controller.signal }), /cancelled/);
  assert.equal(called, false);
});
