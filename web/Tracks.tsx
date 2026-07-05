import {
  score, daysThisSeason, stageFor, isRipe, fuelCap, buoyCap, SEAT_COLORS,
  type GameState, type PlayerState,
} from './engine';

const seatColor = (pid: string) => SEAT_COLORS[(Number(pid.slice(1)) - 1) % SEAT_COLORS.length];

// ---- Season / day as pip tracks ----
export function SeasonDay({ state }: { state: GameState }) {
  const row = (cur: number, total: number) =>
    Array.from({ length: total }, (_, i) => {
      const v = i + 1;
      return <span key={i} className={`pip ${v === cur ? 'on' : v < cur ? 'past' : ''}`}>{v}</span>;
    });
  return (
    <div className="sd-tracks">
      <div className="sd"><b>Season</b><div className="pips">{row(state.season, state.config.seasons)}</div></div>
      <div className="sd"><b>Day</b><div className="pips">{row(state.day, daysThisSeason(state))}</div></div>
    </div>
  );
}

// ---- Fuel / pots as icon boxes ----
export function ResourceMeters({ state, p }: { state: GameState; p: PlayerState }) {
  const fCap = fuelCap(state, p);
  const bCap = buoyCap(state, p);
  const avail = p.buoysAvailable;
  const out = p.deployed.length;
  const lost = Math.max(0, bCap - avail - out);
  return (
    <div className="meters">
      <div className="meter">
        <span className="meter-label">⛽ {p.fuel}/{fCap}</span>
        <div className="cells">
          {Array.from({ length: fCap }, (_, i) => <span key={i} className={`cell fuel ${i < p.fuel ? 'on' : ''}`} />)}
        </div>
      </div>
      <div className="meter">
        <span className="meter-label">🪈 Pots {avail}/{bCap}</span>
        <div className="cells">
          {Array.from({ length: avail }, (_, i) => <span key={`a${i}`} className="cell buoy on" title="in hand" />)}
          {Array.from({ length: out }, (_, i) => <span key={`o${i}`} className="cell buoy out" title="deployed / soaking" />)}
          {Array.from({ length: lost }, (_, i) => <span key={`l${i}`} className="cell buoy lost" title="parted by a storm" />)}
        </div>
      </div>
    </div>
  );
}

// ---- Soak readiness: one track per ground you have pots in; stage-zones sized by
//      their day span, your pots sliding across toward the green PRIME zone ----
export function SoakTracks({ state, p }: { state: GameState; p: PlayerState }) {
  const grounds = [...new Set(p.deployed.map((b) => p.soak[b.buoyId].ground))];
  if (grounds.length === 0) return <p className="muted small">no pots set — drop some to start the clock</p>;
  return (
    <div className="soak-tracks">
      {grounds.map((g) => {
        const curve = state.config.soakCurves[g];
        const pots = p.deployed.filter((b) => p.soak[b.buoyId].ground === g);
        return (
          <div key={g} className="soak-track">
            <span className="soak-label">{g}</span>
            <div className="soak-cells">
              {curve.map((stage, i) => {
                const here = pots.filter((b) => Math.min(p.soak[b.buoyId].daysSoaked, curve.length - 1) === i);
                return (
                  <div key={i} className={`soak-cell st-${stage}`} title={`${stage} (night ${i})`}>
                    <span className="st-abbr">{stage[0]}</span>
                    <div className="pots">
                      {here.map((b) => <span key={b.buoyId} className={`pot ${isRipe(state, g, p.soak[b.buoyId].daysSoaked) ? 'ripe' : ''}`} title={b.buoyId} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Scoring tracks: money / conservation / reputation, with the weak-link
//      multiplier ZONES as colored bands, every player's marker on each ----
const MAXVP = 30;
const zoneColor = (mult: number) =>
  mult >= 1 ? '#2f7d3a' : mult >= 0.75 ? '#6b8f2a' : mult >= 0.5 ? '#a8871f' : mult >= 0.25 ? '#a85a1f' : '#8a2f2f';

export function ScoreTracks({ state }: { state: GameState }) {
  const rows = score(state);
  const wl = (state.config.scoring.weakLink ?? [{ atLeast: -Infinity, mult: 1 }])
    .slice().sort((a, b) => a.atLeast - b.atLeast); // ascending
  // bands: from each threshold (clamped ≥0) up to the next (or MAXVP)
  const bands = wl.map((r, i) => {
    const lo = Math.max(0, r.atLeast);
    const hi = i + 1 < wl.length ? Math.max(0, wl[i + 1].atLeast) : MAXVP;
    return { lo, hi, mult: r.mult };
  }).filter((b) => b.hi > b.lo);

  const track = (key: 'moneyVP' | 'conservationVP' | 'reputationVP', label: string) => (
    <div className="score-track">
      <span className="score-label">{label}</span>
      <div className="score-bar">
        {bands.map((b, i) => (
          <div key={i} className="zone" title={`×${b.mult}`}
            style={{ left: `${(100 * b.lo) / MAXVP}%`, width: `${(100 * (b.hi - b.lo)) / MAXVP}%`, background: zoneColor(b.mult) }}>
            <span className="zmult">×{b.mult}</span>
          </div>
        ))}
        {rows.map((r) => (
          <span key={r.playerId} className="score-marker"
            style={{ left: `${(100 * Math.min(r[key], MAXVP)) / MAXVP}%`, background: seatColor(r.playerId) }}
            title={`${r.name}: ${r[key].toFixed(0)}`} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="score-tracks card">
      <h3>Score tracks <span className="muted small">— your total = the sum × the zone of your LOWEST track</span></h3>
      {track('moneyVP', '💰 Money')}
      {track('conservationVP', '🌿 Conserv')}
      {track('reputationVP', '⭐ Rep')}
    </div>
  );
}
