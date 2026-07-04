import { defaultConfig as cfg } from '../src/config';
import { createInitialState } from '../src/state';
import { distance } from '../src/engine/movement';
import { allPorts, nearestPort, distanceToNearestPort } from '../src/engine/ports';
import type { Ground } from '../src/types';

// Static legality checks on the map geometry (no gameplay). Verifies the reshaped
// bay is connected, tiers are the right size, and the deep is round-trip-reachable.
const s = createInitialState(cfg, 1);
const nodes = Object.keys(cfg.map.nodes);

// tier sizes
const byTier: Record<string, string[]> = {};
for (const [n, def] of Object.entries(cfg.map.nodes)) {
  if (def.type === 'ground') (byTier[def.ground!] ??= []).push(n);
}
console.log('Tier sizes:', Object.fromEntries(Object.entries(byTier).map(([g, ns]) => [g, ns.length])));

// connectivity: every node reachable from ROCKLAND
const unreachable = nodes.filter((n) => distance(s, 'ROCKLAND', n) === Infinity);
console.log('Unreachable from ROCKLAND:', unreachable.length ? unreachable : 'none ✓');

// distances from ROCKLAND to each ground
console.log('\nDist ROCKLAND → grounds:');
for (const g of Object.keys(byTier) as Ground[]) {
  const ds = byTier[g].map((n) => `${n}=${distance(s, 'ROCKLAND', n)}`);
  console.log(`  ${g}: ${ds.join('  ')}`);
}

// round-trip safety: nearest port + round trip within a full tank
console.log('\nRound-trip (to node + back to nearest port), tank =', cfg.fuelTankMax, ':');
for (const g of Object.keys(byTier) as Ground[]) {
  for (const n of byTier[g]) {
    const out = distance(s, cfg.map.startPort, n);
    const back = distanceToNearestPort(s, n);
    const np = nearestPort(s, n);
    const rt = out + back;
    const flag = rt > cfg.fuelTankMax ? '  ⚠ OVER TANK' : '';
    if (g === 'deep' || flag) console.log(`  ${n}: out ${out} + back ${back} (via ${np}) = ${rt}${flag}`);
  }
}

console.log('\nPorts:', allPorts(s).join(', '));
console.log('Edge count:', cfg.map.edges.length, ' Node count:', nodes.length);
