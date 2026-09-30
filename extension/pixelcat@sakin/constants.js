// Shared by extension.js, cat.js and prefs.js. No GNOME imports here.

// Integer scale factors that exist in assets/x<N>/ (built by tools/build_assets.py).
export const SCALES = [2, 3, 4, 6];

export const CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"];

// How often the pointer is sampled while the cat is awake.
export const POINTER_POLL_MS = 50;

// Sprite layer names (one PNG each in assets/x<N>/).
export const LAYERS = [
  "body",
  "eyes_open",
  "eyes_closed",
  "eyes_half",
  "cat_angry",
  "cat_yawn",
  "cat_food",
  "cat_chew",
];
