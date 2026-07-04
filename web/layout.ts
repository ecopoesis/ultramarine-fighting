// Hand-authored map coordinates for the Penobscot Bay graph (v3). North/up-bay
// (inshore, safe) at the top; the water deepens south into the open Gulf (deep at
// the bottom). Purely presentational — the engine's edges drive the topology.
export const NODE_XY: Record<string, { x: number; y: number }> = {
  // ports
  ROCKLAND: { x: 70, y: 120 },
  STONINGTON: { x: 820, y: 175 },
  VINALHAVEN: { x: 500, y: 305 },
  MONHEGAN: { x: 95, y: 445 },
  MATINICUS: { x: 430, y: 585 },
  // inshore ring (up-bay, safe)
  INSHORE_W: { x: 235, y: 70 },
  INSHORE_N: { x: 400, y: 55 },
  INSHORE_E: { x: 560, y: 80 },
  INSHORE_S: { x: 360, y: 165 },
  // mid ring (island belt)
  MID_W: { x: 185, y: 230 },
  MID_NW: { x: 315, y: 190 },
  MID_N: { x: 450, y: 205 },
  MID_C: { x: 470, y: 260 },
  MID_E: { x: 665, y: 210 },
  MID_SE: { x: 700, y: 290 },
  // offshore ring (outer water)
  OFF_W: { x: 210, y: 385 },
  OFF_NW: { x: 320, y: 350 },
  OFF_N: { x: 455, y: 370 },
  OFF_C: { x: 520, y: 420 },
  OFF_E: { x: 675, y: 375 },
  OFF_SE: { x: 575, y: 475 },
  // the deep edge (richest, farthest)
  DEEP_EDGE: { x: 545, y: 555 },
};

export const TIER_COLOR: Record<string, string> = {
  inshore: '#3f9d54',
  mid: '#1f9e9e',
  offshore: '#2f6fd0',
  deep: '#5b3fb0',
};

export const VIEWBOX = { w: 900, h: 640 };
