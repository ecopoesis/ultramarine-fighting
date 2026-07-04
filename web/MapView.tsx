import type { GameState } from './engine';
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
}) {
  const { state, colors, legalSteams, onNode } = props;
  const nodes = state.config.map.nodes;

  // buoys per node (public): owner color
  const buoysAt: Record<string, string[]> = {};
  for (const p of Object.values(state.players)) {
    for (const b of p.deployed) (buoysAt[b.node] ??= []).push(p.id);
  }
  // boats per node (public)
  const boatsAt: Record<string, string[]> = {};
  for (const p of Object.values(state.players)) (boatsAt[p.node] ??= []).push(p.id);

  return (
    <svg className="map" viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`} preserveAspectRatio="xMidYMid meet">
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
            {/* buoys (public gear) */}
            {(buoysAt[id] ?? []).map((owner, i, arr) => {
              const q = around(pos.x, pos.y, i, arr.length, r + 3);
              return <rect key={`b${i}`} x={q.x - 3} y={q.y - 3} width={6} height={6}
                fill={seatColor(owner, colors)} stroke="#111" strokeWidth={0.5} />;
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
