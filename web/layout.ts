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
};


// --- v4: the REAL Penobscot Bay. Laid out geographically, north at the top and west
// at the left, so the board reads like a chart rather than a ladder of depth rows.
// Note this means DEPTH NO LONGER RUNS DOWN THE SCREEN: Seal Cove is a mid ground
// but sits far east, and the Gulf of Maine is closer to Rockland than Frenchboro is.
NODE_XY.PENOBSCOT = { x: 400, y: 45 };
NODE_XY.EGGEMOGGIN = { x: 640, y: 70 };
NODE_XY.ROCKLAND = { x: 175, y: 95 };
NODE_XY.RESOLUTION = { x: 490, y: 105 };
NODE_XY.SEAL_COVE = { x: 790, y: 110 };
NODE_XY.STONINGTON = { x: 660, y: 140 };
NODE_XY.OWLS_HEAD = { x: 225, y: 165 };
NODE_XY.SEAL_BAY = { x: 545, y: 190 };
NODE_XY.MUSCLE_RIDGE = { x: 140, y: 225 };
NODE_XY.VINALHAVEN = { x: 420, y: 225 };
NODE_XY.SWANS_ISLAND = { x: 750, y: 235 };
NODE_XY.HURRICANE = { x: 325, y: 240 };
NODE_XY.ISLE_AU_HAUT = { x: 620, y: 275 };
NODE_XY.FRENCHBORO = { x: 848, y: 275 };
NODE_XY.METINIC = { x: 145, y: 315 };
NODE_XY.SEAL_ISLAND = { x: 455, y: 325 };
NODE_XY.MATINICUS = { x: 300, y: 340 };
NODE_XY.MT_DESERT = { x: 800, y: 430 };
NODE_XY.TOOTHACKER = { x: 165, y: 405 };
NODE_XY.SKATE_BANK = { x: 330, y: 440 };
NODE_XY.MONHEGAN = { x: 210, y: 500 };
NODE_XY.GULF_OF_MAINE = { x: 500, y: 490 };

// Guides drawn behind the chart. The ring map used one per depth tier; a real chart
// has no such rows, so this is just an orientation cue.
export const ROW_GUIDES: [string, number][] = [
  ['UP THE BAY', 30],
  ['THE OPEN GULF', 530],
];

export const TIER_COLOR: Record<string, string> = {
  inshore: '#3f9d54',
  mid: '#1f9e9e',
  offshore: '#2f6fd0',
  deep: '#5b3fb0',
};

export const VIEWBOX = { w: 900, h: 560 };
