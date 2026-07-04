import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { avgBagHealth } from '../src/engine/scoring';
import { BOTS, ROSTER, makeCardCounter } from '../src/bots';
import { report, type Named } from './tuneArchetypes';
import type { Config, GameState, Ground } from '../src/types';

// Days-escalation x seeded-lobster instrument. Two questions:
//   1. Do seeded lobsters pull the fleet across the WHOLE map (more distinct spaces
//      fished, unfished corners drained)? That's the mechanic's whole point.
//   2. How much do longer seasons + the seeded injection tilt the economy/health —
//      i.e. how must restock.dieFaces move to hold commons health?
const N = Number(process.argv[2] ?? 20);
const PLAYERS = Number(process.argv[3] ?? 6);
const MODE = process.argv[4] ?? 'probe'; // 'probe' (map/economy) | 'arena' (roster balance)

const SCHEDULES: Record<string, number[] | undefined> = {
  flat5: undefined,           // the current flat daysPerSeason: 5
  base4: [4, 5, 6, 7, 8],
  base5: [5, 6, 7, 8, 9],
  mild4: [4, 5, 5, 6, 6],     // capped escalation — ranging time without the runaway 7-8-day late seasons
  mild5: [5, 5, 6, 6, 6],
};
const grounds = Object.keys(defaultConfig.bags) as Ground[];
const spaceCount = Object.values(defaultConfig.map.nodes).filter((n) => n.type === 'ground').length;

function cfgOf(schedule: number[] | undefined, seeded: boolean): Config {
  return {
    ...defaultConfig,
    daysSchedule: schedule,
    flags: { ...defaultConfig.flags, seeded },
  };
}

const tierOf = (s: GameState, node: string) => s.config.map.nodes[node].ground!;
const f1 = (x: number) => (x / N).toFixed(1);
const f2 = (x: number) => (x / N).toFixed(2);

// Homogeneous card-counter table: map spread + economy under a given config.
function probe(label: string, cfg: Config) {
  let distinctNodes = 0, seededPulled = 0, seededLb = 0, money = 0, health = 0, games = 0;
  const drops: Record<Ground, number> = { inshore: 0, mid: 0, offshore: 0, deep: 0 };
  for (let i = 0; i < N; i++) {
    let s = createInitialState({ ...cfg, players: 3 }, 1000 + i);
    const hauledNodes = new Set<string>();
    let guard = 0;
    while (s.phase !== 'GAME_OVER' && guard++ < 300000) {
      const pid = activePlayerId(s);
      const from = s.players[pid].node;
      const a = BOTS.cardcounter(s, pid, legalActions(s, pid));
      if (a.type === 'DROP') drops[tierOf(s, from)]++;
      if (a.type === 'HAUL' || a.type === 'STEAL') hauledNodes.add(from);
      const before = s.log.length;
      s = reduce(s, a);
      for (let k = before; k < s.log.length; k++) {
        const m = s.log[k].match(/pulls (\d+) seeded/);
        if (m) { seededPulled += +m[1]; seededLb += +m[1] * cfg.seeded.weightLb; }
      }
    }
    distinctNodes += hauledNodes.size;
    money += Object.values(s.players).reduce((x, p) => x + p.money, 0) / 3;
    health += avgBagHealth(s);
    games++;
  }
  console.log(
    `${label.padEnd(16)} | mapUsed ${f1(distinctNodes)}/${spaceCount}` +
    ` | seededPull ${f1(seededPulled)} (${f1(seededLb)}lb) | money/boat ${f1(money)} | health ${(100 * health / N).toFixed(0)}%` +
    ` | drops i/m/o/d ${f1(drops.inshore)}/${f1(drops.mid)}/${f1(drops.offshore)}/${f1(drops.deep)}`,
  );
}

if (MODE === 'probe') {
  console.log(`=== Map-usage + economy probe (${N} seeds, homogeneous 3-boat card-counter) ===`);
  console.log(`(mapUsed = distinct fishing spaces hauled per game, of ${spaceCount}; higher = more of the map worked)\n`);
  for (const [name, sched] of Object.entries(SCHEDULES)) {
    probe(`${name}/dry`, cfgOf(sched, false));
    probe(`${name}/seed`, cfgOf(sched, true));
  }
} else {
  // Roster balance for a specific schedule (arg 5) x seeded (arg 6)
  const sched = SCHEDULES[process.argv[5] ?? 'base4'];
  const seeded = (process.argv[6] ?? 'on') === 'on';
  const fleet: Named[] = ROSTER.map((a) => ({ name: a.name, policy: makeCardCounter(a) }));
  report(`roster ${process.argv[5] ?? 'base4'}/${seeded ? 'seed' : 'dry'} — ${PLAYERS}p`, cfgOf(sched, seeded), N, fleet, PLAYERS);
}
