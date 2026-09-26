import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { zipSync, strToU8 } from 'fflate';
import { defaultConfig } from '../src/config';
import { tileTemplate } from '../src/tiles';
import type { Ground } from '../src/types';

// LOBSTER MEEPLES — every flavour of two-colour lobster the bags call for, built from
// assets/lobster.svg as print-ready 3MF files for Bambu Studio. Replaces the Fusion 360
// routine: import SVG, flip, extrude the marks 0.5 mm, the lobster minus the marks 5 mm,
// then join the marks' 4.5 mm stems to the lobster.
//   npx tsx scripts/meeples.ts [svg] [outdir]
//
// Each meeple prints UPSIDE DOWN: the marks are a 0.5 mm inlay on the bed face, mirrored
// so they read correctly once the piece is turned over. One object, two parts —
// part 1 "lobster" on filament 1 (red), part 2 "marks" on filament 2 (white). Fancy
// (RARE) lobsters are the same models with the filaments swapped, so they are skipped.
//
// The flavour list comes from src/config.ts: one per (ground, tile kind) in the bags,
// plus the generic seeded lobster with no location mark. Location marks accumulate
// outward: inshore = the wave, mid adds the first bar, offshore the second, deep all four.

const SVG = process.argv[2] ?? 'assets/lobster.svg';
const OUT = process.argv[3] ?? 'assets/meeples';

// Physical build — millimetres. These are print dimensions, not game numbers.
const PX_MM = 25.4 / 96; // SVG user units are CSS px (Fusion imports at 96 dpi)
const HEIGHT = 5; // the whole meeple
const INLAY = 0.5; // depth of the coloured marks on the face
const FLATTEN_MM = 0.05; // max chord length when flattening curves

const GROUNDS: Ground[] = ['inshore', 'mid', 'offshore', 'deep'];
const LOCATION_ID: Record<Ground, string> = { inshore: 'Inshore', mid: 'Midshore', offshore: 'Offshore', deep: 'Deep' };

// ---------- which meeples ----------
type Flavour = { name: string; glyph: string; grounds: Ground[] };
const glyphFor = (tile: string): string | null => {
  const t = tileTemplate(tile);
  if (t.color === 'rare') return null; // fancy = recolour of the common one
  if (t.kind === 'KEEPER') return `_${t.weightLb}`;
  return t.kind.toLowerCase(); // short, egger, jumbo
};
const flavours: Flavour[] = [];
const seen = new Set<string>();
for (const [i, g] of GROUNDS.entries()) {
  for (const tile of Object.keys(defaultConfig.bags[g])) {
    const glyph = glyphFor(tile);
    const name = `lobster-${glyph?.replace(/^_/, '')}-${g}`;
    if (!glyph || seen.has(name)) continue;
    seen.add(name);
    flavours.push({ name, glyph, grounds: GROUNDS.slice(0, i + 1) });
  }
}
if (defaultConfig.flags.seeded) flavours.push({ name: `lobster-${defaultConfig.seeded.weightLb}-generic`, glyph: `_${defaultConfig.seeded.weightLb}`, grounds: [] });

// ---------- SVG → polygons (px) ----------
type Pt = [number, number];
type M6 = [number, number, number, number, number, number];
const ID: M6 = [1, 0, 0, 1, 0, 0];
const mul = (a: M6, b: M6): M6 => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: M6, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function parseTransform(s: string | null): M6 {
  if (!s) return ID;
  let m = ID;
  for (const [, fn, args] of s.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const n = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'matrix') m = mul(m, n as M6);
    else if (fn === 'translate') m = mul(m, [1, 0, 0, 1, n[0], n[1] ?? 0]);
    else if (fn === 'scale') m = mul(m, [n[0], 0, 0, n[1] ?? n[0], 0, 0]);
    else throw new Error(`unsupported transform ${fn}`);
  }
  return m;
}

// Absolute and relative M/L/H/V/C/Z — what Affinity writes. Curves are flattened.
function parsePath(d: string, m: M6): Pt[][] {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const rings: Pt[][] = [];
  let ring: Pt[] = [], cur: Pt = [0, 0], start: Pt = [0, 0], cmd = '', i = 0;
  const num = () => Number(toks[i++]);
  const close = () => { if (ring.length > 2) rings.push(ring.map((p) => apply(m, p))); ring = []; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const o: Pt = rel ? cur : [0, 0];
    switch (cmd.toUpperCase()) {
      case 'M': close(); cur = [o[0] + num(), o[1] + num()]; start = cur; ring.push(cur); cmd = rel ? 'l' : 'L'; break;
      case 'L': cur = [o[0] + num(), o[1] + num()]; ring.push(cur); break;
      case 'H': cur = [(rel ? cur[0] : 0) + num(), cur[1]]; ring.push(cur); break;
      case 'V': cur = [cur[0], (rel ? cur[1] : 0) + num()]; ring.push(cur); break;
      case 'C': {
        const p1: Pt = [o[0] + num(), o[1] + num()], p2: Pt = [o[0] + num(), o[1] + num()], p3: Pt = [o[0] + num(), o[1] + num()];
        const p0 = cur;
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
        const scale = Math.hypot(m[0], m[1]) * PX_MM;
        const n = Math.max(4, Math.ceil((len * scale) / FLATTEN_MM));
        for (let k = 1; k <= n; k++) {
          const t = k / n, u = 1 - t;
          ring.push([
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
          ]);
        }
        cur = p3;
        break;
      }
      case 'Z': close(); cur = start; break;
      default: throw new Error(`unsupported path command ${cmd}`);
    }
  }
  close();
  return rings;
}

// Every filled shape under (or at) each id'd element, in px. Strokes are ignored, as
// Fusion ignores them. A tag walk is enough for Affinity's flat, regular output.
const attr = (a: string, k: string) => a.match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`))?.[1] ?? null;
const byId = new Map<string, Pt[][]>();
{
  const stack: { m: M6; ids: string[] }[] = [{ m: ID, ids: [] }];
  for (const [, close, tag, a, selfClose] of readFileSync(SVG, 'utf8').matchAll(/<(\/?)([\w:]+)((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
    if (close) { if (tag !== 'svg') stack.pop(); continue; }
    if (tag === 'svg') continue;
    const top = stack[stack.length - 1];
    const id = attr(a, 'id');
    const m = mul(top.m, parseTransform(attr(a, 'transform')));
    const ids = id ? [...top.ids, id] : top.ids;
    let rings: Pt[][] = [];
    if (tag === 'path') rings = parsePath(attr(a, 'd')!, m);
    else if (tag === 'rect') {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => Number(attr(a, k) ?? 0));
      rings = [([[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as Pt[]).map((p) => apply(m, p))];
    }
    for (const i of ids) byId.set(i, [...(byId.get(i) ?? []), ...rings]);
    if (!selfClose) stack.push({ m, ids });
  }
}
const shapes = (id: string): Pt[][] => {
  const r = byId.get(id);
  if (!r?.length) throw new Error(`no #${id} in ${SVG}`);
  return r;
};

// ---------- geometry ----------
const wasm = await Module();
wasm.setup();
const { CrossSection } = wasm;

const outlinePx = shapes('lobster');
const xs = outlinePx.flat().map((p) => p[0]), ys = outlinePx.flat().map((p) => p[1]);
const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
// px → mm, centred, and MIRRORED: SVG y points down, so (x, y) → (x, -y) would read
// correctly from above; the meeple is read from the bed side, so x flips too.
const toMm = (rings: Pt[][]): Pt[][] => rings.map((r) => r.map(([x, y]) => [-(x - cx) * PX_MM, -(y - cy) * PX_MM] as Pt));
const section = (id: string) => new CrossSection(toMm(shapes(id)), 'EvenOdd');

const outline = section('lobster');
const glyphCache = new Map<string, InstanceType<typeof CrossSection> | null>();
const glyph = (id: string) => {
  if (!glyphCache.has(id)) glyphCache.set(id, byId.get(id)?.length ? section(id) : null);
  return glyphCache.get(id)!;
};

// ---------- 3MF ----------
function meshXml(m: InstanceType<typeof wasm.Manifold>): string {
  const mesh = m.getMesh();
  const { vertProperties: vp, triVerts: tv, numProp } = mesh;
  const v: string[] = [], t: string[] = [];
  for (let i = 0; i < vp.length; i += numProp) v.push(`<vertex x="${vp[i].toFixed(4)}" y="${vp[i + 1].toFixed(4)}" z="${vp[i + 2].toFixed(4)}"/>`);
  for (let i = 0; i < tv.length; i += 3) t.push(`<triangle v1="${tv[i]}" v2="${tv[i + 1]}" v3="${tv[i + 2]}"/>`);
  return `<mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh>`;
}
function threeMF(name: string, lobster: InstanceType<typeof wasm.Manifold>, marks: InstanceType<typeof wasm.Manifold>): Uint8Array {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Title">${name}</metadata>
 <resources>
  <object id="1" name="lobster" type="model">${meshXml(lobster)}</object>
  <object id="2" name="marks" type="model">${meshXml(marks)}</object>
  <object id="3" name="${name}" type="model"><components><component objectid="1"/><component objectid="2"/></components></object>
 </resources>
 <build><item objectid="3" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build>
</model>`;
  // Bambu/Orca read per-part filament assignments from here.
  const part = (id: number, n: string, extruder: number) =>
    `  <part id="${id}" subtype="normal_part">\n   <metadata key="name" value="${n}"/>\n   <metadata key="extruder" value="${extruder}"/>\n  </part>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="3">
  <metadata key="name" value="${name}"/>
  <metadata key="extruder" value="1"/>
${part(1, 'lobster', 1)}
${part(2, 'marks', 2)}
 </object>
</config>`;
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`),
    '3D/3dmodel.model': strToU8(model),
    'Metadata/model_settings.config': strToU8(settings),
  });
}

// ---------- build ----------
mkdirSync(OUT, { recursive: true });
const missing: string[] = [];
for (const f of flavours) {
  const ids = [f.glyph, ...f.grounds.map((g) => LOCATION_ID[g])];
  const absent = ids.filter((id) => !glyph(id));
  if (absent.length) { missing.push(`${f.name} (no #${absent.join(', #')} in the SVG)`); continue; }
  const raw = CrossSection.union(ids.map((id) => glyph(id)!));
  const face = raw.intersect(outline);
  if (face.area() < raw.area() - 1e-3) console.warn(`  ! ${f.name}: marks overhang the lobster outline, clipped`);
  const marks = face.extrude(INLAY);
  const lobster = outline.extrude(HEIGHT).subtract(marks);
  const bodies = 2 + f.grounds.length; // informational: lobster, size, location marks
  writeFileSync(join(OUT, `${f.name}.3mf`), threeMF(f.name, lobster, marks));
  console.log(`${f.name.padEnd(26)} ${bodies} bodies  lobster ${lobster.volume().toFixed(0)} mm³, marks ${marks.volume().toFixed(1)} mm³`);
}
if (missing.length) console.log(`\nSkipped — add the glyph to the SVG and re-run:\n  ${missing.join('\n  ')}`);
console.log(`\n${flavours.length - missing.length} meeples → ${OUT}/  (filament 1 = lobster red, filament 2 = marks white; swap for fancy)`);
