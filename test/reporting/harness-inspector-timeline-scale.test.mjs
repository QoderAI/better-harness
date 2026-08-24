import assert from "node:assert/strict";
import { test } from "vitest";

import { buildCompressedTimelineScale } from "../../scripts/harness-inspector/index.mjs";

const minute = 60_000;

test("dominant idle windows use a bounded piecewise span", () => {
  const scale = buildCompressedTimelineScale({
    min: 0,
    max: 65 * minute,
    positions: [0, 4 * minute, 10 * minute, 62 * minute, 65 * minute],
    plotLeft: 100,
    plotWidth: 1_000,
  });

  assert.equal(scale.compressed, true);
  assert.deepEqual(scale.gaps.map((gap) => [gap.from, gap.to]), [[10 * minute, 62 * minute]]);
  assert.ok(scale.xFor(62 * minute) - scale.xFor(10 * minute) < 150);
  assert.ok(scale.xFor(10 * minute) - scale.xFor(0) > scale.xFor(62 * minute) - scale.xFor(10 * minute));
});

test("compressed timeline mapping round-trips real wall-clock positions", () => {
  const scale = buildCompressedTimelineScale({
    min: 0,
    max: 65 * minute,
    positions: [0, 4 * minute, 10 * minute, 62 * minute, 65 * minute],
    plotLeft: 80,
    plotWidth: 920,
  });

  for (const position of [0, 7 * minute, 10 * minute, 36 * minute, 62 * minute, 64 * minute, 65 * minute]) {
    assert.ok(Math.abs(scale.positionForX(scale.xFor(position)) - position) < 1, `round trip ${position}`);
  }
});

test("short idle and call-sequence ranges stay linear", () => {
  const shortIdle = buildCompressedTimelineScale({
    min: 0,
    max: 12 * minute,
    positions: [0, 4 * minute, 8 * minute, 12 * minute],
    plotWidth: 600,
  });
  assert.equal(shortIdle.compressed, false);
  assert.equal(shortIdle.xFor(6 * minute), 300);

  const sequence = buildCompressedTimelineScale({
    min: 1,
    max: 100,
    positions: [1, 2, 99, 100],
    plotWidth: 990,
    timeBasis: false,
  });
  assert.equal(sequence.compressed, false);
  assert.equal(sequence.xFor(50.5), 495);
});
