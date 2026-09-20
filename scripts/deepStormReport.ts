import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Deep-water and storm interaction, replayed from the game LOGS so runs on different
// configs and different maps stay comparable. Boat positions are tracked from the
// steam/berth lines, so a haul can be attributed to the exact node it happened on and
// checked against that season's storm map — rather than inferred from how much it
// landed, which undercounts badly once the bags are stripped.
const DEEP = new Set(['DEEP_EDGE', 'GULF_OF_MAINE']);
const REFUGE = new Set(['MONHEGAN', 'MATINICUS', 'MT_DESERT']);

interface R { run: string; games: number; drops: number; deepDrops: number; hauls: number; deepHauls: number;
  stormHauls: number; stormDrops: number; beatings: number; parted: number; refugeNights: number; refugeFuel: number }

const rows: R[] = [];
for (const run of process.argv.slice(2)) {
  const dir = `tournament/runs/${run}/games`;
  if (!existsSync(dir)) continue;
  const r: R = { run, games: 0, drops: 0, deepDrops: 0, hauls: 0, deepHauls: 0, stormHauls: 0, stormDrops: 0, beatings: 0, parted: 0, refugeNights: 0, refugeFuel: 0 };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.log'))) {
    r.games++;
    let stormed = new Set<string>();
    const at: Record<string, string> = {};   // captain -> node
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      let m = line.match(/^Storm map \(S\d+\): (.+)$/);
      if (m) { stormed = new Set(m[1].split(', ').map((x) => x.trim())); continue; }
      m = line.match(/^(.+?) steams to (\w+)/);
      if (m) { at[m[1]] = m[2]; continue; }
      m = line.match(/^(.+?) is towed in to (\w+)/);
      if (m) { at[m[1]] = m[2]; continue; }
      m = line.match(/^(.+?) drops buoy \w+ at (\w+)/);
      if (m) { at[m[1]] = m[2]; r.drops++; if (DEEP.has(m[2])) r.deepDrops++; if (stormed.has(m[2])) r.stormDrops++; continue; }
      m = line.match(/^(.+?) hauls \(/);
      if (m) {
        const node = at[m[1]];
        r.hauls++;
        if (node && DEEP.has(node)) r.deepHauls++;
        if (node && stormed.has(node)) r.stormHauls++;
        continue;
      }
      m = line.match(/^(.+?) berths at (\w+)/);
      if (m) { at[m[1]] = m[2]; if (REFUGE.has(m[2])) r.refugeNights++; continue; }
      m = line.match(/^(.+?) refuels \d+ at (\w+)/);
      if (m) { if (REFUGE.has(m[2])) r.refugeFuel++; continue; }
      if (/takes a beating in the storm/.test(line)) { r.beatings++; continue; }
      if (/^Storm parts /.test(line)) r.parted++;
    }
  }
  rows.push(r);
}

const p = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const g = (a: number, n: number) => (n ? (a / n).toFixed(1) : '—');
console.log('map     run      games |  DEEP drops    DEEP hauls  | STORM drops   STORM hauls | beatings  parted | refuge nights  fuel');
console.log('----------------------+----------------------------+---------------------------+------------------+--------------------');
for (const r of rows) {
  const map = DEEP.has('GULF_OF_MAINE') && r.run === 'opus8' ? 'v4 real' : 'v3 ring';
  console.log(
    `${map.padEnd(8)}${r.run.padEnd(8)} ${String(r.games).padStart(5)} | ` +
    `${p(r.deepDrops, r.drops).padStart(6)} ${g(r.deepDrops, r.games).padStart(5)}/g  ${p(r.deepHauls, r.hauls).padStart(6)} ${g(r.deepHauls, r.games).padStart(4)}/g | ` +
    `${p(r.stormDrops, r.drops).padStart(6)} ${g(r.stormDrops, r.games).padStart(4)}/g  ${p(r.stormHauls, r.hauls).padStart(6)} ${g(r.stormHauls, r.games).padStart(4)}/g | ` +
    `${g(r.beatings, r.games).padStart(8)} ${g(r.parted, r.games).padStart(7)} | ${g(r.refugeNights, r.games).padStart(13)} ${g(r.refugeFuel, r.games).padStart(5)}`,
  );
}
