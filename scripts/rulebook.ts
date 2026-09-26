import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultConfig } from '../src/config';
import { tileTemplate } from '../src/tiles';
import type { Config, Ground } from '../src/types';
import { FONTS, BASE_CSS } from './lib/docStyle';
import { actionLines } from './lib/actionsText';

// THE RULEBOOK for the physical game — generated FROM src/config.ts, like the component
// manifest, so every number a player reads is the number the engine plays. The prose is
// hand-written here; only the numbers are interpolated.
//   npx tsx scripts/rulebook.ts [outfile]      (npm run rulebook)
// Written so far: setup, and the structure of play (seasons, days, hours, turns). The
// chapters on each action's details follow.

const cfg: Config = defaultConfig;
const al = cfg.flags.alignment;
const GROUNDS: Ground[] = ['inshore', 'mid', 'offshore', 'deep'];
const PLAYERS = [2, 3, 4, 5, 6];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const nodes = cfg.map.nodes;
const label = (id: string) => nodes[id]?.label ?? id;
const start = label(cfg.map.startPort);
const days = cfg.daysSchedule ?? Array(cfg.seasons).fill(cfg.daysPerSeason);
const markets = Object.entries(nodes).filter(([, n]) => n.port?.market);
const darkSlots = (n: number) => cfg.alignment.darkSlotsByPlayers[Math.min(n, cfg.alignment.darkSlotsByPlayers.length - 1)] ?? 0;
const breedSeasons = Array.from({ length: Math.max(0, cfg.seasons - 2) }, (_, i) => i + 1);
const dieAvg = (cfg.breeding.dieFaces.reduce((a, b) => a + b, 0) / cfg.breeding.dieFaces.length).toFixed(1);

// ---------- setup tables ----------
const count = (g: Ground, name: string, n: number) => Math.round((cfg.bags[g][name] ?? 0) * (n / cfg.referencePlayers));
const face = (name: string) => {
  const t = tileTemplate(name);
  return t.kind === 'KEEPER' ? `${t.weightLb} lb${t.color === 'rare' ? ' rare' : ''}` : t.kind === 'SHORT' ? 'short' : t.kind === 'JUMBO' ? 'jumbo' : 'egger';
};
const bagTable = GROUNDS.map((g) => {
  const names = Object.keys(cfg.bags[g]);
  const rows = names.map((name) => `<tr><td>${esc(face(name))}</td>${PLAYERS.map((n) => `<td>${count(g, name, n)}</td>`).join('')}</tr>`).join('');
  const totals = PLAYERS.map((n) => names.reduce((a, name) => a + count(g, name, n), 0));
  return `<div class="table-wrap"><table class="setup-table"><caption>${cap(g)} bag</caption>
    <thead><tr><th>tile</th>${PLAYERS.map((n) => `<th>${n}p</th>`).join('')}</tr></thead>
    <tbody>${rows}<tr class="total"><td>in the bag</td>${totals.map((t) => `<td>${t}</td>`).join('')}</tr></tbody></table></div>`;
}).join('');
const eggers = (g: Ground, n: number) => count(g, 'EGGER', n);
const breedTable = `<div class="table-wrap"><table class="setup-table"><caption>Breeding stock markers start at</caption>
  <thead><tr><th>ground</th>${PLAYERS.map((n) => `<th>${n}p</th>`).join('')}</tr></thead>
  <tbody>${GROUNDS.map((g) => `<tr><td>${g}</td>${PLAYERS.map((n) => `<td>${eggers(g, n)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const trapStarterTiles = (g: Ground) => Object.keys(cfg.bags[g]).filter((n) => ['KEEPER', 'JUMBO'].includes(tileTemplate(n).kind)).map(face);

// ---------- the nested frames ----------
const actions = actionLines(cfg);
const frames = `<figure class="frames" aria-label="The structure of a game">
  <div class="frame f-game"><span class="frame-label">The game</span><span class="frame-count">${cfg.seasons} seasons</span>
    <div class="frame f-season"><span class="frame-label">A season</span><span class="frame-count">${Math.min(...days)}–${Math.max(...days)} days</span>
      <div class="frame f-day"><span class="frame-label">A day</span><span class="frame-count">${cfg.hoursPerDay} hours</span>
        <div class="frame f-hour"><span class="frame-label">An hour</span><span class="frame-count">one turn for each captain still out, in turn order</span>
          <div class="frame f-turn"><span class="frame-label">Your turn</span><span class="frame-count">${cfg.actionsPerTurn} actions</span>
            <div class="frame f-action"><span class="frame-label">An action</span><span class="frame-count">steam · drop · haul · sell · refuel · …</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <figcaption>Each frame repeats inside the one around it. Things happen at the edges: when a season begins, each morning, each night, and when a season ends.</figcaption>
</figure>`;

const actionsTable = `<div class="table-wrap"><table class="actions"><thead><tr><th>action</th><th>cost</th><th>where</th><th>what it does</th></tr></thead><tbody>
${actions.map((a) => `<tr><td class="an">${esc(a.name)}</td><td class="ac">${a.cost}</td><td class="aw">${esc(a.where)}</td><td>${esc(a.does)}${a.freeWith ? ` <span class="free">With the ${esc(a.freeWith.toLowerCase())} it costs no actions, as many times as you like.</span>` : ''}</td></tr>`).join('\n')}
</tbody></table></div>`;

const reserves = cfg.licensePerSeason.map((r, i) => (i === 0 ? null : `season ${i + 1}: ${r}`)).filter(Boolean).join(', ');
const stormTrack = cfg.weather.track.map((t, i) => `season ${i + 1}: ${t.inshore}/${t.mid}/${t.offshore}/${t.deep}`).join(' · ');
const dividendRows = cfg.dividend.byHealth.map((r) => `${r.atLeast}%+: ${r.money} (Paragons ${r.paragon})`).join(' · ');
const breedBands = cfg.breeding.diceByStock.slice().reverse().filter((r) => r.dice > 0).map((r) => `${r.atLeast}+ breeders roll ${r.dice}`).join(', ');

// ---------- the book ----------
const chapters: { id: string; title: string; body: string }[] = [
  {
    id: 'idea', title: 'The idea',
    body: `<p>You captain a lobster boat on Penobscot Bay for ${cfg.seasons} seasons. Set pots, let them soak, haul them, and sell the catch in the island ports. The ocean is shared: every lobster anyone lands is gone until the breeding stock brings some back.</p>
<p><strong>The captain with the most money at the end wins.</strong> ${al ? 'How you earn it is up to you. Fish clean, and the co-op pays you a share when the ocean is healthy. Fish dirty, keeping the lobsters the law says go back, and you land more but risk the warden. Your <em>alignment</em> on the light–dark track decides what is open to you; your <em>heat</em>, 0 to ' + cfg.heat.max + ' stars, decides how closely the warden watches.' : ''}</p>`,
  },
  {
    id: 'setup', title: 'Setup',
    body: `<p>The counts below depend on how many captains are playing: the ocean is built to the size of the fleet.</p>
<ol class="steps">
  <li><h3>Fill the bags</h3><p>Put each ground's lobster tiles in its cloth bag and shake it. The ${GROUNDS.length} grounds each have their own bag; every fishing space of that ground draws from it.</p>${bagTable}</li>
  <li><h3>Stock the traps</h3><p>Next to each ground's bag, put its <strong>trap</strong>. Drop ${cfg.trapStarters} of each sellable tile into it from the box's trap starters (inshore: ${trapStarterTiles('inshore').join(', ')}; mid: ${trapStarterTiles('mid').join(', ')}; offshore: ${trapStarterTiles('offshore').join(', ')}; deep: ${trapStarterTiles('deep').join(', ')}). The trap is where landed lobsters go, and what the breeding stock draws back from.</p></li>
  <li><h3>Set the ocean's tracks</h3><p>Put each ground's <strong>breeding stock</strong> marker on the number of eggers in its bag.${al ? ' Put each ground\'s <strong>health</strong> marker on 100%.' : ''}</p>${breedTable}</li>
  <li><h3>Seed the grounds</h3><p>Put ${cfg.seeded.perSeason === 1 ? 'one generic lobster' : `${cfg.seeded.perSeason} generic lobsters`} on every fishing space. There are no storms in season 1.</p></li>
  <li><h3>Open the markets</h3><p>Put each market port's price marker at the top of its track: ${markets.map(([, n]) => `${esc(n.label ?? '')} ${n.port!.market!.base}`).join(', ')}.</p></li>
  <li><h3>Stock the chandleries</h3><p>Shuffle the refit tiles. Deal ${cfg.upgrades.perPortStock} face down to each market port and turn the top ${cfg.upgrades.display} face up.${al ? ` Set the <strong>black market</strong> beside the board: ${PLAYERS.map((n) => `${n}p`).join('/')} tables take ${PLAYERS.map(darkSlots).join('/')} of each black-market refit.` : ''}</p></li>
  ${cfg.flags.patrols && al ? `<li><h3>Shuffle the patrol deck</h3><p>One card for every fishing space. It is drawn each morning.</p></li>` : ''}
  <li><h3>Take your boat</h3><p>Each captain takes a mat, a boat, ${cfg.buoysPerPlayer} pots, ${cfg.startFuel} fuel on the fuel track and ${cfg.startMoney} money. Your boat starts in ${esc(start)}. Season 1's licence comes with the boat: take a licence token.${al ? ` Put your alignment marker on 0 (Neutral) and your heat marker on 0 stars.` : ''}</p></li>
  <li><h3>Decide who goes first</h3><p>Seat order, starting with a random captain, is season 1's turn order. Put the turn order discs on the track. Put the season marker on 1, the day marker on 1 and the hour marker on 1.</p></li>
</ol>`,
  },
  {
    id: 'structure', title: 'How a game runs',
    body: `${frames}
<p>A game is ${cfg.seasons} seasons of ${days.map((d, i) => `${d}${i === days.length - 1 ? '' : ','}`).join(' ')} days (${days.reduce((a, b) => a + b, 0)} days in all): seasons get longer as the years go on. Every day is ${cfg.hoursPerDay} hours. Every hour, each captain who is still out takes one turn, in turn order. A turn is ${cfg.actionsPerTurn} actions.</p>

<section class="edge" id="season-begins"><h3>When a season begins <span class="when">seasons 2–${cfg.seasons}</span></h3>
<ol>
  <li><strong>The weather turns.</strong> Clear last season's storms. For each ground, place the number of storm tokens its row of the weather track shows (${stormTrack}; inshore/mid/offshore/deep), using the storm die to pick which spaces. Inshore and the shelters never storm.</li>
  <li><strong>New lobsters.</strong> Put ${cfg.seeded.perSeason === 1 ? 'one generic lobster' : `${cfg.seeded.perSeason} generic lobsters`} on every fishing space. They pile up on spaces nobody fishes.</li>
  <li><strong>The licence auction.</strong> Everyone writes a sealed bid on a slip, at least the season's reserve (${reserves}), and all bids are revealed at once. Everyone who buys pays the <em>second-highest</em> bid (the reserve, if fewer than two captains bid). The two highest bidders must buy; everyone else, in bid order, may buy at that price or pass.${al ? ` Buying steps you 1 lighter. Honest and Paragon captains must buy if they can afford it. In season ${cfg.alignment.squeezeSeason} only some licences are for sale (${PLAYERS.map((n) => `${n}p: ${n - darkSlots(n)}`).join(', ')}): once they are gone, the rest of the table fishes unlicensed.` : ''} Without a licence you may still fish, but every haul is poaching.</li>
  <li><strong>The bid order is this season's turn order.</strong> Highest bid first; captains who did not bid follow in seat order. You are bidding for first pick of the water as much as for the licence.</li>
</ol></section>

<section class="edge" id="morning"><h3>Each morning</h3>
<ol>
  ${cfg.flags.patrols && al ? `<li><strong>The wardens go out.</strong> Draw one patrol card, plus one for every captain on the dark side (Shady or Outlaw), up to ${cfg.patrol.max}. Put a warden boat on each space drawn.</li>` : ''}
  <li><strong>Turn order</strong> is the order captains berthed last night (on the first day of a season, the auction's bid order). Move the hour marker to 1.</li>
</ol></section>

<section class="edge" id="hour"><h3>Each hour</h3>
<p>Going down the turn order, every captain who has not berthed takes one turn. A captain still recovering from a tow loses their turn instead. When everyone has had their turn, move the hour marker on. The day ends after hour ${cfg.hoursPerDay}, or as soon as everyone has berthed.</p></section>

<section class="edge" id="turn"><h3>Your turn</h3>
<p>You have <strong>${cfg.actionsPerTurn} actions</strong>. Spend them on anything below, in any order, as long as you can pay each one's cost. Your turn ends when your actions are spent, or when you <em>Pass</em>, <em>Berth</em> or <em>Bribe</em>. Actions you don't spend are lost.</p>
${actionsTable}
<p><strong>Refits that make an action free</strong> make it free every time, not once a turn. With the pot rack you can drop every pot in your hand onto the space you're on and still have both your actions to spend; with the hauling crane you can pull every ripe pot of yours on the space the same way.</p>
<p class="aside">This list is printed along the bottom of every captain mat. The chapters that follow explain each action in full.</p></section>

<section class="edge" id="night"><h3>Each night</h3>
<ol>
  <li><strong>Everyone comes in.</strong> A captain who is still out and in a port that will have them berths there, behind everyone who berthed, in reverse of today's turn order. <span class="bite">A captain caught at sea${al ? ', or in a port closed to them,' : ''} is towed</span> to the nearest port that will have them: pay ${cfg.tow.fee} money (you never go below 0), fuel goes up to at least ${cfg.tow.emergencyFuel}, and you lose your next ${cfg.tow.lostTurns} turns.${cfg.flags.patrols && al ? ' A captain busted away from the counter today launches last, and anyone busted after them launches behind them.' : ''}</li>
  <li><strong>Tomorrow's turn order</strong> is the berth order you just made.</li>
  <li><strong>Pots soak.</strong> Advance every pot in the water one night on your pot tracker.</li>
  <li><strong>Storms whittle.</strong> Roll the weather die for every pot on a stormed space: on ${cfg.weather.whittleInTen} or less the storm parts it, and it is lost until the season changes.</li>
  ${al ? `<li><strong>Heat cools.</strong> Every captain who did not sell today loses a star. Remove any "port closed" markers.</li>` : ''}
  <li><strong>The hold spoils.</strong> Every lobster in every hold loses ${cfg.holdDecayLbPerDay} lb, to a minimum of 1 lb.</li>
  <li><strong>Prices recover.</strong> Every market's price marker goes back to the top.</li>
</ol>
<p>If that was the season's last day, the season ends. Otherwise move the day marker on; it is morning.</p></section>

<section class="edge" id="season-ends"><h3>When a season ends</h3>
<ol>
  ${al ? `<li><strong>The co-op pays its dividend.</strong> Read the ocean's health (the average of the four health tracks) off the dividend table: ${dividendRows}. Every licensed captain who is Neutral or lighter is paid; Paragons read the second column.</li>` : ''}
  <li><strong>The breeding stock spawns</strong> (after seasons ${breedSeasons.join(', ')}; never into the final season). For each ground, read its breeding stock track: ${breedBands}. Roll that many lobster dice (they average ${dieAvg}) and draw that many lobsters blind out of that ground's trap into its bag.${cfg.breeding.emptyTrapGeneric ? ' If the trap runs out, the rest come back as generic lobsters.' : ''}</li>
  <li><strong>Everyone goes home.</strong> Every pot still in the water comes up empty and goes back to its captain's hand. Every boat returns to ${esc(start)}. Licence tokens go back to the supply. Your hold, fuel, money and refits stay with you.</li>
</ol>
<p>After season ${cfg.seasons}${al ? ' the co-op still pays its dividend, but nothing spawns and nobody goes home' : ''}: the game ends. <strong>The captain with the most money wins.</strong> Ties share the win.</p></section>`,
  },
  {
    id: 'coming', title: 'Still to write',
    body: `<p>The chapters that explain each action in full: fishing (dropping, soaking, hauling and what you keep); selling and the markets; ${al ? 'alignment, heat and the warden (checks, bribes, busts, closed water' + (cfg.flags.patrols ? ', patrols' : '') + '); ' : ''}the weather; refits${al ? ' and the black market' : ''}; theft and reporting; the ocean (breeding stock and health).</p>`,
  },
];

const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Lobsters Rulebook</title>
${FONTS}
<style>
${BASE_CSS}
  .toc{margin-top:2rem; display:flex; flex-wrap:wrap; gap:.4rem 1.4rem; font-family:"Archivo Narrow",Arial Narrow,sans-serif; text-transform:uppercase; letter-spacing:.12em; font-size:.78rem;}
  .toc a{color:var(--ink); text-decoration:none; border-bottom:1px solid var(--rule);}
  .toc a:hover, .toc a:focus-visible{color:var(--accent); border-color:var(--accent); outline:none;}
  .chapter{margin-top:3.5rem;}
  .chapter > h2{font-family:"Archivo Narrow",Arial Narrow,sans-serif; text-transform:uppercase; letter-spacing:.08em; font-size:1.45rem; margin:0 0 1rem; padding-bottom:.4rem; border-bottom:1px solid var(--ink); text-wrap:balance;}
  .chapter p, .chapter li{max-width:65ch;}
  .chapter strong{font-weight:600;}
  h3{font-family:"Archivo Narrow",Arial Narrow,sans-serif; font-size:1.1rem; font-weight:600; margin:0 0 .35rem; letter-spacing:.01em;}
  .steps{list-style:none; counter-reset:step; padding:0; margin:1.5rem 0 0; display:flex; flex-direction:column; gap:1.6rem;}
  .steps > li{counter-increment:step; display:grid; grid-template-columns:2.6rem 1fr; column-gap:1rem; max-width:none;}
  .steps > li::before{content:counter(step); grid-row:1 / span 20; font-family:"IBM Plex Mono",monospace; font-size:1.05rem; color:var(--accent); text-align:right; padding-top:.05rem; border-right:1px solid var(--rule); padding-right:.9rem;}
  .steps > li > *{grid-column:2; margin:0;}
  .steps > li > p{margin-top:.1rem;}
  .table-wrap{overflow-x:auto; margin-top:.8rem; max-width:100%;}
  table{border-collapse:collapse; font-family:"IBM Plex Mono",monospace; font-size:.78rem; font-variant-numeric:tabular-nums;}
  caption{text-align:left; font-family:"Archivo Narrow",Arial Narrow,sans-serif; text-transform:uppercase; letter-spacing:.1em; font-size:.72rem; color:var(--muted); padding-bottom:.35rem;}
  th, td{padding:.3rem .7rem; border-bottom:1px solid var(--rule); text-align:right; white-space:nowrap;}
  th:first-child, td:first-child{text-align:left;}
  th{font-weight:500; color:var(--muted);}
  tr.total td{color:var(--ink); font-weight:500; border-bottom:1px solid var(--ink);}
  .setup-table{background:var(--verdigris-wash); border-left:2px solid var(--verdigris);}
  .frames{margin:1.5rem 0 2rem; padding:0;}
  .frame{border:1px solid var(--rule); border-radius:3px; padding:.6rem .8rem .8rem; margin-top:.55rem; background:var(--panel); display:flex; flex-wrap:wrap; align-items:baseline; gap:.2rem .8rem;}
  .frame > .frame{flex-basis:100%;}
  .f-game{margin-top:0; background:var(--fog); border-color:var(--ink);}
  .f-action{background:var(--verdigris-wash); border-color:var(--verdigris);}
  .frame-label{font-family:"Archivo Narrow",Arial Narrow,sans-serif; text-transform:uppercase; letter-spacing:.12em; font-size:.74rem; font-weight:700;}
  .frame-count{font-family:"IBM Plex Mono",monospace; font-size:.74rem; color:var(--muted);}
  .f-turn > .frame-label{color:var(--accent);}
  figcaption{margin-top:.7rem; font-size:.9rem; color:var(--muted); max-width:62ch;}
  .edge{margin-top:2.2rem; padding-top:1rem; border-top:1px dashed var(--rule);}
  .edge ol{margin:.5rem 0 0; padding-left:1.3rem; display:flex; flex-direction:column; gap:.5rem;}
  .when{font-family:"IBM Plex Mono",monospace; font-size:.72rem; color:var(--muted); font-weight:400; margin-left:.4rem; letter-spacing:0;}
  .actions{width:100%;}
  .actions td{white-space:normal; text-align:left; vertical-align:top; font-family:"Source Serif 4",Georgia,serif; font-size:.9rem;}
  .actions td.an{font-family:"Archivo Narrow",Arial Narrow,sans-serif; font-weight:600; text-transform:uppercase; letter-spacing:.06em; white-space:nowrap;}
  .actions td.ac{font-family:"IBM Plex Mono",monospace; color:var(--accent); text-align:center;}
  .actions td.aw{font-family:"IBM Plex Mono",monospace; font-size:.74rem; color:var(--muted); white-space:nowrap;}
  .actions th{text-align:left;}
  .free{color:var(--verdigris); font-style:italic;}
  .bite{color:var(--accent); font-weight:600;}
  .aside{font-size:.9rem; color:var(--muted);}
  @media (max-width:520px){ .steps > li{grid-template-columns:1.8rem 1fr; column-gap:.7rem;} .actions td.aw{white-space:normal;} }
</style>

<div class="sheet">
  <header class="masthead">
    <h1><small>How to play</small>Lobsters</h1>
    <div class="stamp">
      Rulebook, first draft<br>
      Generated from <b>src/config.ts</b><br>
      ${PLAYERS[0]}–${PLAYERS[PLAYERS.length - 1]} captains<br>
      ${new Date().toISOString().slice(0, 10)}
    </div>
  </header>
  <p class="standfirst">Every number in this book is <em>read from the rules the engine plays</em>, so the book, the box and the game agree. This draft covers setup and the shape of a game; the chapters on each action come next.</p>
  <nav class="toc" aria-label="Contents">${chapters.map((c) => `<a href="#${c.id}">${esc(c.title)}</a>`).join('')}</nav>
  ${chapters.map((c) => `<section class="chapter" id="${c.id}"><h2>${esc(c.title)}</h2>${c.body}</section>`).join('\n')}
  <footer>This book is generated. Change a number in <code>src/config.ts</code> and run <code>npm run rulebook</code> to rebuild it; never edit its numbers by hand.</footer>
</div>
`;

const out = process.argv[2] ?? 'docs/rulebook.html';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out}`);
