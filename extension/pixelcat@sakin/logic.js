// Pure logic, no GNOME imports, so it can be unit-tested with plain Node:
//   node --test tests/

export const DEAD_ZONE_PX = 10; // pointer this close to the eyes => look straight ahead
export const FULL_TRACK_PX = 350; // pointer this far (or more) => pupils at full offset

/**
 * Pupil offset in whole logical sprite pixels.
 * (vx, vy) is the vector from the cat's eyes to the pointer, in screen pixels.
 * room = {left, right, up, down}: how far the pupils may travel (from sprite.json).
 */
export function eyeOffset(vx, vy, room) {
  const dist = Math.hypot(vx, vy);
  if (!(dist > DEAD_ZONE_PX)) return { dx: 0, dy: 0 };
  const strength = Math.min(1, dist / FULL_TRACK_PX);
  const ux = vx / dist;
  const uy = vy / dist;
  const rx = ux >= 0 ? room.right : room.left;
  const ry = uy >= 0 ? room.down : room.up;
  // `|| 0` turns -0 into 0
  return {
    dx: Math.round(ux * strength * rx) || 0,
    dy: Math.round(uy * strength * ry) || 0,
  };
}

/** Random delay between blinks, tolerant of min > max. */
export function blinkDelay(minMs, maxMs, rand = Math.random) {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return lo + rand() * (hi - lo);
}

/** Pick an index in [0, count) that differs from `last` when possible. */
export function pickIndex(count, last, rand = Math.random) {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  let i = Math.floor(rand() * count);
  if (i === last) i = (i + 1 + Math.floor(rand() * (count - 1))) % count;
  return i;
}

/** Trim, drop empties and over-long lines. */
export function cleanMessages(list, maxLen = 80) {
  return list
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0 && s.length <= maxLen);
}

/**
 * Clamp actor coordinates (x, y) with dimensions (w, h) inside an area.
 */
export function clampPosition(x, y, w, h, area) {
  const maxX = Math.max(area.x, area.x + area.width - w);
  const maxY = Math.max(area.y, area.y + area.height - h);
  return {
    x: Math.round(Math.max(area.x, Math.min(x, maxX))),
    y: Math.round(Math.max(area.y, Math.min(y, maxY))),
  };
}

/**
 * Compute bubble position next to the cat.
 * Places bubble above the cat if there is space, otherwise below; centered horizontally.
 */
export function bubblePosition(rect, bubbleSize, area, gap = 4) {
  const { x: rx, y: ry, w: rw, h: rh } = rect;
  const { w: bw, h: bh } = bubbleSize;

  let y = ry - bh - gap >= area.y ? ry - bh - gap : ry + rh + gap;
  let x = rx + (rw - bw) / 2;

  const maxX = Math.max(area.x, area.x + area.width - bw);
  const maxY = Math.max(area.y, area.y + area.height - bh);
  x = Math.max(area.x, Math.min(x, maxX));
  y = Math.max(area.y, Math.min(y, maxY));

  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

export const HUNGRY_MESSAGES = [
  "Feed me! 😾",
  "Where's my cookie? 🍪",
  "I'm starving...",
  "Food now, please!",
  "Meow!! (hungry)",
  "Hmph! 💢",
];

export const FED_MESSAGES = [
  "♥ Munch munch nom!",
  "♥ Purrrr~",
  "♥ Delicious cookie! 🍪",
  "♥ Yummy! Thank you.",
];

export const YAWN_MESSAGES = [
  "*yaaawn*",
  "~yawn~ so sleepy...",
  "*yaaawn* (⌒ . ⌒)",
];

export const ALERT_MESSAGES = [
  "! (wide awake)",
  "Oh! You're here!",
  "Perked up!",
];
