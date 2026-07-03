import { defaultConfig } from '../src/config';
import { runTournament, ARCHES } from '../src/bots/tournament';
import type { Config } from '../src/types';

// Dial #4 — v-token strength. insuranceDraws = 0 turns the mechanic OFF (tokens
// are pure end-VP); higher makes a spent token a more reliable rescue of a lean
// haul. SPEC §12.4: too weak ⇒ conservation is mere flavor; too strong ⇒ eggers
// hoarded / over-extraction. Watch the steward (the token farmer) and bag health.

const DRAWS = [0, 1, 2, 3];

function build(insuranceDraws: number): Config {
  return { ...defaultConfig, vToken: { ...defaultConfig.vToken, insuranceDraws } };
}

const seeds = Number(process.argv[2] ?? 120);
const rows: any[] = [];
for (const insuranceDraws of DRAWS) {
  const { byArch, healthSum, games } = runTournament(build(insuranceDraws), seeds);
  const pct = (a: (typeof ARCHES)[number]) => (byArch[a].wins / Math.max(1, byArch[a].games)) * 100;
  const per = (a: (typeof ARCHES)[number], k: 'moneyVP' | 'conservationVP') => byArch[a][k] / Math.max(1, byArch[a].games);
  rows.push({
    insuranceDraws: insuranceDraws === 0 ? 'off(0)' : insuranceDraws,
    'S%': pct('steward').toFixed(0), 'G%': pct('greedy').toFixed(0), 'T%': pct('thief').toFixed(0),
    'S conserv': per('steward', 'conservationVP').toFixed(1),
    'S money': per('steward', 'moneyVP').toFixed(1),
    'health%': ((healthSum / games) * 100).toFixed(1),
  });
}

console.log(`v-token strength sweep (dial #4) — ${seeds} seeds × ${ARCHES.length} rotations, geometricMean`);
console.log('insuranceDraws 0 = mechanic off. Watch steward win%/conservation and bag health.\n');
console.table(rows);
