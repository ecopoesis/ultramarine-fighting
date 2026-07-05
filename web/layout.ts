// Depth-layered map coordinates. The bay reads top-to-bottom by DEPTH: Rockland
// (home port) at the top, then the inshore ring, the mid/island belt, the offshore
// ring, and the deep edge at the bottom. Rows are aligned so the radial edges
// (inshore→mid→offshore→deep) run mostly straight down — the ratchet outward is
// literally the journey down the screen. Purely presentational; the engine's
// edges drive the topology.
export const NODE_XY: Record<string, { x: number; y: number }> = {
  // home port (top)
  ROCKLAND: { x: 450, y: 44 },

  // inshore ring (row 1) — up-bay, safe
  INSHORE_W: { x: 235, y: 140 },
  INSHORE_N: { x: 390, y: 140 },
  INSHORE_E: { x: 545, y: 140 },
  INSHORE_S: { x: 700, y: 140 },

  // mid ring (row 2) — the island belt — with its two ports
  MID_W: { x: 180, y: 258 },
  MID_NW: { x: 300, y: 258 },
  MID_N: { x: 400, y: 258 },
  MID_C: { x: 495, y: 258 },
  MID_E: { x: 600, y: 258 },
  MID_SE: { x: 700, y: 258 },
  VINALHAVEN: { x: 560, y: 322 }, // offshore springboard, sits below the belt
  STONINGTON: { x: 828, y: 240 }, // eastern port, off to the right

  // offshore ring (row 3) — the outer water — with its shelter
  OFF_W: { x: 180, y: 392 },
  OFF_NW: { x: 300, y: 392 },
  OFF_N: { x: 400, y: 392 },
  OFF_C: { x: 495, y: 392 },
  OFF_E: { x: 600, y: 392 },
  OFF_SE: { x: 690, y: 392 },
  MONHEGAN: { x: 92, y: 410 }, // SW shelter, far left

  // the deep edge (row 4, bottom) — richest, farthest — with the outer shelter
  DEEP_EDGE: { x: 495, y: 508 },
  MATINICUS: { x: 668, y: 500 },
};

export const TIER_COLOR: Record<string, string> = {
  inshore: '#3f9d54',
  mid: '#1f9e9e',
  offshore: '#2f6fd0',
  deep: '#5b3fb0',
};

export const VIEWBOX = { w: 900, h: 560 };
