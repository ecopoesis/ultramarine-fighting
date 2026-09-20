import type { PortConfig, Ground } from './types';

// THE MAPS. Kept out of config.ts so a reshape is a one-line swap and the previous
// geometry is never lost — the bay has been reshaped twice now and each time the old
// version was worth keeping to compare against.
//
// A map is a graph: `nodes` (ports, shelters and fishing grounds) joined by `edges`.
// Tier sizes matter to the rest of the game — the storm die picks a ground within a
// tier, so the mid and offshore rings want to be six.

export interface MapConfig {
  nodes: Record<string, { type: 'port' | 'ground'; ground?: Ground; port?: PortConfig; label?: string }>;
  edges: [string, string][];
  fuelPerStep: number;
  startPort: string;
  landmarks?: { name: string; near: string }[];
}

// Shared economics, so a reshape does not silently re-tune the markets as well.
const ROCKLAND_PORT: PortConfig = { fuelCostPerUnit: 1, market: { base: 5, dropPerLbs: 2, floor: 2, rareBonus: 0, coopRep: 3, coopMinLb: 5 } };
const VINALHAVEN_PORT: PortConfig = { fuelCostPerUnit: 2, market: { base: 7, dropPerLbs: 1, floor: 3, rareBonus: 1 } };
const STONINGTON_PORT: PortConfig = { fuelCostPerUnit: 2, market: { base: 6, dropPerLbs: 3, floor: 3, rareBonus: 1 } };
const SHELTER: PortConfig = { fuelCostPerUnit: 4, shelter: true };

// ---------------------------------------------------------------------------
// v3 — the ABSTRACT bay: concentric depth rings, sized so a d6 picks a ground in
// any tier. Clean to reason about and to tune; the node names were flavour laid
// over a ring structure rather than real water. Every balance number through
// 2026-09-19 was measured on this. Kept for comparison.
// ---------------------------------------------------------------------------
export const bayV3: MapConfig = {
  nodes: {
    // --- market ports (dock: refuel/berth AND sell) ---
    ROCKLAND:   { type: 'port', label: 'Rockland', port: {
      fuelCostPerUnit: 1, market: { base: 5, dropPerLbs: 2, floor: 2, rareBonus: 0, coopRep: 3, coopMinLb: 5 } } }, // THE CO-OP: pays least per lb, but landing a real day's catch here (5lb+) earns standing   // SW mainland: cheap fuel but its price now CRASHES when everyone dumps inshore catch here — pushes selling (and fishing) outward
    VINALHAVEN: { type: 'port', label: 'Vinalhaven', port: {
      fuelCostPerUnit: 2, market: { base: 7, dropPerLbs: 1, floor: 3, rareBonus: 1 } } },     // island: high price, floods fast, dear fuel, the offshore springboard
    STONINGTON: { type: 'port', label: 'Stonington', port: {
      fuelCostPerUnit: 2, market: { base: 6, dropPerLbs: 3, floor: 3, rareBonus: 1 } } },   // eastern premium, near the mid grounds

    // --- shelters (refuge + emergency fuel, NO market) — stage the outer run ---
    MONHEGAN:   { type: 'port', label: 'Monhegan', port: { fuelCostPerUnit: 4, shelter: true } },  // SW lighthouse, by the outer-west water
    MATINICUS:  { type: 'port', label: 'Matinicus', port: { fuelCostPerUnit: 4, shelter: true } },  // outermost, a stone's throw from the deep edge

    // --- fishing zones (share their ground TYPE's bag) ---
    // inshore ring (4) — up-bay, safe, off Rockland
    INSHORE_W:  { type: 'ground', ground: 'inshore', label: 'Muscle Ridge' },
    INSHORE_N:  { type: 'ground', ground: 'inshore', label: 'Upper Bay' },
    INSHORE_E:  { type: 'ground', ground: 'inshore', label: 'Owls Head' },
    INSHORE_S:  { type: 'ground', ground: 'inshore', label: 'Mussel Shoals' },
    // mid ring (6) — the island belt
    MID_W:      { type: 'ground', ground: 'mid', label: 'West Bay' },
    MID_NW:     { type: 'ground', ground: 'mid', label: 'Hurricane Sound' },
    MID_N:      { type: 'ground', ground: 'mid', label: 'Fox Islands' },
    MID_C:      { type: 'ground', ground: 'mid', label: 'Seal Bay' },
    MID_E:      { type: 'ground', ground: 'mid', label: 'Eggemoggin Reach' },
    MID_SE:     { type: 'ground', ground: 'mid', label: 'Isle au Haut' },
    // offshore ring (6) — the outer water
    OFF_W:      { type: 'ground', ground: 'offshore', label: 'Outer West' },
    OFF_NW:     { type: 'ground', ground: 'offshore', label: 'Two Bush' },
    OFF_N:      { type: 'ground', ground: 'offshore', label: 'Large Green' },
    OFF_C:      { type: 'ground', ground: 'offshore', label: 'Seal Ledge' },
    OFF_E:      { type: 'ground', ground: 'offshore', label: 'Outer East' },
    OFF_SE:     { type: 'ground', ground: 'offshore', label: 'Saddleback' },
    // the deep edge (1) — richest, farthest, fouls fast
    DEEP_EDGE:  { type: 'ground', ground: 'deep', label: 'The Edge' },
  },
  edges: [
    // inshore ring (W–N–E–S) off Rockland
    ['ROCKLAND', 'INSHORE_W'],
    ['ROCKLAND', 'INSHORE_N'],
    ['INSHORE_W', 'INSHORE_N'],
    ['INSHORE_N', 'INSHORE_E'],
    ['INSHORE_E', 'INSHORE_S'],
    ['INSHORE_S', 'INSHORE_W'],
    // inshore → mid radials
    ['INSHORE_W', 'MID_W'],
    ['INSHORE_N', 'MID_N'],
    ['INSHORE_E', 'MID_E'],
    ['INSHORE_S', 'MID_SE'],
    // mid ring (6-cycle) + its ports
    ['MID_W', 'MID_NW'],
    ['MID_NW', 'MID_N'],
    ['MID_N', 'MID_C'],
    ['MID_C', 'MID_E'],
    ['MID_E', 'MID_SE'],
    ['MID_SE', 'MID_W'],
    ['VINALHAVEN', 'MID_C'],
    ['STONINGTON', 'MID_E'],
    ['STONINGTON', 'MID_SE'],
    // mid → offshore radials (+ the island morning run)
    ['MID_W', 'OFF_W'],
    ['MID_N', 'OFF_N'],
    ['MID_C', 'OFF_C'],
    ['MID_E', 'OFF_E'],
    ['VINALHAVEN', 'OFF_SE'],   // the morning run — 1 step off the island
    // offshore ring (6-cycle) + its shelter
    ['OFF_W', 'OFF_NW'],
    ['OFF_NW', 'OFF_N'],
    ['OFF_N', 'OFF_C'],
    ['OFF_C', 'OFF_E'],
    ['OFF_E', 'OFF_SE'],
    ['OFF_SE', 'OFF_W'],
    ['MONHEGAN', 'OFF_W'],
    ['MONHEGAN', 'OFF_NW'],
    // the deep edge (only through the offshore water) + outer shelter
    ['OFF_C', 'DEEP_EDGE'],
    ['OFF_SE', 'DEEP_EDGE'],
    ['MATINICUS', 'DEEP_EDGE'],
    ['MATINICUS', 'OFF_SE'],
  ],
  fuelPerStep: 1,
  startPort: 'ROCKLAND',
  // decorative — flavor only, no gameplay (a future UI can scatter these)
  landmarks: [
    { name: 'Saddleback Ledge', near: 'OFF_SE' },
    { name: 'Goose Rocks', near: 'MID_C' },
    { name: 'Eagle Island', near: 'MID_E' },
    { name: 'Heron Neck Light', near: 'VINALHAVEN' },
  ],
};

// ---------------------------------------------------------------------------
// v4 — the REAL bay. Penobscot Bay as it actually is, mapped by the designer:
// real grounds, real islands, real lights, and the connections that genuinely
// exist between them. It is markedly more interconnected than the ring map (43
// edges against 36) because real water is — you can get to most places more than
// one way. Tier sizes are unchanged, so everything downstream still works.
//
// Three structural differences from v3 worth knowing when the numbers move:
//  - MATINICUS is a fishing ground here, not a shelter. The refuges are the two
//    lights, Monhegan and Mount Desert.
//  - Neither light sits next to the deep, where v3's Matinicus was one step from
//    it. Forward-basing on the deep run is harder.
//  - The Gulf of Maine is five steps from Rockland, as in v3 — but only because the
//    Seal Island link to it was cut; the raw geography put it at four.
// ---------------------------------------------------------------------------
export const bayV4: MapConfig = {
  nodes: {
    // --- market ports ---
    ROCKLAND: { type: 'port', label: 'Rockland', port: ROCKLAND_PORT },
    VINALHAVEN: { type: 'port', label: 'Vinalhaven', port: VINALHAVEN_PORT },
    STONINGTON: { type: 'port', label: 'Stonington', port: STONINGTON_PORT },

    // --- refuges: the lights. Shelter and emergency fuel, no market, never storm ---
    MONHEGAN: { type: 'port', label: 'Monhegan Light', port: SHELTER },
    MT_DESERT: { type: 'port', label: 'Mount Desert Light', port: SHELTER },

    // --- inshore (4): up-bay, safe, never storms ---
    MUSCLE_RIDGE: { type: 'ground', ground: 'inshore', label: 'Muscle Ridge' },
    OWLS_HEAD: { type: 'ground', ground: 'inshore', label: "Owl's Head" },
    PENOBSCOT: { type: 'ground', ground: 'inshore', label: 'Penobscot' },
    RESOLUTION: { type: 'ground', ground: 'inshore', label: 'Resolution' },

    // --- mid (6): the island belt ---
    METINIC: { type: 'ground', ground: 'mid', label: 'Metinic Island' },
    HURRICANE: { type: 'ground', ground: 'mid', label: 'Hurricane Sound' },
    SEAL_BAY: { type: 'ground', ground: 'mid', label: 'Seal Bay' },
    EGGEMOGGIN: { type: 'ground', ground: 'mid', label: 'Eggemoggin' },
    SEAL_COVE: { type: 'ground', ground: 'mid', label: 'Seal Cove' },
    MATINICUS: { type: 'ground', ground: 'mid', label: 'Matinicus' },

    // --- offshore (6): the outer water ---
    TOOTHACKER: { type: 'ground', ground: 'offshore', label: 'Toothacker Ridge' },
    SKATE_BANK: { type: 'ground', ground: 'offshore', label: 'Skate Bank' },
    SEAL_ISLAND: { type: 'ground', ground: 'offshore', label: 'Seal Island' },
    ISLE_AU_HAUT: { type: 'ground', ground: 'offshore', label: 'Isle au Haut' },
    SWANS_ISLAND: { type: 'ground', ground: 'offshore', label: 'Swans Island' },
    FRENCHBORO: { type: 'ground', ground: 'offshore', label: 'Frenchboro' },

    // --- the deep (1) ---
    GULF_OF_MAINE: { type: 'ground', ground: 'deep', label: 'Gulf of Maine' },
  },
  edges: [
    // out of the ports
    ['ROCKLAND', 'MUSCLE_RIDGE'], ['ROCKLAND', 'OWLS_HEAD'],
    ['STONINGTON', 'RESOLUTION'], ['STONINGTON', 'EGGEMOGGIN'], ['STONINGTON', 'ISLE_AU_HAUT'], ['STONINGTON', 'SEAL_BAY'],
    ['VINALHAVEN', 'OWLS_HEAD'], ['VINALHAVEN', 'RESOLUTION'], ['VINALHAVEN', 'SEAL_BAY'], ['VINALHAVEN', 'SEAL_ISLAND'], ['VINALHAVEN', 'HURRICANE'],
    // inshore
    ['MUSCLE_RIDGE', 'OWLS_HEAD'], ['MUSCLE_RIDGE', 'METINIC'],
    ['OWLS_HEAD', 'HURRICANE'], ['OWLS_HEAD', 'PENOBSCOT'],
    ['PENOBSCOT', 'RESOLUTION'],
    ['RESOLUTION', 'SEAL_BAY'], ['RESOLUTION', 'EGGEMOGGIN'],
    // the island belt
    ['METINIC', 'HURRICANE'], ['METINIC', 'MATINICUS'], ['METINIC', 'TOOTHACKER'],
    ['HURRICANE', 'SEAL_ISLAND'], ['HURRICANE', 'MATINICUS'],
    ['SEAL_BAY', 'EGGEMOGGIN'], ['SEAL_BAY', 'SWANS_ISLAND'], ['SEAL_BAY', 'ISLE_AU_HAUT'],
    ['EGGEMOGGIN', 'SEAL_COVE'], ['EGGEMOGGIN', 'SWANS_ISLAND'],
    ['SEAL_COVE', 'SWANS_ISLAND'],
    ['MATINICUS', 'SEAL_ISLAND'], ['MATINICUS', 'TOOTHACKER'],
    // the outer water
    ['TOOTHACKER', 'SKATE_BANK'], ['TOOTHACKER', 'MONHEGAN'],
    ['SKATE_BANK', 'SEAL_ISLAND'], ['SKATE_BANK', 'GULF_OF_MAINE'], ['SKATE_BANK', 'MONHEGAN'],
    ['SEAL_ISLAND', 'ISLE_AU_HAUT'],
    // NB no Seal Island -> Gulf of Maine. With it, the deep sat FOUR steps from
    // Rockland and was closer than two shallower grounds; the only ways out to the
    // Gulf are now Skate Bank and Isle au Haut, which puts it back at five and makes
    // it the farthest water on the board again.
    // (Vinalhaven -> Seal Island was also considered and NOT removed: Owl's Head ->
    // Hurricane Sound -> Seal Island is exactly as short, so cutting it moves no
    // distance at all — it would only cost Vinalhaven its morning run to the outer
    // water, which v3 had on purpose.)
    ['ISLE_AU_HAUT', 'SWANS_ISLAND'], ['ISLE_AU_HAUT', 'GULF_OF_MAINE'],
    ['SWANS_ISLAND', 'FRENCHBORO'], ['SWANS_ISLAND', 'MT_DESERT'],
    ['FRENCHBORO', 'MT_DESERT'],
  ],
  fuelPerStep: 1,
  startPort: 'ROCKLAND',
  landmarks: [
    { name: 'Heron Neck Light', near: 'VINALHAVEN' },
    { name: 'Saddleback Ledge', near: 'ISLE_AU_HAUT' },
    { name: 'Brimstone Island', near: 'SEAL_BAY' },
    { name: 'Two Bush Light', near: 'MUSCLE_RIDGE' },
  ],
};
