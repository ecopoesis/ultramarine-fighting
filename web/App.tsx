import { useEffect, useRef, useState } from 'react';
import {
  defaultConfig, createInitialState, reduce, legalActions, activePlayerId, daysThisSeason,
  score, avgBagHealth, BOTS, BOT_NAMES, SEAT_COLORS, stageFor,
  type GameState, type Action, type Config,
} from './engine';
import { MapView } from './MapView';
import { actionLabel, actionGroup, nodeLabel } from './labels';
import type { HaulPolicy } from '../src/engine/buoys';

type Controller =
  | { kind: 'human'; name: string }
  | { kind: 'bot'; botName: string };

const seatColor = (pid: string) => SEAT_COLORS[(Number(pid.slice(1)) - 1) % SEAT_COLORS.length];
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------- Setup screen
function Setup({ onStart }: { onStart: (ctrls: Record<string, Controller>, seed: number, players: number) => void }) {
  const [players, setPlayers] = useState(3);
  const [seed, setSeed] = useState(1234);
  // per-seat choice: 'human' | 'random' | a bot name
  const [choices, setChoices] = useState<string[]>(['human', 'random', 'random', 'random', 'random', 'random']);

  const setChoice = (i: number, v: string) => setChoices((c) => c.map((x, j) => (j === i ? v : x)));

  const start = () => {
    const ctrls: Record<string, Controller> = {};
    for (let i = 0; i < players; i++) {
      const pid = `p${i + 1}`;
      const c = choices[i];
      if (c === 'human') ctrls[pid] = { kind: 'human', name: `Captain ${i + 1}` };
      else if (c === 'random') ctrls[pid] = { kind: 'bot', botName: pick(BOT_NAMES) };
      else ctrls[pid] = { kind: 'bot', botName: c };
    }
    onStart(ctrls, seed, players);
  };

  return (
    <div className="setup card">
      <h1>🦞 Lobsters — hot seat</h1>
      <p className="muted">Assign each seat to a human or a bot (pick a name, or random). Pass the device between human turns.</p>
      <div className="row">
        <label>Players
          <select value={players} onChange={(e) => setPlayers(+e.target.value)}>
            {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>Seed
          <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} />
        </label>
      </div>
      <div className="seats">
        {Array.from({ length: players }, (_, i) => (
          <div key={i} className="seat-row">
            <span className="swatch" style={{ background: seatColor(`p${i + 1}`) }} />
            <b>Seat {i + 1}</b>
            <select value={choices[i]} onChange={(e) => setChoice(i, e.target.value)}>
              <option value="human">🧑 Human</option>
              <option value="random">🎲 Random bot</option>
              <optgroup label="Bots">
                {BOT_NAMES.map((n) => <option key={n} value={n}>🤖 {n}</option>)}
              </optgroup>
            </select>
          </div>
        ))}
      </div>
      <button className="primary" onClick={start}>Start game</button>
    </div>
  );
}

// ------------------------------------------------------------- Player summary
function PlayerList({ state, controllers, activePid }: {
  state: GameState; controllers: Record<string, Controller>; activePid: string;
}) {
  const order = state.turnOrder;
  return (
    <div className="players card">
      <h3>Seats — order this day</h3>
      {order.map((pid, i) => {
        const p = state.players[pid];
        const c = controllers[pid];
        return (
          <div key={pid} className={`player-row ${pid === activePid ? 'active' : ''} ${p.berthed ? 'berthed' : ''}`}>
            <span className="swatch" style={{ background: seatColor(pid) }} />
            <b>{p.name}</b>
            <span className="tag">{c.kind === 'human' ? '🧑' : `🤖 ${c.botName}`}</span>
            <span className="muted small">{nodeLabel(state, p.node)}</span>
            <span className="stat">💰{Math.round(p.money)}</span>
            <span className="stat">⛽{p.fuel}</span>
            <span className="stat">🪣{p.deployed.length}/{p.buoysAvailable}</span>
            {p.berthed && <span className="muted small">berthed #{i}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- Active-player panel (private info)
function holdSummary(p: GameState['players'][string]) {
  const counts: Record<string, number> = {};
  for (const t of p.hold) {
    const k = t.seeded ? 'seeded' : `${t.kind}${t.weightLb ? ` ${t.weightLb}lb` : ''}${t.color === 'rare' ? ' (rare)' : ''}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.entries(counts);
}

function ActivePanel({ state, pid }: { state: GameState; pid: string }) {
  const p = state.players[pid];
  const hold = holdSummary(p);
  return (
    <div className="active-detail">
      <div className="stats-row">
        <span className="stat big">💰 {Math.round(p.money)}</span>
        <span className="stat big">⛽ {p.fuel}/{state.config.fuelTankMax}</span>
        <span className="stat big">⭐ rep {p.tracks.reputation.toFixed(1)}</span>
        <span className="stat big">🌿 {p.tracks.conservation.toFixed(0)}</span>
        <span className="stat big">🔖 v-notch {p.vTokens}</span>
      </div>
      <div className="two-col">
        <div>
          <h4>Hold ({p.hold.length})</h4>
          {hold.length === 0 ? <p className="muted small">empty</p> : (
            <ul className="tight">{hold.map(([k, n]) => <li key={k}>{n}× {k}</li>)}</ul>
          )}
        </div>
        <div>
          <h4>Your pots ({p.deployed.length})</h4>
          {p.deployed.length === 0 ? <p className="muted small">none set</p> : (
            <ul className="tight">
              {p.deployed.map((b) => {
                const rec = p.soak[b.buoyId];
                const stage = stageFor(state, rec.ground, rec.daysSoaked);
                const dr = state.config.drawByStage[stage];
                return (
                  <li key={b.buoyId}>
                    {b.buoyId} @ {nodeLabel(state, b.node)} — <span className={`stage ${stage}`}>{stage}</span>
                    <span className="muted small"> · {rec.daysSoaked}d soaked · draw {dr.draw}/keep {dr.keep}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Action buttons
function ActionButtons({ state, pid, apply }: {
  state: GameState; pid: string; apply: (a: Action) => void;
}) {
  const [policy, setPolicy] = useState<HaulPolicy>('clean');
  const [useToken, setUseToken] = useState(false);
  const legal = legalActions(state, pid).filter((a) => a.type !== 'STEAM'); // steam is via the map
  const groups: Record<string, Action[]> = { gear: [], port: [], end: [] };
  for (const a of legal) {
    const g = actionGroup(a);
    if (g !== 'move') groups[g].push(a);
  }
  const hasHaulish = legal.some((a) => a.type === 'HAUL' || a.type === 'STEAL');
  const withMods = (a: Action): Action =>
    (a.type === 'HAUL' || a.type === 'STEAL') ? { ...a, policy, useToken } : a;

  return (
    <div className="actions">
      {hasHaulish && (
        <div className="mods">
          <label>Haul as
            <select value={policy} onChange={(e) => setPolicy(e.target.value as HaulPolicy)}>
              <option value="clean">clean (lawful)</option>
              <option value="highgrade">high-grade (keep jumbos)</option>
              <option value="greedy">greedy (keep all illegal)</option>
            </select>
          </label>
          <label className="chk"><input type="checkbox" checked={useToken} onChange={(e) => setUseToken(e.target.checked)} /> spend v-notch on a lean haul</label>
        </div>
      )}
      {(['gear', 'port', 'end'] as const).map((g) => groups[g].length > 0 && (
        <div key={g} className="btn-row">
          {groups[g].map((a, i) => (
            <button key={i} className={g === 'end' ? '' : 'accent'} onClick={() => apply(withMods(a))}>
              {actionLabel(state, a)}
            </button>
          ))}
        </div>
      ))}
      <p className="muted small">Tip: click a highlighted node on the map to steam there.</p>
    </div>
  );
}

// ------------------------------------------------------------- Restock draft panel
function RestockPanel({ state, pid, apply }: { state: GameState; pid: string; apply: (a: Action) => void }) {
  const r = state.restock!;
  const [spend, setSpend] = useState(0);
  if (r.step === 'claim') {
    const claims = legalActions(state, pid); // one RESTOCK_CLAIM per remaining bag
    return (
      <div className="restock">
        <h3>Restock draft — your claim</h3>
        <p>You rolled <b>{r.roll}</b>. Claim a bag to return that many lobsters from its pile.</p>
        <div className="btn-row">
          {claims.map((a, i) => a.type === 'RESTOCK_CLAIM' && (
            <button key={i} className="accent" onClick={() => apply(a)}>
              Claim {a.ground} (+{a.tileIds.length}, pile {state.piles[a.ground].length})
            </button>
          ))}
        </div>
      </div>
    );
  }
  // contribute
  const g = r.contribGround!;
  const p = state.players[pid];
  const maxSpend = Math.min(p.vTokens, state.piles[g].length);
  const heaviest = [...state.piles[g]].sort((a, b) => b.weightLb - a.weightLb);
  return (
    <div className="restock">
      <h3>Restock draft — contribute to {g}?</h3>
      <p>You hold <b>{p.vTokens}</b> v-notch. Each spent adds one lobster back to {g} (pile {state.piles[g].length}).</p>
      <div className="row">
        <input type="range" min={0} max={maxSpend} value={spend} onChange={(e) => setSpend(+e.target.value)} />
        <b>{spend}</b>
      </div>
      <div className="btn-row">
        <button className="accent" onClick={() => apply({ type: 'RESTOCK_CONTRIBUTE', playerId: pid, tileIds: heaviest.slice(0, spend).map((t) => t.id) })}>
          {spend > 0 ? `Contribute ${spend}` : 'Contribute nothing'}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Game over
function GameOver({ state, controllers, onNew }: {
  state: GameState; controllers: Record<string, Controller>; onNew: () => void;
}) {
  const rows = score(state);
  return (
    <div className="card gameover">
      <h2>🏁 Game over — final scores</h2>
      <p className="muted">Commons health: {(avgBagHealth(state) * 100).toFixed(0)}%</p>
      <table>
        <thead><tr><th></th><th>Captain</th><th>total</th><th>money</th><th>conserv</th><th>rep</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const c = controllers[r.playerId];
            return (
              <tr key={r.playerId} className={i === 0 ? 'winner' : ''}>
                <td><span className="swatch" style={{ background: seatColor(r.playerId) }} /></td>
                <td>{r.name} <span className="muted small">{c.kind === 'human' ? '🧑' : `🤖 ${c.botName}`}</span></td>
                <td><b>{r.total.toFixed(1)}</b></td>
                <td>{r.moneyVP.toFixed(1)}</td>
                <td>{r.conservationVP.toFixed(1)}</td>
                <td>{r.reputationVP.toFixed(1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="primary" onClick={onNew}>New game</button>
    </div>
  );
}

// ---------------------------------------------------------------------- App
export function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [controllers, setControllers] = useState<Record<string, Controller>>({});
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const start = (ctrls: Record<string, Controller>, seed: number, players: number) => {
    const cfg: Config = { ...defaultConfig, players };
    const names = Object.values(ctrls).map((c) => (c.kind === 'human' ? c.name : c.botName));
    setControllers(ctrls);
    setRevealedFor(null);
    setGame(createInitialState(cfg, seed, names));
  };

  const apply = (a: Action) => setGame((g) => (g ? reduce(g, a) : g));

  // Bot auto-play: when the active seat is a bot, take its action after a beat.
  useEffect(() => {
    if (!game || game.phase === 'GAME_OVER') return;
    const pid = activePlayerId(game);
    if (controllers[pid]?.kind !== 'bot') return;
    const t = setTimeout(() => {
      setGame((g) => {
        if (!g || g.phase === 'GAME_OVER') return g;
        const cur = activePlayerId(g);
        const ctrl = controllers[cur];
        if (ctrl?.kind !== 'bot') return g;
        return reduce(g, BOTS[ctrl.botName](g, cur, legalActions(g, cur)));
      });
    }, 650);
    return () => clearTimeout(t);
  }, [game, controllers]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [game]);

  if (!game) return <div className="app"><Setup onStart={start} /></div>;

  const activePid = activePlayerId(game);
  const activeCtrl = controllers[activePid];
  const gameOver = game.phase === 'GAME_OVER';
  const humanCount = Object.values(controllers).filter((c) => c.kind === 'human').length;
  const needGate = !gameOver && activeCtrl?.kind === 'human' && humanCount > 1 && revealedFor !== activePid;

  const legalSteams = new Set<string>();
  if (!gameOver && activeCtrl?.kind === 'human' && !needGate && game.phase === 'PLAYING') {
    for (const a of legalActions(game, activePid)) if (a.type === 'STEAM') legalSteams.add(a.to);
  }

  return (
    <div className="app game">
      <header className="topbar">
        <span className="title">🦞 Lobsters</span>
        <span className="badge">Season {game.season}/{game.config.seasons}</span>
        <span className="badge">Day {game.day}/{daysThisSeason(game)}</span>
        <span className="badge">Hour {game.hour}/{game.config.hoursPerDay}</span>
        {game.phase === 'RESTOCK' && <span className="badge warn">RESTOCK DRAFT</span>}
        {game.stormed.length > 0 && <span className="badge storm">⛈ {game.stormed.length} stormed</span>}
        <span className="badge">health {(avgBagHealth(game) * 100).toFixed(0)}%</span>
        <button className="ghost" onClick={() => { setGame(null); setControllers({}); }}>⟲ new</button>
      </header>

      <div className="layout">
        <div className="map-wrap card">
          <MapView state={game} colors={SEAT_COLORS} legalSteams={legalSteams}
            ownPid={!gameOver && activeCtrl?.kind === 'human' && !needGate ? activePid : null}
            onNode={(n) => apply({ type: 'STEAM', playerId: activePid, to: n })} />
        </div>

        <aside className="side">
          <PlayerList state={game} controllers={controllers} activePid={activePid} />

          {gameOver ? (
            <GameOver state={game} controllers={controllers} onNew={() => { setGame(null); setControllers({}); }} />
          ) : needGate ? (
            <div className="card gate">
              <h3>Pass the device</h3>
              <p>It's <b style={{ color: seatColor(activePid) }}>{game.players[activePid].name}</b>'s turn.</p>
              <button className="primary" onClick={() => setRevealedFor(activePid)}>I'm {game.players[activePid].name} — reveal</button>
            </div>
          ) : activeCtrl?.kind === 'bot' ? (
            <div className="card bot-turn">
              <h3><span className="swatch" style={{ background: seatColor(activePid) }} /> {game.players[activePid].name}</h3>
              <p className="muted">🤖 {activeCtrl.botName} is playing…</p>
            </div>
          ) : (
            <div className="card turn">
              <h3><span className="swatch" style={{ background: seatColor(activePid) }} /> {game.players[activePid].name} — your turn
                {game.phase === 'PLAYING' && <span className="muted small"> ({game.players[activePid].actionsLeft} action{game.players[activePid].actionsLeft === 1 ? '' : 's'} left)</span>}
              </h3>
              {game.phase === 'RESTOCK'
                ? <RestockPanel state={game} pid={activePid} apply={apply} />
                : <><ActivePanel state={game} pid={activePid} /><ActionButtons state={game} pid={activePid} apply={apply} /></>}
            </div>
          )}

          <div className="card log" ref={logRef}>
            <h3>Log</h3>
            {game.log.slice(-40).map((l, i) => <div key={i} className="log-line">{l}</div>)}
          </div>
        </aside>
      </div>
    </div>
  );
}
