// Earth renderer: a globe of lat/lon land, ice, clouds and city lights, projected
// with projectEarth (system spec §6.4 as amended). Lighting groups follow S and
// do not spin; the night side is a filled disc and the day side is clipped to
// litPath so both bodies share one sun. One drawing serves every size; LOD only
// adds features to the same projection.

import { clamp, lerpHex, smoothstep, fmt, seeded, el, setAttrs, RAD, DEG } from './util.js';
import { PALETTE } from './palette.js';
import { litPath, litFraction, terminatorMidpoint } from './lighting.js';
import { projectEarth, EARTH_LAT0, onDisc } from './project.js';
import { VIEW } from './scale.js';

export const CLOUD_SPIN = 0.82;
export const TWILIGHT_K = 0.035;
export const CITY_SEED = 0xC171;
export const NUDGE_SEED = 0xE4A7C10D;
export const COAST_SEED = 0xC0A57E;
const NUDGE_MS = 20 * 60 * 1000;
const NUDGE_TRANS_MS = 8000;
const NUDGE_AMP = 0.04;
const SAMPLE_N = 64;
const COAST_HALO = 1.06;
const HALO_OPACITY = 0.22;

function makeCities() {
  const raw = [
    { id: 'nyc', lat: 40.7, lon: -74.0, region: 'ne-america' },
    { id: 'bos', lat: 42.36, lon: -71.06, region: 'ne-america' },
    { id: 'phl', lat: 39.95, lon: -75.16, region: 'ne-america' },
    { id: 'was', lat: 38.91, lon: -77.04, region: 'ne-america' },
    { id: 'yyz', lat: 43.65, lon: -79.38, region: 'ne-america' },
    { id: 'lax', lat: 34.05, lon: -118.24, region: 'california' },
    { id: 'sfo', lat: 37.77, lon: -122.42, region: 'california' },
    { id: 'sao', lat: -23.55, lon: -46.63, region: 'brazil' },
    { id: 'rio', lat: -22.91, lon: -43.17, region: 'brazil' },
    { id: 'lon', lat: 51.51, lon: -0.13, region: 'europe' },
    { id: 'par', lat: 48.86, lon: 2.35, region: 'europe' },
    { id: 'ber', lat: 52.52, lon: 13.40, region: 'europe' },
    { id: 'mad', lat: 40.42, lon: -3.70, region: 'europe' },
    { id: 'rom', lat: 41.90, lon: 12.50, region: 'europe' },
    { id: 'mow', lat: 55.75, lon: 37.62, region: 'europe' },
    { id: 'cai', lat: 30.04, lon: 31.24, region: 'nile-levant' },
    { id: 'bey', lat: 33.89, lon: 35.50, region: 'nile-levant' },
    { id: 'los', lat: 6.52, lon: 3.38, region: 'nigeria' },
    { id: 'del', lat: 28.61, lon: 77.21, region: 'india' },
    { id: 'bom', lat: 19.08, lon: 72.88, region: 'india' },
    { id: 'ccu', lat: 22.57, lon: 88.36, region: 'india' },
    { id: 'tyo', lat: 35.68, lon: 139.69, region: 'east-asia' },
    { id: 'osa', lat: 34.69, lon: 135.50, region: 'east-asia' },
    { id: 'sel', lat: 37.57, lon: 126.98, region: 'east-asia' },
    { id: 'pek', lat: 39.90, lon: 116.41, region: 'east-asia' },
    { id: 'sha', lat: 31.23, lon: 121.47, region: 'east-asia' },
    { id: 'hkg', lat: 22.32, lon: 114.17, region: 'east-asia' },
    { id: 'tpe', lat: 25.03, lon: 121.57, region: 'east-asia' },
  ];
  return raw.map((c, i) => {
    const rng = seeded(CITY_SEED + i);
    return {
      ...c,
      rFrac: 0.008 + rng() * 0.008,
      opacity: 0.55 + rng() * 0.35,
    };
  });
}

// Spec §6.4 table as lat/lon shapes. Continents are split into a main ellipse plus
// a few lobes so they keep plausible relative scale instead of one disc-filling oval.
// minBand 1 is the three blobs drawn at 6–18 px; the rest wait until 18 px.
export const EARTH_SHAPES = {
  land: [
    {
      id: 'americas', lat: 46, lon: -100, dLat: 18, dLon: 22, rot: -20,
      fill: 'earth-land', minBand: 1,
      lobes: [
        { lat: 64, lon: -152, dLat: 7, dLon: 14, rot: 22 },
        { lat: 52, lon: -68, dLat: 8, dLon: 8, rot: -28 },
      ],
    },
    { id: 'amazon', lat: -12, lon: -58, dLat: 20, dLon: 13, rot: 16, fill: 'earth-land', minBand: 2 },
    { id: 'africa', lat: 4, lon: 20, dLat: 28, dLon: 14, rot: 10, fill: 'earth-land', minBand: 1 },
    { id: 'sahara', lat: 22, lon: 10, dLat: 8, dLon: 16, rot: -4, fill: 'earth-land-arid', minBand: 2 },
    {
      id: 'eurasia', lat: 58, lon: 90, dLat: 13, dLon: 26, rot: -8,
      fill: 'earth-land', minBand: 1,
      lobes: [
        { lat: 54, lon: 22, dLat: 10, dLon: 14, rot: -16 },
        { lat: 62, lon: 140, dLat: 8, dLon: 16, rot: 6 },
        { lat: 48, lon: 58, dLat: 8, dLon: 12, rot: 4 },
      ],
    },
    { id: 'se-asia', lat: 12, lon: 108, dLat: 11, dLon: 16, rot: 16, fill: 'earth-land', minBand: 2 },
    { id: 'australia', lat: -25, lon: 134, dLat: 9, dLon: 14, rot: 12, fill: 'earth-land', minBand: 2 },
    { id: 'greenland', lat: 71, lon: -42, dLat: 10, dLon: 11, rot: 8, fill: 'earth-land-ice', minBand: 2, ice: true },
    { id: 'antarctica', lat: -90, lon: 0, dLat: 28, dLon: 180, rot: 0, fill: 'earth-land-ice', minBand: 2, ice: true, polar: true },
  ],
  clouds: [
    { id: 'eq-a', lat: 8, lon: -36, dLat: 7, dLon: 32, rot: -10 },
    { id: 'eq-b', lat: -5, lon: 28, dLat: 6, dLon: 30, rot: 8 },
    { id: 'eq-c', lat: 3, lon: 128, dLat: 7, dLon: 26, rot: -6 },
    { id: 'midn-a', lat: 56, lon: -96, dLat: 8, dLon: 26, rot: 10 },
    { id: 'midn-b', lat: 61, lon: 88, dLat: 7, dLon: 24, rot: -12 },
    { id: 'mids', lat: -36, lon: 72, dLat: 6, dLon: 30, rot: 10 },
  ],
  cities: makeCities(),
};

function idSeed(id) {
  let h = COAST_SEED;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

const TERM_CACHE = new Map();

function coastTerms(id, kind) {
  const key = `${kind}:${id}`;
  if (TERM_CACHE.has(key)) return TERM_CACHE.get(key);
  const rng = seeded(idSeed(key));
  const amp0 = kind === 'cloud' ? 0.16 : kind === 'ice' ? 0.16 : 0.15;
  const nH = kind === 'cloud' ? 5 : 6;
  const terms = [];
  for (let i = 0; i < nH; i++) {
    terms.push({
      k: i + 2,
      amp: amp0 * (1 - i / (nH + 1)) * (0.45 + 0.7 * rng()),
      phase: rng() * Math.PI * 2,
    });
  }
  TERM_CACHE.set(key, terms);
  return terms;
}

function coastWobble(terms, t) {
  let s = 1;
  for (const h of terms) s += h.amp * Math.sin(h.k * t + h.phase);
  return clamp(s, 0.62, 1.42);
}

function coastKind(shape) {
  if (shape.cloud || shape.kind === 'frag' || shape.kind === 'high' || shape.kind === 'main') return 'cloud';
  if (shape.ice || shape.polar) return 'ice';
  return 'land';
}

function buildCloudPieces() {
  const pieces = [];
  for (const c of EARTH_SHAPES.clouds) {
    pieces.push({ ...c, kind: 'main', parent: c.id, cloud: true });
    const rng = seeded((0xC10DF00D + idSeed(c.id)) >>> 0);
    const nFrag = 2;
    for (let i = 0; i < nFrag; i++) {
      pieces.push({
        id: `${c.id}-f${i}`,
        parent: c.id,
        kind: 'frag',
        cloud: true,
        lat: clamp(c.lat + (rng() * 2 - 1) * c.dLat * 0.95, -78, 80),
        lon: wrapLon(c.lon + (rng() * 2 - 1) * c.dLon * 0.9),
        dLat: c.dLat * (0.28 + rng() * 0.42),
        dLon: c.dLon * (0.22 + rng() * 0.48),
        rot: (c.rot || 0) + (rng() * 64 - 32),
      });
    }
  }
  const rng = seeded(0xA11C1E);
  for (let i = 0; i < 4; i++) {
    pieces.push({
      id: `high-${i}`,
      parent: null,
      kind: 'high',
      cloud: true,
      lat: 58 + rng() * 12,
      lon: wrapLon(-140 + i * 90 + (rng() * 18 - 9)),
      dLat: 3.6 + rng() * 2.8,
      dLon: 8 + rng() * 8,
      rot: rng() * 36 - 18,
    });
  }
  return pieces;
}

export const CLOUD_PIECES = buildCloudPieces();

export function lodBand(r) {
  if (r < 6) return 0;
  if (r < 18) return 1;
  if (r < 70) return 2;
  if (r <= 160) return 3;
  return 4;
}

export function earthNodeBudget(band) {
  const b = Number(band) || 0;
  const landN = EARTH_SHAPES.land.length;
  const lod1N = EARTH_SHAPES.land.filter((s) => (s.minBand ?? 2) <= 1).length;
  const cloudN = CLOUD_PIECES.length;
  const cityN = EARTH_SHAPES.cities.length;
  let n = 4;
  if (b >= 1) n += (b >= 2 ? landN : lod1N) * 2;
  if (b >= 2) n += 2;
  if (b >= 3) n += cloudN * 2 + 1 + cityN;
  return n;
}

export function wrapLon(lon) {
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

export function sampleEllipse(shape, n = SAMPLE_N, rxScale = 1) {
  const pts = [];
  const terms = coastTerms(shape.id || 'shape', coastKind(shape));
  if (shape.polar) {
    const cap0 = shape.dLat * rxScale;
    const pole = shape.lat < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n;
      const cap = cap0 * coastWobble(terms, t);
      pts.push({ lat: clamp(pole * (90 - cap), -90, 90), lon: (t * 180) / Math.PI });
    }
    return pts;
  }
  const rot = (shape.rot || 0) * RAD;
  const rx = (shape.dLon || 1) * rxScale;
  const ry = shape.dLat || 1;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const w = coastWobble(terms, t);
    const ex = rx * Math.cos(t) * w;
    const ey = ry * Math.sin(t) * (0.9 + 0.1 * w);
    const x = ex * cr - ey * sr;
    const y = ex * sr + ey * cr;
    pts.push({ lat: clamp(shape.lat + y, -90, 90), lon: shape.lon + x });
  }
  return pts;
}

export function inverseProjectEarth(x, y, cosc, spinDeg) {
  const lat0 = EARTH_LAT0 * RAD;
  const lon0 = -spinDeg * RAD;
  const X = x;
  const Y = -y;
  const Z = cosc;
  const sinLat = clamp(Z * Math.sin(lat0) + Y * Math.cos(lat0), -1, 1);
  const lat = Math.asin(sinLat) * DEG;
  const lon = (lon0 + Math.atan2(X, Z * Math.cos(lat0) - Y * Math.sin(lat0))) * DEG;
  return { lat, lon: wrapLon(lon) };
}

function inOneEllipse(lat, lon, shape) {
  if (shape.polar) {
    const pole = shape.lat < 0 ? -90 : 90;
    return Math.abs(lat - pole) <= shape.dLat + 1e-9;
  }
  const dLat = lat - shape.lat;
  const dLon = wrapLon(lon - shape.lon);
  const rot = -(shape.rot || 0) * RAD;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const x = dLon * c - dLat * s;
  const y = dLon * s + dLat * c;
  const rx = shape.dLon || 1;
  const ry = shape.dLat || 1;
  return (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
}

export function pointInEllipse(lat, lon, shape) {
  if (inOneEllipse(lat, lon, shape)) return true;
  const lobes = shape.lobes;
  if (!lobes) return false;
  for (const lobe of lobes) {
    if (inOneEllipse(lat, lon, { ...shape, ...lobe, lobes: undefined, polar: false })) return true;
  }
  return false;
}

export function pointInLand(lat, lon) {
  return EARTH_SHAPES.land.some((s) => pointInEllipse(lat, lon, s));
}

function limbPoint(a, b) {
  const t = a.cosc / (a.cosc - b.cosc);
  let x = a.x + t * (b.x - a.x);
  let y = a.y + t * (b.y - a.y);
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m, cosc: 0, limb: true };
}

function shortDelta(a0, a1) {
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function limbArcInside(from, to, shape, spinDeg) {
  const t0 = Math.atan2(from.y, from.x);
  const t1 = Math.atan2(to.y, to.x);
  const dShort = shortDelta(t0, t1);
  const dLong = dShort >= 0 ? dShort - 2 * Math.PI : dShort + 2 * Math.PI;
  const score = (delta) => {
    const t = t0 + delta / 2;
    const ll = inverseProjectEarth(Math.cos(t), Math.sin(t), 0, spinDeg);
    return pointInEllipse(ll.lat, ll.lon, shape) ? 1 : 0;
  };
  const delta = score(dShort) >= score(dLong) ? dShort : dLong;
  const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 32)));
  const pts = [];
  for (let i = 1; i < steps; i++) {
    const t = t0 + (delta * i) / steps;
    pts.push({ x: Math.cos(t), y: Math.sin(t) });
  }
  return pts;
}

function clipToHemisphere(samples, shape, spinDeg) {
  const n = samples.length;
  const vis = (i) => samples[((i % n) + n) % n].cosc > 0;
  if (![...Array(n).keys()].some(vis)) return [];
  if ([...Array(n).keys()].every(vis)) return [samples.map((p) => ({ x: p.x, y: p.y }))];

  const starts = [];
  for (let i = 0; i < n; i++) if (!vis(i) && vis(i + 1)) starts.push(i);

  const rings = [];
  for (const s of starts) {
    const chain = [limbPoint(samples[s], samples[(s + 1) % n])];
    let j = (s + 1) % n;
    for (let step = 0; step < n; step++) {
      chain.push({ x: samples[j].x, y: samples[j].y });
      const nxt = (j + 1) % n;
      if (!vis(nxt)) {
        chain.push(limbPoint(samples[j], samples[nxt]));
        break;
      }
      j = nxt;
    }
    const a = chain[chain.length - 1];
    const b = chain[0];
    const arc = limbArcInside(a, b, shape, spinDeg);
    const ring = chain.concat(arc).map((q) => ({ x: q.x, y: q.y }));
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function shapeParts(shape) {
  const main = { ...shape, lobes: undefined };
  if (!shape.lobes || !shape.lobes.length) return [main];
  return [main, ...shape.lobes.map((lobe, i) => ({
    ...shape,
    ...lobe,
    id: `${shape.id}-lobe-${i}`,
    lobes: undefined,
    polar: false,
  }))];
}

function projectOne(shape, spinDeg, opts) {
  const n = opts.samples ?? SAMPLE_N;
  const rxScale = opts.rxScale ?? 1;
  const spin = opts.cloud ? spinDeg * CLOUD_SPIN : spinDeg;
  const outline = sampleEllipse(shape, n, rxScale);
  const proj = outline.map((p) => {
    const q = projectEarth(p.lat, p.lon, spin);
    return { lat: p.lat, lon: p.lon, x: q.x, y: q.y, cosc: q.cosc };
  });
  return clipToHemisphere(proj, shape, spin);
}

export function projectAndClip(shape, spinDeg, opts = {}) {
  const rings = [];
  for (const part of shapeParts(shape)) {
    const partRings = projectOne(part, spinDeg, opts);
    for (const ring of partRings) rings.push(ring);
  }
  return rings;
}

export function ringsToPath(rings, disc, ox = 0, oy = 0) {
  let d = '';
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const X = (p) => fmt(disc.cx + p.x * disc.r + ox);
    const Y = (p) => fmt(disc.cy + p.y * disc.r + oy);
    d += `M ${X(ring[0])} ${Y(ring[0])}`;
    for (let i = 1; i < ring.length; i++) d += ` L ${X(ring[i])} ${Y(ring[i])}`;
    d += ' Z';
  }
  return d;
}

export function earthLitPath(cx, cy, r, sun) {
  return litPath(cx, cy, r, sun, 0);
}

export function nightFraction(sun) {
  return 1 - litFraction(sun);
}

export function cityLightsOn(r, sun) {
  return r >= 70 && nightFraction(sun) >= 0.15;
}

export function limbRingMode(angularDia) {
  if (angularDia < 4) return 'off';
  if (angularDia < 8) return 'stroke';
  return 'ring';
}

export function glintAllowed(frame) {
  const r = frame.earth?.r ?? 0;
  const ang = frame.state?.heroEarthAngularDia ?? 0;
  const sun = frame.sun;
  if (r < 70 || ang < 10 || !sun || sun.sz <= 0) return false;
  const spin = frame.earthSpinDeg ?? 0;
  const ll = inverseProjectEarth(sun.sx, sun.sy, sun.sz, spin);
  if (pointInLand(ll.lat, ll.lon)) return false;
  return true;
}

function nudgeForSlot(slot) {
  if (slot < 0) return EARTH_SHAPES.clouds.map(() => 1);
  return EARTH_SHAPES.clouds.map((_, i) => {
    const rng = seeded((NUDGE_SEED + slot * 17 + i) >>> 0);
    return 1 + (rng() * 2 - 1) * NUDGE_AMP;
  });
}

export function cloudNudges(nowMs, live, reducedMotion) {
  const ones = EARTH_SHAPES.clouds.map(() => 1);
  if (!live || reducedMotion) return ones;
  const t = Math.max(0, Number(nowMs) || 0);
  const slot = Math.floor(t / NUDGE_MS);
  const phase = t - slot * NUDGE_MS;
  const u = phase < NUDGE_TRANS_MS ? smoothstep(phase / NUDGE_TRANS_MS) : 1;
  const prev = nudgeForSlot(slot - 1);
  const next = nudgeForSlot(slot);
  return prev.map((p, i) => p + (next[i] - p) * u);
}

function parentNudge(piece, nudges) {
  if (!piece.parent) return 1;
  const i = EARTH_SHAPES.clouds.findIndex((c) => c.id === piece.parent);
  return i >= 0 ? nudges[i] : 1;
}

function landFill(token, r, gain, limbFrac, ice) {
  const grey = PALETTE['bone-dim'];
  const distU = clamp((r - 16) / 52, 0, 1);
  let c = lerpHex(grey, PALETTE[token] || PALETTE['earth-land'], 0.35 + 0.65 * distU);
  const limb = ice ? 0.18 * limbFrac * limbFrac : 0.42 * limbFrac * limbFrac;
  c = lerpHex(c, ice ? PALETTE['earth-cloud'] : grey, limb);
  if (gain < 1) c = lerpHex(PALETTE.void, c, clamp(gain, 0.55, 1));
  return c;
}

function nightFill(r) {
  const u = clamp((52 - r) / 44, 0, 1);
  return lerpHex(PALETTE['earth-night'], PALETTE['earth-ocean-deep'], 0.58 * u);
}

function limbFracOf(shape, spin) {
  const p = projectEarth(shape.lat, shape.lon, spin);
  if (p.cosc <= 0) return 1;
  return clamp(Math.hypot(p.x, p.y), 0, 1);
}

function show(node, on) {
  setAttrs(node, { display: on ? 'inline' : 'none' });
}

function addStops(grad, stops) {
  for (const s of stops) {
    el('stop', {
      offset: s.offset,
      'stop-color': s.color,
      'stop-opacity': s.opacity,
    }, grad);
  }
  return grad;
}

export function createEarth(layer, ctx) {
  const defs = ctx?.defs || el('defs', {}, ctx?.svg || layer);
  const owned = [];
  const take = (node) => {
    owned.push(node);
    return node;
  };

  const discClip = take(el('clipPath', { id: 'earth-disc-clip', clipPathUnits: 'userSpaceOnUse' }, defs));
  const discClipCircle = el('circle', {}, discClip);

  const litClip = take(el('clipPath', { id: 'earth-lit-clip', clipPathUnits: 'userSpaceOnUse' }, defs));
  const litClipPath = el('path', { id: 'earth-lit-clip-path' }, litClip);

  const twilightMask = take(el('mask', { id: 'earth-twilight-mask', maskUnits: 'userSpaceOnUse' }, defs));
  el('rect', { x: '0', y: '0', width: fmt(VIEW.w), height: fmt(VIEW.h), fill: '#000000' }, twilightMask);
  const twilightWide = el('path', { fill: '#FFFFFF' }, twilightMask);
  const twilightNarrow = el('path', { fill: '#000000' }, twilightMask);

  const nightMask = take(el('mask', { id: 'earth-night-mask', maskUnits: 'userSpaceOnUse' }, defs));
  el('rect', { x: '0', y: '0', width: fmt(VIEW.w), height: fmt(VIEW.h), fill: '#000000' }, nightMask);
  const nightMaskDisc = el('circle', { fill: '#FFFFFF' }, nightMask);
  const nightMaskLit = el('path', { fill: '#000000' }, nightMask);

  const oceanGrad = take(el('linearGradient', {
    id: 'earth-ocean-grad',
    gradientUnits: 'userSpaceOnUse',
    x1: '0', y1: '0', x2: '1', y2: '0',
  }, defs));
  addStops(oceanGrad, [
    { offset: '0', color: PALETTE['earth-ocean-deep'], opacity: '1' },
    { offset: '0.38', color: PALETTE['earth-ocean-mid'], opacity: '1' },
    { offset: '1', color: PALETTE['earth-ocean-lit'], opacity: '1' },
  ]);

  const limbGrad = take(el('radialGradient', {
    id: 'earth-limb-grad',
    cx: '50%', cy: '50%', r: '50%',
  }, defs));
  addStops(limbGrad, [
    { offset: '0.96', color: PALETTE['earth-limb'], opacity: '0' },
    { offset: '0.984', color: PALETTE['earth-limb'], opacity: '0.55' },
    { offset: '0.994', color: PALETTE['earth-limb'], opacity: '0.22' },
    { offset: '1', color: PALETTE['earth-limb'], opacity: '0' },
  ]);

  const glintGrad = take(el('radialGradient', {
    id: 'earth-glint-grad',
    cx: '50%', cy: '50%', r: '50%',
  }, defs));
  addStops(glintGrad, [
    { offset: '0', color: PALETTE['earth-ocean-glint'], opacity: '0.55' },
    { offset: '1', color: PALETTE['earth-ocean-glint'], opacity: '0' },
  ]);

  const twilightGrad = take(el('linearGradient', {
    id: 'earth-twilight-grad',
    gradientUnits: 'userSpaceOnUse',
    x1: '0', y1: '0', x2: '1', y2: '0',
  }, defs));
  addStops(twilightGrad, [
    { offset: '0', color: PALETTE['earth-night'], opacity: '0.85' },
    { offset: '0.5', color: PALETTE['earth-night'], opacity: '0.35' },
    { offset: '1', color: PALETTE['earth-night'], opacity: '0' },
  ]);

  const root = take(el('g', { id: 'earth-root', 'pointer-events': 'none' }, layer));
  const clipped = el('g', { id: 'earth-body', 'clip-path': 'url(#earth-disc-clip)' }, root);

  const night = el('circle', {
    id: 'earth-night',
    fill: PALETTE['earth-night'],
  }, clipped);

  const dayG = el('g', { id: 'earth-day', 'clip-path': 'url(#earth-lit-clip)' }, clipped);
  const ocean = el('circle', { id: 'earth-ocean', fill: 'url(#earth-ocean-grad)' }, dayG);

  const landHaloG = el('g', { id: 'earth-land-halo', opacity: fmt(HALO_OPACITY) }, dayG);
  const landHaloNodes = EARTH_SHAPES.land.map((shape) =>
    el('path', { id: `earth-land-halo-${shape.id}`, fill: PALETTE[shape.fill] }, landHaloG));

  const landG = el('g', { id: 'earth-land' }, dayG);
  const landNodes = EARTH_SHAPES.land.map((shape) =>
    el('path', { id: `earth-land-${shape.id}`, fill: PALETTE[shape.fill] }, landG));

  const cloudG = el('g', { id: 'earth-clouds' }, dayG);
  const cloudShadeNodes = CLOUD_PIECES.map((shape) =>
    el('path', {
      id: `earth-cloud-shade-${shape.id}`,
      fill: PALETTE['earth-cloud-shade'],
      opacity: shape.kind === 'main' ? '0.18' : '0.12',
    }, cloudG));
  const cloudNodes = CLOUD_PIECES.map((shape) =>
    el('path', {
      id: `earth-cloud-${shape.id}`,
      fill: PALETTE['earth-cloud'],
      opacity: shape.kind === 'main' ? '0.34' : '0.22',
    }, cloudG));

  const lighting = el('g', { id: 'earth-lighting' }, clipped);
  const twilight = el('circle', {
    id: 'earth-twilight',
    fill: 'url(#earth-twilight-grad)',
    mask: 'url(#earth-twilight-mask)',
  }, lighting);

  const citiesG = el('g', {
    id: 'earth-cities',
    mask: 'url(#earth-night-mask)',
    'mix-blend-mode': 'screen',
  }, lighting);
  const cityNodes = EARTH_SHAPES.cities.map((c) =>
    el('circle', {
      id: `earth-city-${c.id}`,
      fill: PALETTE['earth-city'],
      opacity: fmt(c.opacity),
    }, citiesG));

  const glintG = el('g', { id: 'earth-glint-clip', 'clip-path': 'url(#earth-lit-clip)' }, lighting);
  const glint = el('ellipse', {
    id: 'earth-glint',
    fill: 'url(#earth-glint-grad)',
    'mix-blend-mode': 'screen',
  }, glintG);

  const litMark = el('path', {
    id: 'earth-lit',
    class: 'lit',
    'data-lit': '1',
    fill: 'none',
    stroke: 'none',
  }, lighting);

  const limbG = el('g', { id: 'earth-limb' }, root);
  const limbRing = el('circle', { id: 'earth-limb-ring', fill: 'url(#earth-limb-grad)' }, limbG);
  const limbStroke = el('circle', {
    id: 'earth-limb-stroke',
    fill: 'none',
    stroke: PALETTE['earth-limb'],
    'stroke-width': '1.2',
    opacity: '0.35',
  }, limbG);

  let cacheKey = '';

  function update(frame, nowMs) {
    const e = frame?.earth;
    if (!e || e.visible === false || !(e.r > 0)) {
      setAttrs(root, { display: 'none' });
      return;
    }
    setAttrs(root, { display: 'inline' });

    const sun = frame.sun;
    const spin = frame.earthSpinDeg || 0;
    const gain = frame.gain == null ? 1 : frame.gain;
    const band = lodBand(e.r);
    const nudges = cloudNudges(nowMs, !!frame.live, !!frame.reducedMotion);
    const ang = frame.state?.heroEarthAngularDia ?? 0;
    const key = [
      e.cx, e.cy, e.r, spin,
      sun.sx, sun.sy, sun.sz, sun.azDeg,
      band, ang, gain,
      frame.live ? 1 : 0,
      frame.reducedMotion ? 1 : 0,
      nudges.join(','),
    ].join('|');
    if (key === cacheKey) return;
    cacheKey = key;

    const disc = { cx: e.cx, cy: e.cy, r: e.r };
    setAttrs(discClipCircle, { cx: fmt(e.cx), cy: fmt(e.cy), r: fmt(e.r) });
    setAttrs(ocean, { cx: fmt(e.cx), cy: fmt(e.cy), r: fmt(e.r) });
    setAttrs(night, { cx: fmt(e.cx), cy: fmt(e.cy), r: fmt(e.r), fill: nightFill(e.r) });
    setAttrs(twilight, { cx: fmt(e.cx), cy: fmt(e.cy), r: fmt(e.r) });
    setAttrs(nightMaskDisc, { cx: fmt(e.cx), cy: fmt(e.cy), r: fmt(e.r) });
    show(night, true);

    const a = sun.azDeg * RAD;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    setAttrs(oceanGrad, {
      x1: fmt(e.cx - e.r * ca),
      y1: fmt(e.cy - e.r * sa),
      x2: fmt(e.cx + e.r * ca),
      y2: fmt(e.cy + e.r * sa),
    });

    const lit = earthLitPath(e.cx, e.cy, e.r, sun);
    setAttrs(litClipPath, { d: lit, 'data-az': fmt(sun.azDeg) });
    setAttrs(nightMaskLit, { d: lit });
    setAttrs(litMark, { d: lit, 'data-az': fmt(sun.azDeg) });
    setAttrs(twilightWide, { d: litPath(e.cx, e.cy, e.r, sun, TWILIGHT_K) });
    setAttrs(twilightNarrow, { d: litPath(e.cx, e.cy, e.r, sun, -TWILIGHT_K) });

    const mid = terminatorMidpoint(e.cx, e.cy, e.r, sun);
    const half = 0.07 * e.r;
    setAttrs(twilightGrad, {
      x1: fmt(mid.x - half * ca),
      y1: fmt(mid.y - half * sa),
      x2: fmt(mid.x + half * ca),
      y2: fmt(mid.y + half * sa),
    });

    const landSamples = clamp(Math.round(56 + e.r / 12), 56, 168);
    const landOn = band >= 1;
    show(landG, landOn);
    show(landHaloG, landOn);
    if (landOn) {
      for (let i = 0; i < EARTH_SHAPES.land.length; i++) {
        const shape = EARTH_SHAPES.land[i];
        const on = band >= (shape.minBand ?? 2);
        show(landNodes[i], on);
        show(landHaloNodes[i], on);
        if (!on) continue;
        const rings = projectAndClip(shape, spin, { samples: landSamples });
        const halo = projectAndClip(shape, spin, { samples: landSamples, rxScale: COAST_HALO });
        const d = ringsToPath(rings, disc);
        const dHalo = ringsToPath(halo, disc);
        const edge = band >= 4;
        const fill = landFill(shape.fill, e.r, gain, limbFracOf(shape, spin), !!shape.ice);
        setAttrs(landHaloNodes[i], {
          d: dHalo || null,
          fill: lerpHex(fill, PALETTE['earth-ocean-mid'], 0.4),
        });
        setAttrs(landNodes[i], {
          d: d || null,
          fill,
          stroke: edge ? lerpHex(PALETTE[shape.fill], PALETTE['earth-ocean-deep'], 0.55) : 'none',
          'stroke-width': edge ? '1' : '0',
        });
      }
    }

    const cloudsOn = band >= 3;
    show(cloudG, cloudsOn);
    if (cloudsOn) {
      const nh = Math.hypot(sun.sx, sun.sy) || 1;
      const shade = Math.min(0.02 * e.r, 8);
      const ox = -shade * sun.sx / nh;
      const oy = -shade * sun.sy / nh;
      const cloudSamples = clamp(Math.round(40 + e.r / 16), 40, 128);
      for (let i = 0; i < CLOUD_PIECES.length; i++) {
        const shape = CLOUD_PIECES[i];
        const rings = projectAndClip(shape, spin, {
          cloud: true,
          rxScale: parentNudge(shape, nudges),
          samples: cloudSamples,
        });
        const d = ringsToPath(rings, disc);
        const dShade = ringsToPath(rings, disc, ox, oy);
        setAttrs(cloudShadeNodes[i], { d: dShade || null });
        setAttrs(cloudNodes[i], { d: d || null });
      }
    }

    const twilightOn = band >= 1;
    show(twilight, twilightOn);

    const citiesOk = band >= 3 && cityLightsOn(e.r, sun);
    show(citiesG, citiesOk);
    if (citiesOk) {
      for (let i = 0; i < EARTH_SHAPES.cities.length; i++) {
        const c = EARTH_SHAPES.cities[i];
        const p = projectEarth(c.lat, c.lon, spin);
        const nightDot = p.x * sun.sx + p.y * sun.sy + p.cosc * sun.sz < 0;
        const on = p.cosc > 0 && nightDot;
        show(cityNodes[i], on);
        if (!on) continue;
        const q = onDisc(p, disc);
        setAttrs(cityNodes[i], { cx: fmt(q.x), cy: fmt(q.y), r: fmt(c.rFrac * e.r) });
      }
    }

    const glintOn = band >= 3 && glintAllowed(frame);
    show(glintG, glintOn);
    if (glintOn) {
      const gx = e.cx + sun.sx * e.r;
      const gy = e.cy + sun.sy * e.r;
      setAttrs(glint, {
        cx: fmt(gx),
        cy: fmt(gy),
        rx: fmt(0.08 * e.r),
        ry: fmt(0.045 * e.r),
        transform: `rotate(${fmt(sun.azDeg)} ${fmt(gx)} ${fmt(gy)})`,
        opacity: fmt(clamp(gain, 0.4, 1.2)),
      });
    }

    const limbHow = band >= 2 ? limbRingMode(ang) : 'off';
    const limbOpacity = 0.45 + 0.55 * (0.5 + 0.5 * sun.sz);
    show(limbRing, limbHow === 'ring');
    show(limbStroke, limbHow === 'stroke');
    if (limbHow === 'ring') {
      setAttrs(limbRing, {
        cx: fmt(e.cx),
        cy: fmt(e.cy),
        r: fmt(e.r * 1.022),
        opacity: fmt(clamp(limbOpacity * clamp(gain, 0.4, 1.2), 0.35, 1.15)),
      });
    }
    if (limbHow === 'stroke') {
      setAttrs(limbStroke, { cx: fmt(e.cx), cy: fmt(e.cy), r: fmt(e.r) });
    }

    setAttrs(root, {
      'data-band': String(band),
      'data-limb': limbHow,
      'data-glint': glintOn ? '1' : '0',
      'data-cities': citiesOk ? '1' : '0',
      'data-az': fmt(sun.azDeg),
    });
  }

  function destroy() {
    cacheKey = '';
    for (const n of owned) n.remove();
    owned.length = 0;
  }

  return { update, destroy };
}
