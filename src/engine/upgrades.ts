import type { GameState, PlayerState, UpgradeDef } from '../types';
import { randInt, takeRandom } from '../rng';
import { alignmentOn, bandOf, stepAlignment } from './alignment';
import { capCheck } from './patrol';

// Inlined (not imported from ./ports) so this module depends only on types + rng —
// movement.ts imports the capability queries here, and ./ports imports movement, so
// pulling ports in would make a cycle.
const isMarketPort = (d: GameState, node: string): boolean => !!d.config.map.nodes[node]?.port?.market;
const marketPorts = (d: GameState): string[] => Object.keys(d.config.map.nodes).filter((n) => d.config.map.nodes[n].port?.market);

// Ship upgrades — the engine-building layer. A player's ship has three slots
// (stern / midPrimary / midSecondary); each installed refit grants a capability,
// read here by derived queries the rest of the engine calls. Inert when the flag
// is off (no stock, no BUY offered, every query returns its base value), so seeds
// and existing tuning are untouched.

export function upgradesOn(d: GameState): boolean {
  return d.config.flags.upgrades;
}

function catalog(d: GameState): Record<string, UpgradeDef> {
  const out: Record<string, UpgradeDef> = {};
  for (const u of d.config.upgrades.catalog) out[u.id] = u;
  return out;
}

export function upgradeDef(d: GameState, id: string): UpgradeDef | undefined {
  return d.config.upgrades.catalog.find((u) => u.id === id);
}

function installed(d: GameState, p: PlayerState): UpgradeDef[] {
  if (!upgradesOn(d)) return [];
  const cat = catalog(d);
  return Object.values(p.upgrades).map((id) => cat[id!]).filter(Boolean) as UpgradeDef[];
}

// ---- derived capabilities (the effects) ----
export function stepsPerSteam(d: GameState, p: PlayerState): number {
  return Math.max(1, ...installed(d, p).map((u) => u.stepsPerSteam ?? 1));
}
export function isStormImmune(d: GameState, p: PlayerState): boolean {
  return installed(d, p).some((u) => u.stormImmune);
}
// A plotter marks your gear, so a parted pot is found again rather than lost.
export function recoversParted(d: GameState, p: PlayerState): boolean {
  return installed(d, p).some((u) => u.whittleRecover);
}
// Does any installed refit make this action type free (0 actions)?
export function freesAction(d: GameState, p: PlayerState, type: string): boolean {
  return installed(d, p).some((u) => u.freeAction === type);
}
export function fuelCap(d: GameState, p: PlayerState): number {
  return d.config.fuelTankMax + installed(d, p).reduce((s, u) => s + (u.fuelBonus ?? 0), 0);
}
export function buoyCap(d: GameState, p: PlayerState): number {
  return d.config.buoysPerPlayer + installed(d, p).reduce((s, u) => s + (u.buoyBonus ?? 0), 0);
}

// ---- supply / display ----
// Seed each market port's chandlery with a random draw from the catalog.
export function generateUpgradeStock(d: GameState): void {
  d.upgradeStock = {};
  if (!upgradesOn(d)) return;
  const cat = d.config.upgrades.catalog.filter((u) => !u.dark); // the black market is not at the chandlery
  for (const port of marketPorts(d)) {
    const stock: string[] = [];
    for (let i = 0; i < d.config.upgrades.perPortStock; i++) stock.push(cat[randInt(d, cat.length)].id);
    d.upgradeStock[port] = stock;
  }
  // The black-market stack: one of each dark refit per dark slot at this table.
  if (alignmentOn(d)) {
    const n = Object.keys(d.players).length;
    const slots = d.config.alignment.darkSlotsByPlayers[Math.min(n, d.config.alignment.darkSlotsByPlayers.length - 1)] ?? 0;
    d.darkStock = [];
    for (let i = 0; i < slots; i++) d.darkStock.push(...d.config.alignment.darkRefits);
  }
}

// Black-market refits this captain could buy here (distinct ids).
export function darkOffer(d: GameState, p: PlayerState): string[] {
  if (!upgradesOn(d) || !alignmentOn(d) || !isMarketPort(d, p.node) || !bandOf(d, p).blackMarket) return [];
  return [...new Set(d.darkStock ?? [])];
}

// Extra tiles drawn per haul (the illegal net).
export function bonusDraws(d: GameState, p: PlayerState): number {
  return installed(d, p).reduce((s, u) => s + (u.bonusDraws ?? 0), 0);
}

// The cheap engine's exhaust: strip tiles off a ground after each haul you make there.
export function pollute(d: GameState, p: PlayerState, ground: keyof GameState['bags']): void {
  const n = installed(d, p).reduce((s, u) => s + (u.pollutes ?? 0), 0);
  for (let i = 0; i < n; i++) {
    const t = takeRandom(d, d.bags[ground]);
    if (t) d.piles[ground].push(t);
  }
  if (n > 0) d.log.push(`${p.name}'s cheap engine fouls the ${ground} water (${n} lobster gone)`);
}

// The face-up refits at a port right now (the front of its deck).
export function upgradeDisplay(d: GameState, port: string): string[] {
  return (d.upgradeStock[port] ?? []).slice(0, d.config.upgrades.display);
}

// Can this player install `id` here right now? (at this market port, it's face-up,
// the slot is free, and they can afford it).
export function canBuyUpgrade(d: GameState, p: PlayerState, id: string): boolean {
  if (!upgradesOn(d) || !isMarketPort(d, p.node)) return false;
  const def = upgradeDef(d, id);
  if (!def) return false;
  if (def.dark ? !darkOffer(d, p).includes(id) : !upgradeDisplay(d, p.node).includes(id)) return false; // face-up here, or in the back room
  if (p.upgrades[def.slot]) return false;                    // slot already taken (no re-refit)
  return p.money >= def.cost;
}

// Install a refit: pay, occupy the slot, pull the token from the port's display,
// and apply any immediate effect (cargo adds a buoy right away).
export function buyUpgrade(d: GameState, pid: string, id: string): void {
  const p = d.players[pid];
  const def = upgradeDef(d, id);
  if (!def) throw new Error(`unknown upgrade ${id}`);
  if (!canBuyUpgrade(d, p, id)) throw new Error(`cannot buy ${id} here`);
  p.money -= def.cost;
  p.upgrades[def.slot] = id;
  const stock = def.dark ? d.darkStock! : d.upgradeStock[p.node];
  const idx = stock.indexOf(id);
  if (idx >= 0) stock.splice(idx, 1); // pull it from the deck (the next one slides face-up)
  if (def.dark) {
    stepAlignment(d, p, d.config.alignment.step.darkRefit, `bought ${def.label.toLowerCase()} on the black market`, 1);
    capCheck(d, p, 0);
  }
  if (def.buoyBonus) p.buoysAvailable += def.buoyBonus; // more hold space, right now
  d.log.push(`${p.name} refits: ${def.label} (-${def.cost} money) at ${p.node}`);
}
