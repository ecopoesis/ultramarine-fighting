import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultConfig } from '../src/config';
import { tileTemplate } from '../src/tiles';
import type { Config, Ground } from '../src/types';

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
const deckRefits = cfg.upgrades.catalog.filter((u) => !u.dark || !al);
const scale = MAX_PLAYERS / cfg.referencePlayers;
const GROUNDS: Ground[] = ['inshore', 'mid', 'offshore', 'deep'];
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
  note: `Advance a ground's track one step every time a berried female is v-notched and released there. Public. At each season change the stock spawns from it. Longest track needed: ${GROUNDS.map((g) => Math.round((cfg.bags[g].EGGER ?? 0) * scale)).reduce((a, b) => Math.max(a, b), 0)} steps, the most eggers any one bag holds at ${MAX_PLAYERS} players.`,
});
boardRows.push(al
  ? { qty: '—', part: 'Berth order track (printed on board)', text: `${MAX_PLAYERS} numbered slots, filled in arrival order — tomorrow's turn order. Free. Shady and Outlaw captains may bribe the harbourmaster (${cfg.bribeMoneyCost} money, one step darker) to take slot 1.` }
  : { qty: '—', part: 'Berth order track (printed on board)', text: `${MAX_PLAYERS} numbered slots. Slot 1 costs ${cfg.poleRepCost} reputation; the last slot gains +${cfg.lastSlotRep} reputation and +${cfg.lastSlotSweetenerFuel} fuel.` });
if (al) {
  boardRows.push({ qty: '—', part: 'Ground health tracks (printed on board, one per ground)', text: `Bag fullness in steps of 5%. Closure lines: ${cfg.closure.levels.map((l) => `below ${l.belowPct}% — closed to ${l.closedTo.join(' / ')}`).join(' · ')}.`, note: `Closed water is still fishable: +${cfg.closure.starsPerHaul}★ for every pot a closed-out captain hauls there.` });
  boardRows.push({ qty: '—', part: 'Co-op dividend table (printed on board)', text: cfg.dividend.byHealth.map((r) => `ocean ${r.atLeast}%+ → ${r.money} · paragon ${r.paragon}`).join('\n'), note: 'Paid at every season end to each licensed captain in a dividend band (Neutral or lighter); Paragons read the second column.' });
  boardRows.push({ qty: '—', part: `Season ${cfg.alignment.squeezeSeason} licence count (printed on board)`, text: [3, 4, 5, 6].map((n) => `${n} players: ${n - darkSlots(n)} licences`).join(' · '), note: `Season ${cfg.alignment.squeezeSeason} only; from season ${cfg.alignment.squeezeSeason + 1} there is one for everyone.` });
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
  { qty: String(seededTotal), part: 'Seeded lobsters (generic)', text: `${cfg.seeded.weightLb} lb`, note: `${cfg.seeded.perSeason} placed on every fishing ground at the start of each season, accumulating on grounds nobody works. The first haul on a space takes the whole pile.` },
  { qty: String(stormMax), part: 'Storm tokens', text: '⛈', note: 'Placed at each season change per the weather track. The most ever on the board at once is the full-blow count.' },
  { qty: `${MAX_PLAYERS} × ${potsEach}`, part: 'Pots (buoys), player-coloured', text: `${cfg.buoysPerPlayer} to a captain, plus one spare for the cargo hold refit.` },
  { qty: `${MAX_PLAYERS}`, part: 'Boats, player-coloured', text: 'One per captain.' },
  ...(al ? [
    { qty: `${MAX_PLAYERS}`, part: 'Alignment markers, player-coloured', text: `One per captain on the alignment track (${cfg.alignment.min} … +${cfg.alignment.max}). Everyone starts at 0.` },
    { qty: `${MAX_PLAYERS}`, part: 'Heat markers (stars), player-coloured', text: `One per captain on their heat track, 0–${cfg.heat.max}★.` },
    ...(cfg.flags.patrols ? [
      { qty: String(cfg.patrol.max), part: 'Warden boats', text: 'Placed each morning on the spaces drawn from the patrol deck.', note: `One, plus one per captain on the dark side that morning, up to ${cfg.patrol.max}. A captain with stars who enters a warden's space takes a heat check at sea (bribe on the band card, as at the market). Bust: the catch in the hold is seized, day over, home to ${cfg.map.startPort}, launch last tomorrow. Pots stay in the water.` },
      { qty: String(grounds.length), part: 'Patrol deck', text: 'One card per ocean space.', note: 'Shuffle and draw each morning; every card drawn puts a warden boat on that space.' },
    ] : []),
  ] : []),
  { qty: String(4), part: 'Lobster traps (one per ground)', text: 'A trap you can reach into.', note: 'Every lobster landed and sold goes into its home ground\'s trap rather than out of the game. At a season change the ground\'s breeding stock spawns and you draw that many back out BLIND — shake and take. You can see how full a trap is; you cannot see what is in it.' },
];

// ---------- refit tiles ----------
const refitRows: Row[] = deckRefits.map((u) => {
  const fx: string[] = [];
  if (u.stepsPerSteam) fx.push(`STEAM moves up to ${u.stepsPerSteam} spaces`);
  if (u.stormImmune) fx.push('no storm entry hazard');
  if (u.whittleMult !== undefined) fx.push(`storms part your gear ${Math.round((1 - u.whittleMult) * 100)}% less often`);
  if (u.freeAction) fx.push(`${u.freeAction} costs no action`);
  if (u.fuelBonus) fx.push(`+${u.fuelBonus} fuel capacity`);
  if (u.buoyBonus) fx.push(`+${u.buoyBonus} pot`);
  if (u.bonusDraws) fx.push(`draw and keep +${u.bonusDraws} per haul — every haul with it is a crime`);
  if (u.pollutes) fx.push(`strips ${u.pollutes} more lobster off the ground per haul`);
  return { qty: '2', part: `${u.label} — ${u.slot}`, text: `${u.cost} · ${fx.join(' · ')}` };
});
const blackMarketRows: Row[] = darkRefits.map((u) => ({
  qty: String(darkSlots(MAX_PLAYERS)),
  part: `${u.label} — ${u.slot} (BLACK MARKET)`,
  text: `${u.cost} · ${[u.stepsPerSteam ? `STEAM moves up to ${u.stepsPerSteam} spaces` : '', u.bonusDraws ? `draw and keep +${u.bonusDraws} per haul — every haul with it is a crime` : '', u.pollutes ? `strips ${u.pollutes} more lobster off the ground per haul` : ''].filter(Boolean).join(' · ')}`,
  note: `One per dark slot at the table (${[3, 4, 5, 6].map((n) => `${n}p ${darkSlots(n)}`).join(', ')}). Shady and Outlaw only, at any market port. Buying it steps you ${-cfg.alignment.step.darkRefit} darker.`,
}));

// ---------- dice & cards ----------
const faces = cfg.breeding.dieFaces;
const diceRows: Row[] = [
  { qty: String(Math.max(...cfg.breeding.diceByNotches.map((r) => r.dice))), part: 'Lobster dice',
    text: faces.map((f) => (f === 0 ? 'blank' : String(f))).join(' / '),
    note: `Rolled at each season change (never into the final season): a ground rolls one per band of notches on its breeding-stock track and returns that many lobsters from its pile, lightest first. ${cfg.breeding.diceByNotches.slice().reverse().filter((r) => r.dice > 0).map((r) => `${r.atLeast}+ notches = ${r.dice}`).join(', ')}. A die averages under one lobster, so even a well-tended ground can have a poor year.` },
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
  { qty: '1', part: 'Heat card', text: [`A crime adds stars by your band (see the band card): each illegal tile kept, each theft, each haul with the illegal net. Closed water +${cfg.closure.starsPerHaul}★ a pot. Reported +${cfg.heat.reportedStars}★.`, `SELL with stars: roll one heat die per star and add them. Under ${cfg.heat.failAt}: the warden takes ${cfg.heat.takePerPoint} a point. ${cfg.heat.failAt}+: BUSTED — drop the catch, no pay, the port is shut to you today.`, `All blanks: nerves of steel, −1★. A day you don't sell: −${cfg.heat.coolPerDayUnsold}★.`, 'Bribe dice off one roll, down to your band\'s floor: each die at the price on your band card, added up.'].join('\n') },
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
  { qty: '1', part: 'Draw card', text: Object.entries(cfg.drawByStage).map(([s, r]) => `${s}: draw ${r.draw}, keep ${r.keep}`).join('\n'), note: `Hauling in a storm: draw +${cfg.weather.bonusDraws}, keep +${cfg.weather.bonusKeep}.` },
  { qty: '1', part: 'Action card', text: Object.entries(cfg.actionCost).map(([a, c]) => `${a} ${c}`).join(' · '), note: `${cfg.actionsPerTurn} actions a turn, ${cfg.hoursPerDay} turns a day. Unspent actions are lost.` },
  ...(al ? [] : [{
    qty: '1',
    part: 'Reputation card',
    text: [`steal ${cfg.rep.steal}`, `keep an illegal lobster ${cfg.rep.illegalKeep}`, `reported ${cfg.rep.reported}`, `bribe ${cfg.rep.bribe}`, `towed in ${cfg.tow.rep}`, `haul without a licence ${cfg.unlicensed.repPerHaul}`, `take the pole −${cfg.poleRepCost}`, `report a theft +${cfg.rep.report}`, `land at the co-op +${markets.find(([, n]) => n.port!.market!.coopRep)?.[1].port!.market!.coopRep ?? 0}`, `take the last berth +${cfg.lastSlotRep}`].join('\n'),
    note: `Everyone starts at ${cfg.startReputation}.`,
  }]),
  { qty: `${MAX_PLAYERS}`, part: 'Captain mats', text: `Three refit slots (stern · mid primary · mid secondary), a fuel track to ${cfg.fuelTankMax} (${cfg.fuelTankMax + Math.max(0, ...cfg.upgrades.catalog.map((u) => u.fuelBonus ?? 0))} with bigger tanks), a hold, and ${al ? `an alignment track (${cfg.alignment.min} … +${cfg.alignment.max}, banded) and a heat track (0–${cfg.heat.max}★)` : 'the three score tracks'}.` },
  { qty: '1', part: 'Tow card', text: `Caught at sea at day's end${al ? ', or at a port shut to you' : ''}: towed to the nearest port${al ? ' that will have you' : ''}, −${cfg.tow.fee} money${al ? '' : `, ${cfg.tow.rep} reputation`}, fuel topped up to at least ${cfg.tow.emergencyFuel}, and you lose your next ${cfg.tow.lostTurns} turns.` },
];

const moneyRows: Row[] = [
  { qty: '~400', part: 'Money (1 / 5 / 20)', text: `Everyone starts with ${cfg.startMoney}. A good season can land several hundred.` },
  { qty: '4', part: 'Cloth bags', text: 'One per ground type. Opaque — you draw blind.' },
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

const pieceCount = tileTotal + preSeed + eggerTotal + seededTotal + stormMax + MAX_PLAYERS * potsEach + MAX_PLAYERS + 60 + deckRefits.length * 2 + 3
  + (al ? 2 * MAX_PLAYERS + cfg.heat.max + darkRefits.length * darkSlots(MAX_PLAYERS) : 0);

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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
  :root{
    --fog:#E8EDEB; --panel:#F3F6F5; --ink:#16232B; --muted:#5C6B6E;
    --rule:#BDC9C6; --accent:#C93F1D; --verdigris:#357367; --verdigris-wash:#E2ECE8;
    color-scheme:light;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --fog:#0E171C; --panel:#152128; --ink:#DCE5E3; --muted:#8FA2A4;
      --rule:#2A3A42; --accent:#F0663F; --verdigris:#6FB8A6; --verdigris-wash:#16262A;
      color-scheme:dark;
    }
  }
  :root[data-theme="dark"]{
    --fog:#0E171C; --panel:#152128; --ink:#DCE5E3; --muted:#8FA2A4;
    --rule:#2A3A42; --accent:#F0663F; --verdigris:#6FB8A6; --verdigris-wash:#16262A;
    color-scheme:dark;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--fog); color:var(--ink);
    font-family:"Source Serif 4",Georgia,"Times New Roman",serif;
    font-size:16px; line-height:1.55;
  }
  .sheet{max-width:60rem; margin:0 auto; padding-block:clamp(2rem,6vw,4.5rem); padding-left:20px; padding-right:20px;}

  .masthead{border-bottom:3px solid var(--ink); padding-bottom:1.25rem; display:flex; flex-wrap:wrap; align-items:flex-end; gap:1rem 2rem;}
  .masthead h1{
    font-family:"Archivo Narrow",Arial Narrow,Helvetica,sans-serif;
    font-weight:700; font-size:clamp(2.4rem,7vw,4rem); line-height:.95; margin:0;
    letter-spacing:-.01em; text-transform:uppercase; text-wrap:balance; flex:1 1 18rem;
  }
  .masthead h1 small{display:block; font-size:.28em; letter-spacing:.22em; color:var(--accent); font-weight:600; margin-bottom:.5rem;}
  .stamp{
    font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:.72rem; line-height:1.7;
    color:var(--muted); text-align:right; border-left:1px solid var(--rule); padding-left:1.25rem;
  }
  .stamp b{color:var(--ink); font-weight:500;}

  .standfirst{
    font-size:1.1rem; max-width:62ch; margin:1.75rem 0 0; color:var(--ink);
  }
  .standfirst em{color:var(--accent); font-style:normal; font-weight:600;}

  .scales{
    display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:1px;
    background:var(--rule); border:1px solid var(--rule); margin-top:2.25rem;
  }
  .scale{background:var(--panel); padding:.9rem 1rem;}
  .scale dt{
    font-family:"Archivo Narrow",Arial Narrow,sans-serif; text-transform:uppercase;
    letter-spacing:.14em; font-size:.66rem; color:var(--muted); font-weight:600;
  }
  .scale dd{
    margin:.3rem 0 0; font-family:"IBM Plex Mono",monospace; font-size:1.35rem;
    font-variant-numeric:tabular-nums; color:var(--ink);
  }

  .group{margin-top:3.5rem;}
  .group-head{display:flex; align-items:baseline; gap:1rem; border-bottom:1px solid var(--ink); padding-bottom:.4rem;}
  .group-head h2{
    font-family:"Archivo Narrow",Arial Narrow,sans-serif; text-transform:uppercase;
    letter-spacing:.1em; font-size:1.05rem; font-weight:700; margin:0; flex:1;
  }
  .tally{
    font-family:"IBM Plex Mono",monospace; font-size:.75rem; color:var(--accent);
    font-variant-numeric:tabular-nums;
  }
  .blurb{color:var(--muted); max-width:62ch; margin:.9rem 0 0; font-size:.95rem;}

  .parts{list-style:none; margin:1.25rem 0 0; padding:0; display:flex; flex-direction:column; gap:1.5rem;}
  .part{display:grid; grid-template-columns:4.5rem 1fr; gap:1.25rem; align-items:start;}
  .qty{
    font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums;
    font-size:1rem; color:var(--accent); text-align:right; padding-top:.1rem;
    border-right:1px solid var(--rule); padding-right:1.25rem; min-height:1.4rem;
  }
  .detail h3{
    font-family:"Archivo Narrow",Arial Narrow,sans-serif; font-weight:600; font-size:1.02rem;
    margin:0; letter-spacing:.01em;
  }
  .printed{
    font-family:"IBM Plex Mono",monospace; font-size:.78rem; line-height:1.65;
    background:var(--verdigris-wash); border-left:2px solid var(--verdigris);
    color:var(--ink); margin:.5rem 0 0; padding:.6rem .8rem; white-space:pre-wrap;
    overflow-x:auto;
  }
  .note{color:var(--muted); font-size:.9rem; margin:.5rem 0 0; max-width:62ch;}

  footer{
    margin-top:4rem; border-top:1px solid var(--rule); padding-top:1.25rem;
    color:var(--muted); font-size:.85rem; max-width:62ch;
  }
  footer code{font-family:"IBM Plex Mono",monospace; color:var(--ink); font-size:.95em;}

  @media (max-width:520px){
    .part{grid-template-columns:3.2rem 1fr; gap:.85rem;}
    .qty{padding-right:.85rem;}
    .stamp{text-align:left; border-left:0; padding-left:0;}
  }
</style>

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
    Five seasons on Penobscot Bay. The bags only ever empty, and what you throw back is
    the only thing that puts anything in them. Every count below is <em>generated from the
    rules the engine actually plays</em>, so the box and the game cannot drift apart.
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
