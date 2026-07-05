import type { GameState } from './engine';
import { stageFor } from './engine';
import { NODE_XY, TIER_COLOR, VIEWBOX } from './layout';
import { nodeLabel } from './labels';

const seatColor = (pid: string, colors: string[]) => colors[(Number(pid.slice(1)) - 1) % colors.length];

// Small markers (buoys/boats) fanned out around a node so several don't overlap.
function around(cx: number, cy: number, i: number, n: number, r: number) {
  if (n <= 1) return { x: cx, y: cy };
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
}

export function MapView(props: {
  state: GameState;
  colors: string[];
  legalSteams: Set<string>;
  onNode: (node: string) => void;
  ownPid: string | null; // whose pots may reveal soak on hover (the active human; null when gated/bot)
}) {
  const { state, colors, legalSteams, onNode, ownPid } = props;
  const nodes = state.config.map.nodes;

  // buoys per node (public gear): owner + buoyId (soak stays private — only ownPid's is revealed)
  const buoysAt: Record<string, { owner: string; buoyId: string }[]> = {};
  for (const p of Object.values(state.players)) {
    for (const b of p.deployed) (buoysAt[b.node] ??= []).push({ owner: p.id, buoyId: b.buoyId });
  }
  const buoyTip = (owner: string, buoyId: string, node: string): string => {
    if (owner === ownPid) {
      const rec = state.players[owner].soak[buoyId];
      const dr = state.config.drawByStage[stageFor(state, rec.ground, rec.daysSoaked)];
      return `Your pot ${buoyId} @ ${nodeLabel(state, node)} — ${stageFor(state, rec.ground, rec.daysSoaked)} (soaked ${rec.daysSoaked}d · draw ${dr.draw}/keep ${dr.keep})`;
    }
    return `${state.players[owner].name}'s pot (ripeness hidden)`;
  };
  // boats per node (public)
  const boatsAt: Record<string, string[]> = {};
  for (const p of Object.values(state.players)) (boatsAt[p.node] ??= []).push(p.id);

  // depth-axis guide: a faint band + label per tier row (top = home, bottom = deep)
  const rows: [string, number][] = [
    ['HOME', 44], ['INSHORE', 140], ['MID · ISLANDS', 258], ['OFFSHORE', 392], ['DEEP', 508],
  ];

  return (
    <svg className="map" viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`} preserveAspectRatio="xMidYMid meet">
      {/* depth rows (top→bottom = shallow→deep) */}
      {rows.map(([label, y]) => (
        <g key={label}>
          <line x1={0} y1={y} x2={VIEWBOX.w} y2={y} className="row-guide" />
          <text x={6} y={y - 5} className="row-label">{label}</text>
        </g>
      ))}
      {/* edges */}
      {state.config.map.edges.map(([a, b], i) => {
        const pa = NODE_XY[a], pb = NODE_XY[b];
        if (!pa || !pb) return null;
        return <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="edge" />;
      })}

      {/* nodes */}
      {Object.entries(nodes).map(([id, def]) => {
        const pos = NODE_XY[id];
        if (!pos) return null;
        const isGround = def.type === 'ground';
        const stormed = state.stormed.includes(id);
        const seeded = state.seeded[id] ?? 0;
        const steamable = legalSteams.has(id);
        const fill = isGround ? TIER_COLOR[def.ground!] : (def.port?.market ? '#b5852f' : '#7a7f87');
        const r = isGround ? 15 : 13;
        return (
          <g key={id} className={`node ${steamable ? 'steamable' : ''}`} onClick={() => steamable && onNode(id)}>
            {stormed && <circle cx={pos.x} cy={pos.y} r={r + 7} className="storm-ring" />}
            {steamable && <circle cx={pos.x} cy={pos.y} r={r + 4} className="steam-ring" />}
            <circle cx={pos.x} cy={pos.y} r={r} fill={fill} stroke="#1a1d22" strokeWidth={isGround ? 1.5 : 2}
              strokeDasharray={def.port && !def.port.market ? '3 2' : undefined} />
            <text x={pos.x} y={pos.y - r - 4} className="node-label">{nodeLabel(state, id)}</text>
            {stormed && <text x={pos.x} y={pos.y - r - 15} className="storm-icon">⛈</text>}
            {/* seeded pile badge */}
            {seeded > 0 && (
              <g>
                <circle cx={pos.x + r - 2} cy={pos.y - r + 2} r={8} className="seed-badge" />
                <text x={pos.x + r - 2} y={pos.y - r + 5} className="seed-count">{seeded}</text>
              </g>
            )}
            {/* buoys (public gear); the active player's own pots get a white ring + soak tooltip */}
            {(buoysAt[id] ?? []).map((b, i, arr) => {
              const q = around(pos.x, pos.y, i, arr.length, r + 3);
              const mine = b.owner === ownPid;
              return (
                <rect key={`b${i}`} x={q.x - 3.5} y={q.y - 3.5} width={7} height={7} rx={1}
                  fill={seatColor(b.owner, colors)} stroke={mine ? '#fff' : '#111'} strokeWidth={mine ? 1.5 : 0.5}
                  style={{ cursor: 'help' }}>
                  <title>{buoyTip(b.owner, b.buoyId, id)}</title>
                </rect>
              );
            })}
            {/* boats */}
            {(boatsAt[id] ?? []).map((pid, i, arr) => {
              const q = around(pos.x, pos.y + r + 10, i, arr.length, 7);
              return <circle key={`p${i}`} cx={q.x} cy={q.y} r={5} fill={seatColor(pid, colors)}
                stroke="#fff" strokeWidth={1.5} />;
            })}
          </g>
        );
      })}
    </svg>
  );
}
