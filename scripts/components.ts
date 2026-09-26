import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultConfig } from '../src/config';
import { tileTemplate } from '../src/tiles';
import type { Config, Ground } from '../src/types';
import { FONTS, BASE_CSS } from './lib/docStyle';
import { actionLines } from './lib/actionsText';

// THE COMPONENT MANIFEST — everything that goes in the box, generated FROM src/config.ts
// so it can never drift from the rules the engine actually plays. Counts are quoted at
// the maximum table size, since the box has to hold the biggest game.
//   npx tsx scripts/components.ts [outfile]

const cfg: Config = defaultConfig;
const MAX_PLAYERS = 6;
// THE SWITCHBOARD (SPEC §14): with flags.alignment the three score tracks give way to
// one alignment track and a heat track, money is the only score, and a band card,
// heat dice and a black-market stack go in the box.
const al = cfg.flags.alignment;
const darkSlots = (n: number) => cfg.alignment.darkSlotsByPlayers[Math.min(n, cfg.alignment.darkSlotsByPlayers.length - 1)] ?? 0;
const darkRefits = cfg.upgrades.catalog.filter((u) => u.dark);
// Spare generic lobsters for breeding top-ups from empty traps (counterfactual: about 5-10 a game).
const GENERIC_SPARE = 30;
// The refit slots as printed on the mat (the engine's ids are stern / midPrimary / midSecondary).
const SLOT: Record<string, string> = { stern: 'stern', midPrimary: 'amidships', midSecondary: 'deck' };
const deckRefits = cfg.upgrades.catalog.filter((u) => !u.dark || !al);
const scale = MAX_PLAYERS / cfg.referencePlayers;
const GROUNDS: Ground[] = ['inshore', 'mid', 'offshore', 'deep'];
const cap = (s: string) => s[0] + s.slice(1).toLowerCase();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Row { qty: string; part: string; text?: string; note?: string }
interface Group { id: string; title: string; blurb: string; rows: Row[]; total?: string }

// ---------- the board ----------
const nodes = Object.entries(cfg.map.nodes);
const markets = nodes.filter(([, n]) => n.port?.market);
const shelters = nodes.filter(([, n]) => n.port && !n.port.market);
const grounds = nodes.filter(([, n]) => n.type === 'ground');
const tierCount = (g: Ground) => grounds.filter(([, n]) => n.ground === g).length;

const boardRows: Row[] = [];
boardRows.push({
  qty: '1',
  part: 'Game board — Penobscot Bay',
  text: `${nodes.length} spaces joined by ${cfg.map.edges.length} sea lanes. ${cfg.map.fuelPerStep} fuel per lane.`,
  note: `Four depth tiers running south into the Gulf: inshore ${tierCount('inshore')} · mid ${tierCount('mid')} · offshore ${tierCount('offshore')} · deep ${tierCount('deep')}.`,
});
for (const [id, n] of markets) {
  const m = n.port!.market!;
  boardRows.push({
    qty: '—',
    part: `${n.label} (market port)`,
    text: `${m.base}/lb · −1/lb for every ${m.dropPerLbs} lb landed today · floor ${m.floor}/lb${m.rareBonus ? ` · rare +${m.rareBonus}/lb` : ''} · fuel ${n.port!.fuelCostPerUnit}/unit${m.coopRep ? (al ? ` · CO-OP: land ${m.coopMinLb}lb+ to step +${cfg.alignment.step.coopLanding} lighter (licensed, Neutral or lighter)` : ` · CO-OP: land ${m.coopMinLb}lb+ for +${m.coopRep} reputation`) : ''}`,
  });
}
for (const [, n] of shelters) {
  boardRows.push({ qty: '—', part: `${n.label} (shelter)`, text: `Refuge and emergency fuel at ${n.port!.fuelCostPerUnit}/unit. No market. Never storms.` });
}
boardRows.push({
  qty: '—',
  part: 'Fishing grounds',
  text: grounds.map(([id, n]) => `${n.label} (${n.ground})`).join(' · '),
  note: `Each ground holds at most ${cfg.maxPotsPerSpace} pots per ${cfg.referencePlayers} players — ${Math.round(cfg.maxPotsPerSpace * scale)} at a ${MAX_PLAYERS}-player table — counting every captain's.`,
});
boardRows.push({
  qty: '—',
  part: 'Season track (printed on board)',
  text: (cfg.daysSchedule ?? []).map((d, i) => `Season ${i + 1}: ${d} days`).join('  ·  '),
  note: `Licence reserve each season: ${cfg.licensePerSeason.map((f, i) => `S${i + 1} ${f === 0 ? 'free with the boat' : f}`).join(' · ')}`,
});
boardRows.push({
  qty: '—',
  part: 'Weather escalation track (printed on board)',
  text: cfg.weather.track.map((t, i) => `S${i + 1}: ${t.inshore}/${t.mid}/${t.offshore}/${t.deep}`).join('  ·  '),
  note: 'Storms placed per tier (inshore / mid / offshore / deep) at each season change. Inshore never storms.',
});
boardRows.push({
  qty: '—',
  part: 'Breeding stock tracks (printed on board, one per ground)',
  text: GROUNDS.join(' · '),
  note: `${cfg.breeding.mode === 'breeders' ? "Starts FULL at the ground's egger count; drop it one step every time a captain keeps an egger from that ground (or the cheap engine's pollution takes one) (raise it one if a spawn draws a kept egger back out of the trap)." : "Advance a ground's track one step every time a berried female is v-notched and released there."} Public. At each season change the stock spawns from it. Longest track needed: ${GROUNDS.map((g) => Math.round((cfg.bags[g].EGGER ?? 0) * scale)).reduce((a, b) => Math.max(a, b), 0)} steps, the most eggers any one bag holds at ${MAX_PLAYERS} players.`,
});
boardRows.push(al
  ? { qty: '—', part: 'Berth order track (printed on board)', text: `${MAX_PLAYERS} numbered slots, filled in arrival order — tomorrow's turn order. Free. Shady and Outlaw captains may bribe the harbourmaster (${cfg.bribeMoneyCost} money, one step darker) to take slot 1.` }
  : { qty: '—', part: 'Berth order track (printed on board)', text: `${MAX_PLAYERS} numbered slots. Slot 1 costs ${cfg.poleRepCost} reputation; the last slot gains +${cfg.lastSlotRep} reputation and +${cfg.lastSlotSweetenerFuel} fuel.` });
if (al) {
  boardRows.push({ qty: '—', part: 'Ground health tracks (printed on board, one per ground)', text: `Bag fullness in steps of 5%. Closure lines: ${cfg.closure.levels.map((l) => `below ${l.belowPct}% — closed to ${l.closedTo.join(' / ')}`).join(' · ')}.`, note: `Closed water is still fishable: +${cfg.closure.starsPerHaul}★ for every pot a closed-out captain hauls there.` });
  boardRows.push({ qty: '—', part: 'Co-op dividend table (printed on board)', text: cfg.dividend.byHealth.map((r) => `ocean ${r.atLeast}%+ → ${r.money} · paragon ${r.paragon}`).join('\n'), note: 'Paid at every season end to each licensed captain in a dividend band (Neutral or lighter); Paragons read the second column.' });
  boardRows.push({ qty: '—', part: `Season ${cfg.alignment.squeezeSeason} licence count (printed on board)`, text: [3, 4, 5, 6].map((n) => `${n} players: ${n - darkSlots(n)} licences`).join(' · '), note: `Season ${cfg.alignment.squeezeSeason} only; from season ${cfg.alignment.squeezeSeason + 1} there is one for everyone.` });
}
boardRows.push({ qty: '—', part: 'Day and hour track (printed on board)', text: `Days 1–${Math.max(...(cfg.daysSchedule ?? [cfg.daysPerSeason]))} · Hours 1–${cfg.hoursPerDay}`, note: `Each hour every captain still out takes one turn of ${cfg.actionsPerTurn} actions, in turn order.` });
boardRows.push({ qty: '—', part: 'Turn order track (printed on board)', text: `${MAX_PLAYERS} slots: today's order, left to right.`, note: 'Season day 1: the licence auction\'s bid order. Every other day: yesterday\'s berth order.' });
for (const [, n] of markets) {
  const m = n.port!.market!;
  const steps: string[] = [];
  for (let p = m.base, lb = 0; p >= m.floor; p--, lb += m.dropPerLbs) steps.push(p === m.floor ? `${p} (floor, ${lb}+ lb)` : `${p} (${lb} lb)`);
  boardRows.push({ qty: '—', part: `${n.label} price track (printed on board)`, text: steps.join(' → '), note: 'The price marker starts each day at the top. Every lobster sold here pushes it down by its weight, a sale\'s own lobsters included; overnight it goes back to the top.' });
}
boardRows.push({ qty: '—', part: 'Landmarks (printed, decorative)', text: (cfg.map.landmarks ?? []).map((l) => l.name).join(' · ') });

// ---------- lobster tiles ----------
const tileRows: Row[] = [];
let tileTotal = 0;
const sellable = new Set<string>();
for (const g of GROUNDS) {
  const parts: string[] = [];
  let bagTotal = 0;
  for (const [name, count] of Object.entries(cfg.bags[g])) {
    const n = Math.round(count * scale);
    bagTotal += n; tileTotal += n;
    const t = tileTemplate(name);
    if (t.kind === 'KEEPER' || t.kind === 'JUMBO') sellable.add(`${g}:${name}`);
    const face = t.kind === 'KEEPER' ? `${t.weightLb} lb${t.color === 'rare' ? ' RARE' : ''}`
      : t.kind === 'SHORT' ? 'SHORT — under the measure'
      : t.kind === 'JUMBO' ? `JUMBO ${t.weightLb} lb — over the measure`
      : `EGGER — berried female, ${cfg.eggerWeightLb} lb if kept illegally`;
    parts.push(`${n}× ${face}`);
  }
  tileRows.push({ qty: String(bagTotal), part: `${g[0].toUpperCase()}${g.slice(1)} bag`, text: parts.join(' · ') });
}
const preSeed = GROUNDS.reduce((n, g) => n + Object.keys(cfg.bags[g]).filter((k) => sellable.has(`${g}:${k}`)).length * cfg.trapStarters, 0);
tileRows.push({ qty: String(preSeed), part: 'Trap starters', text: `${cfg.trapStarters} of every sellable tile per ground, dropped into that ground's trap at setup so the first spawn has something to give back.` });

const eggerTotal = GROUNDS.reduce((n, g) => n + Math.round((cfg.bags[g].EGGER ?? 0) * scale), 0);

// ---------- meeples & tokens ----------
const seededTotal = grounds.length * cfg.seeded.perSeason * cfg.seasons;
const stormMax = Math.max(...cfg.weather.track.map((t) => t.inshore + t.mid + t.offshore + t.deep));
const potsEach = cfg.buoysPerPlayer + Math.max(0, ...cfg.upgrades.catalog.map((u) => u.buoyBonus ?? 0));

const woodRows: Row[] = [
  { qty: String(eggerTotal), part: 'V-notch lobster meeples', text: 'A notched breeder, released.', note: `Take the egger out of the bag and put one of these in her place. She can never be scored again: whoever draws her releases her for nothing. One per egger in the game (${eggerTotal} at ${MAX_PLAYERS} players).` },
  { qty: String(seededTotal + (cfg.breeding.emptyTrapGeneric ? GENERIC_SPARE : 0)), part: 'Generic lobsters', text: `${cfg.seeded.weightLb} lb`, note: `${cfg.seeded.perSeason} placed on every fishing ground at the start of each season (${seededTotal} over a game), piling up on grounds nobody works; the first haul on a space takes the whole pile.${cfg.breeding.emptyTrapGeneric ? ` Plus ${GENERIC_SPARE} spare: when a breeding spawn empties a trap, the rest come back as generic lobsters.` : ''} Sold, they go back to this supply, not to a trap.` },
  { qty: String(stormMax), part: 'Storm tokens', text: '⛈', note: 'Placed at each season change per the weather track. The most ever on the board at once is the full-blow count.' },
  { qty: `${MAX_PLAYERS} × ${potsEach}`, part: 'Pots (buoys), player-coloured', text: `${cfg.buoysPerPlayer} to a captain, plus one spare for the cargo hold refit.` },
  { qty: `${MAX_PLAYERS}`, part: 'Boats, player-coloured', text: 'One per captain.' },
  ...(al ? [
    { qty: `${MAX_PLAYERS}`, part: 'Alignment markers, player-coloured', text: `One per captain on the alignment track (${cfg.alignment.min} … +${cfg.alignment.max}). Everyone starts at 0.` },
    { qty: `${MAX_PLAYERS}`, part: 'Heat markers (stars), player-coloured', text: `One per captain on their heat track, 0–${cfg.heat.max}★.` },
    { qty: `${MAX_PLAYERS}`, part: 'Licence tokens', text: 'LICENSED', note: 'Placed on your mat when you buy the season\'s licence (season 1\'s comes with the boat); returned at the season change. No token = poaching.' },
    { qty: `${MAX_PLAYERS}`, part: '"Port closed" markers', text: 'CLOSED TO YOU TODAY', note: 'Placed on a port you ran from after a bust. You cannot sell, refuel or berth there until tomorrow.' },
    ...(cfg.flags.patrols ? [
      { qty: String(cfg.patrol.max), part: 'Warden boats', text: 'Placed each morning on the spaces drawn from the patrol deck.', note: `One, plus one per captain on the dark side that morning, up to ${cfg.patrol.max}. A captain with stars who enters a warden's space takes a heat check at sea (bribe on the band card, as at the market). Bust: the catch in the hold is seized, day over, home to ${cfg.map.startPort}, launch last tomorrow. Pots stay in the water.` },
      { qty: String(grounds.length), part: 'Patrol deck', text: 'One card per ocean space.', note: 'Shuffle and draw each morning; every card drawn puts a warden boat on that space.' },
    ] : []),
  ] : []),
  { qty: '3', part: 'Season, day and hour markers', text: 'One for each track.' },
  { qty: `${MAX_PLAYERS}`, part: 'Turn order discs, player-coloured', text: 'One per captain on the turn order and berth order tracks.' },
  { qty: String(markets.length), part: 'Price markers', text: 'One per market port\'s price track.' },
  ...(al ? [{ qty: '4', part: 'Ground health markers', text: 'One per ground\'s health track.' }] : []),
  { qty: '4', part: 'Breeding stock markers', text: 'One per ground\'s breeding stock track.' },
  { qty: String(4), part: 'Lobster traps (one per ground)', text: 'A trap you can reach into.', note: 'Every lobster that leaves a bag for good (sold, dropped when you run from the warden, seized, or fouled by the cheap engine) goes into its home ground\'s trap rather than out of the game. At a season change the ground\'s breeding stock spawns and you draw that many back out BLIND — shake and take. You can see how full a trap is; you cannot see what is in it.' },
];

// ---------- refit tiles ----------
const refitRows: Row[] = deckRefits.map((u) => {
  const fx: string[] = [];
  if (u.stepsPerSteam) fx.push(`STEAM moves up to ${u.stepsPerSteam} spaces`);
  if (u.stormImmune) fx.push('no storm entry hazard');
  if (u.whittleRecover) fx.push('a pot the storm parts comes back to your hand');
  if (u.whittleMult !== undefined) fx.push(`storms part your gear ${Math.round((1 - u.whittleMult) * 100)}% less often`);
  if (u.freeAction) fx.push(`${cap(u.freeAction)} costs no actions, as many times as you like`);
  if (u.fuelBonus) fx.push(`+${u.fuelBonus} fuel capacity`);
  if (u.buoyBonus) fx.push(`+${u.buoyBonus} pot`);
  if (u.bonusDraws) fx.push(`draw and keep +${u.bonusDraws} per haul — every haul with it is a crime`);
  if (u.pollutes) fx.push(`strips ${u.pollutes} more lobster off the ground per haul`);
  return { qty: '2', part: `${u.label} — ${SLOT[u.slot] ?? u.slot}`, text: `${u.cost} · ${fx.join(' · ')}` };
});
const blackMarketRows: Row[] = darkRefits.map((u) => ({
  qty: String(darkSlots(MAX_PLAYERS)),
  part: `${u.label} — ${SLOT[u.slot] ?? u.slot} (BLACK MARKET)`,
  text: `${u.cost} · ${[u.stepsPerSteam ? `STEAM moves up to ${u.stepsPerSteam} spaces` : '', u.bonusDraws ? `draw and keep +${u.bonusDraws} per haul — every haul with it is a crime` : '', u.pollutes ? `strips ${u.pollutes} more lobster off the ground per haul` : ''].filter(Boolean).join(' · ')}`,
  note: `One per dark slot at the table (${[3, 4, 5, 6].map((n) => `${n}p ${darkSlots(n)}`).join(', ')}). Shady and Outlaw only, at any market port. Buying it steps you ${-cfg.alignment.step.darkRefit} darker.`,
}));

// ---------- dice & cards ----------
const faces = cfg.breeding.dieFaces;
const diceRows: Row[] = [
  { qty: String(Math.max(...cfg.breeding.diceByStock.map((r) => r.dice))), part: 'Lobster dice',
    text: faces.map((f) => (f === 0 ? 'blank' : String(f))).join(' / '),
    note: `Rolled at each season change (never into the final season): a ground rolls one per band of its breeding-stock track and returns that many lobsters from its trap, drawn blind${cfg.breeding.emptyTrapGeneric ? ' (if the trap runs out, the rest come back as generic lobsters)' : ''}. ${cfg.breeding.diceByStock.slice().reverse().filter((r) => r.dice > 0).map((r) => `${r.atLeast}+ ${cfg.breeding.mode === 'breeders' ? 'breeders' : 'notches'} = ${r.dice}`).join(', ')}.` },
  { qty: '1', part: 'Storm die (d6)', text: '1–6', note: 'Picks which ground in a tier the storm lands on. The rings are six spaces wide for exactly this reason.' },
  ...(al ? [{ qty: String(cfg.heat.max), part: 'Heat dice', text: cfg.heat.dieFaces.map((f) => (f === 0 ? 'blank' : String(f))).join(' / '),
    note: `The warden's check at every sale: roll one per heat star (no stars, no roll). Total ${cfg.heat.failAt}+ = busted. One or two dice can never bust.` }] : []),
  { qty: '1', part: 'Weather die (d10)', text: '1–10', note: `Entering a storm: a beating on ${cfg.weather.hazardInTen} or less (−${cfg.weather.hazardFuel} fuel). Each night, gear left in a storm parts on ${cfg.weather.whittleInTen} or less — lost for the season, unless a GPS plotter finds it.` },
];

const wl = cfg.scoring.weakLinkPenalty ?? [];
const hb = cfg.scoring.healthBuckets ?? [];
const band = (b: (typeof cfg.alignment.bands)[number], i: number) => {
  const hi = i === 0 ? cfg.alignment.max : cfg.alignment.bands[i - 1].atLeast - 1;
  const lo = b.atLeast === -Infinity ? cfg.alignment.min : b.atLeast;
  return `${b.name.toUpperCase().padEnd(8)} ${lo}…${hi}: ${[b.priceCut ? `−${b.priceCut}/lb` : 'full price', `${b.starsPerCrime}★/crime`, b.mustLicense ? 'must license' : '', b.coop ? 'co-op' : '', b.dividend ? 'dividend' : '', b.refuge ? '' : 'no refuge', b.blackMarket ? 'black market' : '', b.harbourBribe ? 'harbour bribe' : '', `bribe ${b.bribeCosts.join('/')} to ${b.bribeFloor}d`].filter(Boolean).join(' · ')}`;
};
const st = cfg.alignment.step;
const switchboardCards: Row[] = [
  { qty: '1', part: 'Scoring card', text: 'Most money wins. Nothing else scores.' },
  { qty: `${MAX_PLAYERS}`, part: 'Band cards', text: cfg.alignment.bands.map(band).join('\n'), note: `A Paragon who gets busted falls straight to ${cfg.alignment.paragonFallTo}.` },
  { qty: '1', part: 'Alignment card', text: [`LIGHTER: notch an egger +${st.notch} · buy the licence +${st.licence} · land at the co-op +${st.coopLanding} · report a theft +${st.report}`, `DARKER: keep an illegal tile ${st.illegalKeep} · poach a haul ${st.poachHaul} · steal ${st.steal} · bribe ${st.bribe} · black-market refit ${st.darkRefit} · busted ${st.caught}`, `At ${cfg.alignment.min}: a crime that can't move you costs +${cfg.alignment.floorStarsPerCrime}★ instead.`].join('\n') },
  { qty: '1', part: 'Heat card', text: [`A crime adds stars by your band (see the band card): each illegal tile kept, each theft, each haul with the illegal net. Closed water +${cfg.closure.starsPerHaul}★ a pot. Reported +${cfg.heat.reportedStars}★.`, `SELL with stars: roll one heat die per star and add them. Under ${cfg.heat.failAt}: the warden takes ${cfg.heat.takePerPoint} a point. ${cfg.heat.failAt}+: BUSTED — drop the catch, no pay, the port is shut to you today.`, `All blanks: nerves of steel, −1★. A day you don't sell: −${cfg.heat.coolPerDayUnsold}★.`,
    ...(cfg.heat.capCheck ? [`At ${cfg.heat.max}★ a crime can't add a star: heat check on the spot (bribable). Bust = catch seized, home, launch last.`] : []), 'Bribe dice off one roll, down to your band\'s floor: each die at the price on your band card, added up.'].join('\n') },
];
const cardRows: Row[] = [
  ...(al ? switchboardCards : [{
    qty: '1',
    part: 'Scoring card',
    text: `Add your three tracks. Find your LOWEST. Subtract.\n${wl.map((r) => `  lowest ${r.atLeast === -Infinity ? 'below ' + wl[wl.length - 2].atLeast : r.atLeast + ' or more'} → −${r.penalty}`).join('\n')}`,
    note: `Money ÷ ${cfg.scoring.moneyPerVP} · reputation × ${cfg.scoring.repToVP} · conservation = ${cfg.rep.vNotch} per berried female notched + the shared commons bonus.`,
  },
  { qty: '1', part: 'Commons health card', text: hb.map((b) => `${b.atLeast}% of the bags remaining → ${b.vp} VP`).join('\n'), note: 'One end-of-game read, shared by everyone at the table. A stripped ocean costs the steward too.' }]),
  { qty: '1', part: 'Soak card', text: GROUNDS.map((g) => `${g}: ${cfg.soakCurves[g].map((s, i) => `${i}n ${s}`).join(' → ')}`).join('\n'), note: 'Nights soaked, left to right. A pot cannot be hauled until it reaches PRIME.' },
  { qty: '1', part: 'Draw card', text: Object.entries(cfg.drawByStage).map(([s, r]) => `${s}: draw ${r.draw}, keep ${r.keep}`).join('\n'), note: `Hauling in a storm: draw +${cfg.weather.bonusDraws}, keep +${cfg.weather.bonusKeep}.${darkRefits.find((u) => u.bonusDraws) ? ` With the illegal net: draw +${darkRefits.find((u) => u.bonusDraws)!.bonusDraws}, keep +${darkRefits.find((u) => u.bonusDraws)!.bonusDraws}.` : ''}` },
  ...(al ? [] : [{
    qty: '1',
    part: 'Reputation card',
    text: [`steal ${cfg.rep.steal}`, `keep an illegal lobster ${cfg.rep.illegalKeep}`, `reported ${cfg.rep.reported}`, `bribe ${cfg.rep.bribe}`, `towed in ${cfg.tow.rep}`, `haul without a licence ${cfg.unlicensed.repPerHaul}`, `take the pole −${cfg.poleRepCost}`, `report a theft +${cfg.rep.report}`, `land at the co-op +${markets.find(([, n]) => n.port!.market!.coopRep)?.[1].port!.market!.coopRep ?? 0}`, `take the last berth +${cfg.lastSlotRep}`].join('\n'),
    note: `Everyone starts at ${cfg.startReputation}.`,
  }]),
  { qty: `${MAX_PLAYERS}`, part: 'Captain mats — the boat', text: [
      `FUEL track 0–${cfg.fuelTankMax} (to ${cfg.fuelTankMax + Math.max(0, ...cfg.upgrades.catalog.map((u) => u.fuelBonus ?? 0))} with bigger tanks)`,
      'REFIT slots: stern · amidships · deck',
      'LICENCE space (this season\'s licence token)',
      'HOLD: the lobsters you carry, laid out face up',
      ...(al ? [
        `ALIGNMENT track ${cfg.alignment.min} … +${cfg.alignment.max}, banded: ${cfg.alignment.bands.map((b, i) => `${b.name} ${b.atLeast === -Infinity ? cfg.alignment.min : b.atLeast}…${i === 0 ? cfg.alignment.max : cfg.alignment.bands[i - 1].atLeast - 1}`).join(' · ')}`,
        `HEAT track 0–${cfg.heat.max}★`,
      ] : ['the three score tracks']),
    ].join('\n'), note: 'Your boat itself sails the board; the mat is its logbook. Money is kept in coins beside it.' },
  { qty: `${MAX_PLAYERS}`, part: 'Captain mats — the pot tracker', text: [
      ...Array.from({ length: potsEach }, (_, i) => `Pot ${i + 1}${i >= cfg.buoysPerPlayer ? ' (cargo hold refit)' : ''}:  ground ____   nights  ${Array.from({ length: Math.max(...GROUNDS.map((g) => cfg.soakCurves[g].length)) }, (_, n) => `[${n}]`).join(' ')}`),
      '',
      ...GROUNDS.map((g) => `${g.padEnd(8)} ${cfg.soakCurves[g].map((st, n) => `${n}:${st === 'PRIME' ? 'PRIME' : st.toLowerCase()}`).join('  ')}`),
    ].join('\n'), note: `Your pots' soak stages are secret. When you drop a pot, note its ground; each night, advance its marker one box. Read the stage off the curve below it: a pot can be hauled from PRIME on (overripe and fouled pots still haul, for less), and it stays at the last stage once it runs off the end.` },
  { qty: `${MAX_PLAYERS}`, part: 'Captain mats — actions', text: [
      `${cfg.actionsPerTurn} actions a turn · one turn an hour · ${cfg.hoursPerDay} hours a day`,
      '',
      ...actionLines(cfg).map((a) => `${a.name.toUpperCase().padEnd(12)} ${String(a.cost)}  ${a.where.padEnd(18)} ${a.does}${a.freeWith ? ` (${a.freeWith.toLowerCase()}: no actions, any number of times)` : ''}`),
    ].join('\n'), note: 'Printed along the bottom of every mat, so nobody has to ask what a turn can do.' },
  { qty: '1', part: 'Tow card', text: `Caught at sea at day's end${al ? ', or at a port shut to you' : ''}: towed to the nearest port${al ? ' that will have you' : ''}, −${cfg.tow.fee} money${al ? '' : `, ${cfg.tow.rep} reputation`}, fuel topped up to at least ${cfg.tow.emergencyFuel}, and you lose your next ${cfg.tow.lostTurns} turns.` },
];

const moneyRows: Row[] = [
  { qty: '~150 coins', part: 'Money (1 / 5 / 20)', text: `Everyone starts with ${cfg.startMoney}.`, note: 'Winning captains finish around 300–400, so the bank should hold about 2,000 in value.' },
  { qty: '4', part: 'Cloth bags', text: 'One per ground type. Opaque — you draw blind.' },
  { qty: '1 pad', part: 'Bid slips', text: 'Season ___   Captain ________   Bid ____', note: `For the sealed licence auction at the start of seasons 2–${cfg.seasons}: everyone writes a bid, all are revealed at once.` },
];

const groups: Group[] = [
  { id: 'board', title: 'The board', blurb: 'Penobscot Bay, from the working harbour at Rockland south into the open Gulf. Everything printed on it.', rows: boardRows },
  { id: 'lobster', title: 'Lobster tiles', blurb: `The commons itself, ${tileTotal} tiles across four cloth bags at a ${MAX_PLAYERS}-player table. Smaller tables use proportionally fewer, so pressure per boat holds.`, rows: tileRows, total: `${tileTotal + preSeed} tiles` },
  { id: 'wood', title: 'Meeples & tokens', blurb: 'The pieces that move, and the ones that mark what has been done to the water.', rows: woodRows },
  { id: 'refits', title: 'Refit tiles', blurb: `Two of each, ${deckRefits.length * 2} in all, forming one shared deck. Each market port's chandlery draws ${cfg.upgrades.perPortStock} at setup and shows ${cfg.upgrades.display} face up.`, rows: refitRows, total: `${deckRefits.length * 2} tiles` },
  ...(al ? [{ id: 'blackmarket', title: 'Black-market refits', blurb: 'A small face-up stack kept off the chandlery displays. Only as much dark gear as there are dark slots at the table.', rows: blackMarketRows, total: `${darkRefits.length * darkSlots(MAX_PLAYERS)} tiles` }] : []),
  { id: 'dice', title: 'Dice', blurb: al ? 'Each set doing one job.' : 'Three, each doing one job.', rows: diceRows },
  { id: 'cards', title: 'Cards & mats', blurb: 'Everything you would otherwise have to remember. All of it hand-computable by design — no roots, no ratios.', rows: cardRows },
  { id: 'money', title: 'Money & bags', blurb: '', rows: moneyRows },
];

const pieceCount = tileTotal + preSeed + eggerTotal + seededTotal + (cfg.breeding.emptyTrapGeneric ? GENERIC_SPARE : 0) + stormMax + MAX_PLAYERS * potsEach + MAX_PLAYERS * 2 + 3 + markets.length + 8 + 150 + deckRefits.length * 2 + 3
  + (al ? 4 * MAX_PLAYERS + cfg.heat.max + darkRefits.length * darkSlots(MAX_PLAYERS) + (cfg.flags.patrols ? cfg.patrol.max + grounds.length : 0) : 0);

// ---------- render ----------
const groupHtml = (g: Group) => `
      <section class="group" id="${g.id}">
        <header class="group-head">
          <h2>${esc(g.title)}</h2>
          ${g.total ? `<span class="tally">${esc(g.total)}</span>` : ''}
        </header>
        ${g.blurb ? `<p class="blurb">${esc(g.blurb)}</p>` : ''}
        <ul class="parts">
          ${g.rows.map((r) => `<li class="part">
            <span class="qty">${esc(r.qty)}</span>
            <div class="detail">
              <h3>${esc(r.part)}</h3>
              ${r.text ? `<pre class="printed">${esc(r.text)}</pre>` : ''}
              ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}
            </div>
          </li>`).join('\n          ')}
        </ul>
      </section>`;

const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Lobsters Component Manifest</title>
${FONTS}
<style>
${BASE_CSS}</style>

<div class="sheet">
  <header class="masthead">
    <h1><small>What's in the box</small>Lobsters</h1>
    <div class="stamp">
      Component manifest<br>
      Generated from <b>src/config.ts</b><br>
      Counts quoted at <b>${MAX_PLAYERS} players</b><br>
      ${new Date().toISOString().slice(0, 10)}
    </div>
  </header>

  <p class="standfirst">
    Five seasons on Penobscot Bay, fished clean or dirty. What you take is gone until the
    breeding stock brings it back, and every egger kept is one less to breed. Every count
    below is <em>generated from the rules the engine actually plays</em>, so the box and the
    game cannot drift apart.
  </p>

  <dl class="scales">
    <div class="scale"><dt>Players</dt><dd>2–${MAX_PLAYERS}</dd></div>
    <div class="scale"><dt>Seasons</dt><dd>${cfg.seasons}</dd></div>
    <div class="scale"><dt>Fishing days</dt><dd>${(cfg.daysSchedule ?? []).reduce((a, b) => a + b, 0)}</dd></div>
    <div class="scale"><dt>Spaces</dt><dd>${nodes.length}</dd></div>
    <div class="scale"><dt>Lobster tiles</dt><dd>${tileTotal + preSeed}</dd></div>
    <div class="scale"><dt>Pieces, about</dt><dd>${pieceCount}</dd></div>
  </dl>

${groups.map(groupHtml).join('\n')}

  <footer>
    This sheet is generated. Change a number in <code>src/config.ts</code> and run
    <code>npm run components</code> to rebuild it — never edit the counts by hand, or the
    manifest and the rules will disagree and only one of them is right.
  </footer>
</div>
`;

const out = process.argv[2] ?? 'docs/components.html';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} — ${pieceCount} pieces, ${tileTotal + preSeed} lobster tiles at ${MAX_PLAYERS} players`);
