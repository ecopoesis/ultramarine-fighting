import type { Config } from '../../src/types';

// Apply `path.to.key=<json>` overrides to a copy of a config (arena and counterfactual
// sweeps). Array indices work as path segments: alignment.bands.3.priceCut=0.
export function applyOverrides(base: Config, kv: string[]): Config {
  const cfg: Config = structuredClone(base);
  for (const o of kv) {
    const eq = o.indexOf('=');
    const keys = o.slice(0, eq).split('.');
    let obj: Record<string, unknown> = cfg as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
    obj[keys[keys.length - 1]] = JSON.parse(o.slice(eq + 1));
  }
  return cfg;
}
