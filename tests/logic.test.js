import test from "node:test";
import assert from "node:assert/strict";

import {
  DEAD_ZONE_PX,
  FULL_TRACK_PX,
  blinkDelay,
  bubblePosition,
  clampPosition,
  cleanMessages,
  eyeOffset,
  pickIndex,
  HUNGRY_MESSAGES,
  FED_MESSAGES,
  YAWN_MESSAGES,
  ALERT_MESSAGES,
} from "../extension/pixelcat@sakin/logic.js";

const room = { left: 2, right: 2, up: 2, down: 2 };

test("pointer inside the dead zone => eyes centred", () => {
  assert.deepEqual(eyeOffset(0, 0, room), { dx: 0, dy: 0 });
  assert.deepEqual(eyeOffset(DEAD_ZONE_PX, 0, room), { dx: 0, dy: 0 });
});

test("far pointer on each side => full offset in that direction only", () => {
  assert.deepEqual(eyeOffset(2000, 0, room), { dx: 2, dy: 0 });
  assert.deepEqual(eyeOffset(-2000, 0, room), { dx: -2, dy: 0 });
  assert.deepEqual(eyeOffset(0, 2000, room), { dx: 0, dy: 2 });
  assert.deepEqual(eyeOffset(0, -2000, room), { dx: 0, dy: -2 });
});

test("offsets are whole pixels, never -0", () => {
  for (let a = 0; a < 360; a += 7) {
    for (const r of [20, 100, 200, FULL_TRACK_PX, 900]) {
      const { dx, dy } = eyeOffset(Math.cos(a) * r, Math.sin(a) * r, room);
      assert.ok(Number.isInteger(dx) && Number.isInteger(dy));
      assert.ok(!Object.is(dx, -0) && !Object.is(dy, -0));
      assert.ok(Math.abs(dx) <= 2 && Math.abs(dy) <= 2);
    }
  }
});

test("asymmetric room is respected per direction", () => {
  const r = { left: 1, right: 2, up: 0, down: 1 };
  assert.equal(eyeOffset(-2000, 0, r).dx, -1);
  assert.equal(eyeOffset(2000, 0, r).dx, 2);
  assert.equal(eyeOffset(0, -2000, r).dy, 0);
  assert.equal(eyeOffset(0, 2000, r).dy, 1);
});

test("closer pointer => smaller offset", () => {
  assert.equal(eyeOffset(40, 0, room).dx, 0);
  assert.equal(eyeOffset(FULL_TRACK_PX, 0, room).dx, 2);
});

test("blinkDelay stays inside the range, even when min > max", () => {
  for (const [a, b] of [
    [2500, 6000],
    [6000, 2500],
  ]) {
    for (const r of [0, 0.5, 0.999]) {
      const d = blinkDelay(a, b, () => r);
      assert.ok(d >= 2500 && d <= 6000);
    }
  }
});

test("pickIndex never repeats the last message when it can avoid it", () => {
  for (let count = 2; count <= 6; count++) {
    for (let last = 0; last < count; last++) {
      for (let k = 0; k < 200; k++) {
        const i = pickIndex(count, last);
        assert.ok(i >= 0 && i < count && i !== last);
      }
    }
  }
  assert.equal(pickIndex(1, 0), 0);
  assert.equal(pickIndex(0, -1), -1);
});

test("cleanMessages trims and drops empty / too-long lines", () => {
  assert.deepEqual(cleanMessages(["  hi  ", "", "   ", "x".repeat(81), "ok"]), [
    "hi",
    "ok",
  ]);
});

test("clampPosition keeps coordinates strictly inside work area", () => {
  const area = { x: 100, y: 50, width: 1920, height: 1080 };
  const w = 180;
  const h = 200;

  // Inside bounds: stays identical
  assert.deepEqual(clampPosition(500, 400, w, h, area), { x: 500, y: 400 });

  // Too far left / top: clamped to area.x, area.y
  assert.deepEqual(clampPosition(0, 0, w, h, area), { x: 100, y: 50 });
  assert.deepEqual(clampPosition(-200, -100, w, h, area), { x: 100, y: 50 });

  // Too far right / bottom: clamped to max visible
  const maxX = 100 + 1920 - 180;
  const maxY = 50 + 1080 - 200;
  assert.deepEqual(clampPosition(5000, 3000, w, h, area), { x: maxX, y: maxY });
});

test("bubblePosition places bubble above cat if space allows, otherwise below", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const bubbleSize = { w: 120, h: 40 };

  // Cat in the middle of screen: bubble placed above
  const catMid = { x: 500, y: 500, w: 100, h: 100 };
  const posMid = bubblePosition(catMid, bubbleSize, area, 4);
  assert.equal(posMid.y, 500 - 40 - 4); // above cat
  assert.equal(posMid.x, 500 + (100 - 120) / 2); // centered

  // Cat near the top edge: bubble placed below
  const catTop = { x: 500, y: 10, w: 100, h: 100 };
  const posTop = bubblePosition(catTop, bubbleSize, area, 4);
  assert.equal(posTop.y, 10 + 100 + 4); // below cat
});

test("message constants are non-empty and have valid lengths", () => {
  for (const list of [
    HUNGRY_MESSAGES,
    FED_MESSAGES,
    YAWN_MESSAGES,
    ALERT_MESSAGES,
  ]) {
    assert.ok(Array.isArray(list) && list.length > 0);
    for (const msg of list) {
      assert.ok(typeof msg === "string" && msg.length > 0 && msg.length <= 80);
    }
  }
});
