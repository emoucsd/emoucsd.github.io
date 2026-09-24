// Instrument figures for the log column (system spec §6.8.3 and §8.1).
// Content names an op and parameters; this module sanitises them and draws a vector
// diagram. Unknown ops return null. Nothing from content is interpreted as markup.

import { clamp, fmt, seeded, el, lerpHex, RAD } from './util.js';
import { PALETTE } from './palette.js';

export const FIGURE_OPS = Object.freeze([
  'SpectrumTrace',
  'ThermalMap',
  'StarFieldCrop',
  'RangingReturn',
  'StripChart',
  'PointingDiagram',
]);

export const FIGURE_SIZE = Object.freeze({ w: 280, h: 160 });
export const CAPTION_MAX = 90;
export const LABEL_MAX = 24;
export const TRACE_SAMPLES = 240;
export const THERMAL_STOPS = Object.freeze(['#2A3A88', '#4A6888', PALETTE.void, '#C07848', '#C05030']);

// Light-time for ranging, km/s. Kept local so this module does not read the physics table.
const C_KMS = 299792.458;

const VW = FIGURE_SIZE.w;
const VH = FIGURE_SIZE.h;
const PLOT = Object.freeze({ x: 34, y: 12, w: 236, h: 108 });

const FAINT = 'var(--bone-faint)';
const MID = 'var(--bone-mid)';
const BONE = 'var(--bone)';
const SUN = 'var(--sunlight)';
const VOID = 'var(--void)';
const MONO = 'var(--font-mono)';
const STAR = 'var(--star-k5800)';
const STAR_DIM = 'var(--star-dim)';

const SERIES_STROKE = ['var(--bone)', 'var(--bone-mid)', 'var(--bone-dim)'];

let figSeq = 0;

export const NODE_BOUNDS = Object.freeze({
  SpectrumTrace: 48,
  ThermalMap: 24 * 16 + 28,
  StarFieldCrop: 90,
  RangingReturn: 48,
  StripChart: 56,
  PointingDiagram: 48,
});

function isPlain(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function finite(v, dflt) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return dflt;
}

function textOf(v, max) {
  if (typeof v === 'string') return v.slice(0, max);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v).slice(0, max);
  return '';
}

function num(v, lo, hi, dflt) {
  return clamp(finite(v, dflt), lo, hi);
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function pickMark(list) {
  if (!list.length) return list;
  let idx = list.findIndex((x) => x.mark);
  if (idx < 0) idx = list.findIndex((x) => x.label);
  if (idx < 0) idx = 0;
  return list.map((x, i) => Object.assign({}, x, { mark: i === idx }));
}

function enumOf(v, allowed, dflt) {
  return allowed.includes(v) ? v : dflt;
}

// PointSource magnitude law, spec §6.8.1 #1. r = 1.6 · 10^(−0.15(mag−1)) px, clamped 0.6..7.
export function pointSourceRadius(mag) {
  const m = finite(mag, 6);
  return clamp(1.6 * 10 ** (-0.15 * (m - 1)), 0.6, 7);
}

// Five-stop false-colour lookup shared with SurfacePatch (§6.8.1 #6). u is 0 (cold) .. 1 (hot).
export function thermalColor(u) {
  const t = clamp(finite(u, 0), 0, 1) * 4;
  const i = Math.min(3, Math.floor(t));
  const f = t - i;
  const a = THERMAL_STOPS[i];
  const b = THERMAL_STOPS[i + 1];
  return lerpHex(a, b, f);
}

export function rangingDistanceKm(tUs) {
  return C_KMS * (finite(tUs, 0) * 1e-6) / 2;
}

// Gnomonic projection onto the tangent plane at (az0, el0). az from north toward east,
// el from the horizon. Returns null if the point is behind the tangent plane.
export function gnomonic(azDeg, elDeg, az0, el0) {
  const p = azElDir(azDeg, elDeg);
  const c = azElDir(az0, el0);
  const east = unit({ x: Math.cos(az0 * RAD), y: -Math.sin(az0 * RAD), z: 0 });
  const north = unit(cross(east, c));
  const d = p.x * c.x + p.y * c.y + p.z * c.z;
  if (d <= 1e-4) return null;
  return {
    x: (p.x * east.x + p.y * east.y + p.z * east.z) / d,
    y: (p.x * north.x + p.y * north.y + p.z * north.z) / d,
  };
}

function azElDir(azDeg, elDeg) {
  const a = azDeg * RAD;
  const e = elDeg * RAD;
  const ce = Math.cos(e);
  return { x: ce * Math.sin(a), y: ce * Math.cos(a), z: Math.sin(e) };
}

function unit(v) {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function slerpDir(a, b, u) {
  const d = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  const th = Math.acos(d);
  if (th < 1e-6) return a;
  const s = Math.sin(th);
  const w0 = Math.sin((1 - u) * th) / s;
  const w1 = Math.sin(u * th) / s;
  return unit({ x: w0 * a.x + w1 * b.x, y: w0 * a.y + w1 * b.y, z: w0 * a.z + w1 * b.z });
}

function dayRng(day) {
  const d = Math.floor(finite(day, 0));
  // Seed is a function of the day number so a day's figure is stable across visits.
  return seeded((d + 1) * 0x9e3779b9);
}

function gauss(x, mu, width) {
  const sigma = Math.max(1e-9, width / 2.355);
  const q = (x - mu) / sigma;
  return Math.exp(-0.5 * q * q);
}

function planckRel(nm, T) {
  const x = 1.438777e7 / (nm * T);
  if (x > 30) return 0;
  const e = Math.exp(x);
  if (!Number.isFinite(e) || e <= 1) return 0;
  return nm ** -5 / (e - 1);
}

export function spectrumSamples(spec, day) {
  const s = sanitizeFigure(spec);
  if (!s || s.op !== 'SpectrumTrace') return { x: [], y: [] };
  const n = TRACE_SAMPLES;
  const x = new Array(n);
  const y = new Array(n);
  const span = Math.max(1e-9, s.x1_nm - s.x0_nm);
  let peak = 0;
  const raw = new Array(n);
  for (let i = 0; i < n; i++) {
    const lam = s.x0_nm + span * i / (n - 1);
    x[i] = lam;
    raw[i] = s.baseline === 'thermal' ? planckRel(lam, 5772) : 1;
    if (raw[i] > peak) peak = raw[i];
  }
  const rng = dayRng(day);
  for (let i = 0; i < n; i++) {
    let cont = s.baseline === 'thermal' ? (peak > 0 ? 0.88 * raw[i] / peak : 0.5) : 0.86;
    for (const f of s.features) cont -= f.depth * gauss(x[i], f.centre_nm, f.width_nm);
    cont += s.noise * (rng() * 2 - 1);
    y[i] = clamp(cont, 0, 1.15);
  }
  return { x, y };
}

export function rangingSamples(spec, day) {
  const s = sanitizeFigure(spec);
  if (!s || s.op !== 'RangingReturn') return { t: [], amp: [] };
  const n = TRACE_SAMPLES;
  const t = new Array(n);
  const amp = new Array(n);
  const span = Math.max(1e-9, s.t1_us - s.t0_us);
  const rng = dayRng(day);
  const jitter = 0.04 + 0.25 * s.noise_floor;
  for (let i = 0; i < n; i++) {
    const ti = s.t0_us + span * i / (n - 1);
    t[i] = ti;
    let a = s.noise_floor + jitter * (rng() * 2 - 1);
    for (const r of s.returns) a += r.amplitude * gauss(ti, r.t_us, r.width_us);
    amp[i] = clamp(a, 0, 1.12);
  }
  return { t, amp };
}

export function stripStepPath(xs, ys) {
  if (!xs.length) return '';
  let d = `M ${fmt(xs[0])} ${fmt(ys[0])}`;
  for (let i = 1; i < xs.length; i++) d += ` H ${fmt(xs[i])} V ${fmt(ys[i])}`;
  return d;
}

function sanitizeSpectrum(spec) {
  let x0 = num(spec.x0_nm, 100, 50000, 380);
  let x1 = num(spec.x1_nm, 100, 50000, 920);
  if (x1 <= x0) {
    const t = x0;
    x0 = x1;
    x1 = t;
    if (x1 <= x0) x1 = x0 + 1;
  }
  const features = asArray(spec.features).slice(0, 8).map((f) => {
    const row = isPlain(f) ? f : {};
    return {
      centre_nm: num(row.centre_nm, x0, x1, (x0 + x1) / 2),
      depth: num(row.depth, 0, 1, 0.4),
      width_nm: num(row.width_nm, 0.1, Math.max(0.1, x1 - x0), 8),
      label: textOf(row.label, LABEL_MAX),
      mark: row.mark === true,
    };
  });
  return {
    op: 'SpectrumTrace',
    x0_nm: x0,
    x1_nm: x1,
    baseline: enumOf(spec.baseline, ['flat', 'thermal'], 'flat'),
    features: pickMark(features),
    noise: num(spec.noise, 0, 0.1, 0.02),
    caption: textOf(spec.caption, CAPTION_MAX),
  };
}

function sanitizeThermal(spec) {
  const wKm = num(spec.w_km, 1, 20000, 40);
  const hKm = num(spec.h_km, 1, 20000, 28);
  const grid = gridOf(spec.grid);
  const n = grid.cols * grid.rows;
  const raw = asArray(spec.values).slice(0, n);
  const values = new Array(n);
  let last = 180;
  for (let i = 0; i < n; i++) {
    last = num(raw[i], 0, 1000, last);
    values[i] = last;
  }
  const terrain = asArray(spec.terrain).slice(0, 64).map((p) => point2(p)).filter(Boolean);
  return {
    op: 'ThermalMap',
    w_km: wKm,
    h_km: hKm,
    grid,
    values,
    terrain,
    scale_km: num(spec.scale_km, 0.1, wKm, wKm / 4),
    caption: textOf(spec.caption, CAPTION_MAX),
  };
}

function gridOf(v) {
  let cols = 12;
  let rows = 8;
  if (Array.isArray(v) && v.length >= 2) {
    cols = finite(v[0], cols);
    rows = finite(v[1], rows);
  } else if (isPlain(v)) {
    cols = finite(v.cols ?? v.w ?? v.x, cols);
    rows = finite(v.rows ?? v.h ?? v.y, rows);
  } else {
    const n = finite(v, NaN);
    if (Number.isFinite(n)) cols = n;
  }
  return { cols: Math.round(clamp(cols, 1, 24)), rows: Math.round(clamp(rows, 1, 16)) };
}

function point2(p) {
  if (Array.isArray(p) && p.length >= 2) {
    return { x: num(p[0], 0, 1, 0), y: num(p[1], 0, 1, 0) };
  }
  if (isPlain(p)) return { x: num(p.x, 0, 1, 0), y: num(p.y, 0, 1, 0) };
  return null;
}

function sanitizeStars(spec) {
  const stars = asArray(spec.stars).slice(0, 60).map((s) => {
    const row = isPlain(s) ? s : {};
    return {
      x: num(row.x, 0, 1, 0.5),
      y: num(row.y, 0, 1, 0.5),
      mag: num(row.mag, -1, 18, 6),
    };
  });
  const circled = stars.length
    ? Math.round(num(spec.circled, 0, stars.length - 1, 0))
    : 0;
  return {
    op: 'StarFieldCrop',
    stars,
    circled,
    fov_deg: num(spec.fov_deg, 0.05, 90, 1.2),
    epoch: textOf(spec.epoch, 32),
    caption: textOf(spec.caption, CAPTION_MAX),
  };
}

function sanitizeRanging(spec) {
  let t0 = num(spec.t0_us, 0, 1e7, 0);
  let t1 = num(spec.t1_us, 0, 1e7, 100);
  if (t1 <= t0) t1 = t0 + 1;
  const returns = asArray(spec.returns).slice(0, 12).map((r) => {
    const row = isPlain(r) ? r : {};
    return {
      t_us: num(row.t_us, t0, t1, (t0 + t1) / 2),
      amplitude: num(row.amplitude, 0, 1, 0.6),
      width_us: num(row.width_us, 0.01, Math.max(0.01, t1 - t0), 2),
      mark: row.mark === true,
    };
  });
  return {
    op: 'RangingReturn',
    t0_us: t0,
    t1_us: t1,
    returns: pickMark(returns),
    noise_floor: num(spec.noise_floor, 0, 1, 0.08),
    caption: textOf(spec.caption, CAPTION_MAX),
  };
}

function sanitizeStrip(spec) {
  const tHours = num(spec.t_hours, 0.1, 48, 10.5);
  const series = asArray(spec.series).slice(0, 3).map((row, i) => {
    const s = isPlain(row) ? row : {};
    const values = asArray(s.values).slice(0, 240).map((v) => num(v, -1e6, 1e6, 0));
    let band = null;
    if (s.band != null) {
      const b = s.band;
      let lo;
      let hi;
      if (Array.isArray(b) && b.length >= 2) {
        lo = finite(b[0], 0);
        hi = finite(b[1], 1);
      } else if (isPlain(b)) {
        lo = finite(b.lo ?? b.min ?? b[0], 0);
        hi = finite(b.hi ?? b.max ?? b[1], 1);
      }
      if (lo != null && hi != null && Number.isFinite(lo) && Number.isFinite(hi)) {
        if (hi < lo) {
          const tmp = lo;
          lo = hi;
          hi = tmp;
        }
        band = { lo, hi };
      }
    }
    return {
      name: textOf(s.name, LABEL_MAX) || `s${i + 1}`,
      unit: textOf(s.unit, 12),
      values,
      band,
    };
  });
  const events = asArray(spec.events).slice(0, 8).map((e) => {
    const row = isPlain(e) ? e : {};
    return { t: num(row.t, 0, tHours, 0), label: textOf(row.label, LABEL_MAX) };
  });
  return {
    op: 'StripChart',
    t_hours: tHours,
    series,
    events,
    caption: textOf(spec.caption, CAPTION_MAX),
  };
}

function sanitizePointing(spec) {
  const boresight = isPlain(spec.boresight) ? spec.boresight : {};
  const targets = asArray(spec.targets).slice(0, 6).map((t) => {
    const row = isPlain(t) ? t : {};
    return {
      az: num(row.az, -180, 360, 0),
      el: num(row.el, -90, 90, 0),
      label: textOf(row.label, LABEL_MAX),
    };
  });
  let slew = null;
  if (spec.slew_from != null && isPlain(spec.slew_from)) {
    slew = {
      az: num(spec.slew_from.az, -180, 360, 0),
      el: num(spec.slew_from.el, -90, 90, 0),
    };
  }
  return {
    op: 'PointingDiagram',
    body: enumOf(spec.body, ['earth', 'moon', 'sky'], 'moon'),
    boresight: {
      az: num(boresight.az, -180, 360, 0),
      el: num(boresight.el, -90, 90, 0),
    },
    fov_deg: num(spec.fov_deg, 0.1, 90, 8),
    targets,
    slew_from: slew,
    caption: textOf(spec.caption, CAPTION_MAX),
  };
}

const SANITIZERS = {
  SpectrumTrace: sanitizeSpectrum,
  ThermalMap: sanitizeThermal,
  StarFieldCrop: sanitizeStars,
  RangingReturn: sanitizeRanging,
  StripChart: sanitizeStrip,
  PointingDiagram: sanitizePointing,
};

export function sanitizeFigure(spec) {
  try {
    if (!isPlain(spec)) return null;
    const op = spec.op;
    const fn = SANITIZERS[op];
    if (!fn) return null;
    return fn(spec);
  } catch {
    return null;
  }
}

function hair(d, extra = {}) {
  return Object.assign({
    d,
    fill: 'none',
    stroke: extra.stroke || FAINT,
    'stroke-width': fmt(1),
    'vector-effect': 'non-scaling-stroke',
    'stroke-linejoin': 'round',
    'stroke-linecap': extra.cap || 'butt',
    'stroke-dasharray': extra.dash || null,
    'data-mark': extra.mark || null,
    'data-role': extra.role || null,
    class: extra.className || null,
  }, extra.more || {});
}

function label(parent, x, y, s, extra = {}) {
  const n = el('text', {
    x: fmt(x),
    y: fmt(y),
    fill: extra.fill || MID,
    'font-family': MONO,
    'font-size': extra.size != null ? fmt(extra.size) : fmt(13),
    'font-variant-numeric': 'tabular-nums',
    'letter-spacing': extra.tracking || '0.06em',
    'text-anchor': extra.anchor || 'start',
    'dominant-baseline': extra.baseline || 'alphabetic',
    transform: extra.transform || null,
    class: extra.className || null,
    'data-mark': extra.mark || null,
    'data-role': extra.role || null,
  }, parent);
  n.textContent = s;
  return n;
}

function polylineD(xs, ys, mapX, mapY) {
  if (!xs.length) return '';
  let d = `M ${fmt(mapX(xs[0]))} ${fmt(mapY(ys[0]))}`;
  for (let i = 1; i < xs.length; i++) d += ` L ${fmt(mapX(xs[i]))} ${fmt(mapY(ys[i]))}`;
  return d;
}

function drawAxes(svg, clipId) {
  const { x, y, w, h } = PLOT;
  el('path', hair(
    `M ${fmt(x)} ${fmt(y)} H ${fmt(x + w)} V ${fmt(y + h)} H ${fmt(x)} Z`,
    { role: 'axes' },
  ), svg);
  const defs = el('defs', {}, svg);
  const clip = el('clipPath', { id: clipId }, defs);
  el('rect', { x: fmt(x), y: fmt(y), width: fmt(w), height: fmt(h) }, clip);
}

function xOf(u) {
  return PLOT.x + clamp(u, 0, 1) * PLOT.w;
}

function yOf(u) {
  return PLOT.y + (1 - clamp(u, 0, 1)) * PLOT.h;
}

function ticksX(svg, items) {
  for (const t of items) {
    const x = xOf(t.u);
    el('path', hair(`M ${fmt(x)} ${fmt(PLOT.y + PLOT.h)} V ${fmt(PLOT.y + PLOT.h + 3)}`), svg);
    const anchor = t.u < 0.08 ? 'start' : t.u > 0.92 ? 'end' : 'middle';
    label(svg, x, PLOT.y + PLOT.h + 14, t.label, { anchor, size: 13 });
  }
}

function ticksY(svg, items) {
  for (const t of items) {
    const y = yOf(t.u);
    el('path', hair(`M ${fmt(PLOT.x)} ${fmt(y)} H ${fmt(PLOT.x - 3)}`), svg);
    label(svg, PLOT.x - 6, y + 3, t.label, { anchor: 'end', size: 13 });
  }
}

function captionOf(svg, text, clipId) {
  const id = `${clipId}-cap`;
  const defs = el('defs', {}, svg);
  const clip = el('clipPath', { id }, defs);
  el('rect', { x: fmt(PLOT.x), y: fmt(138), width: fmt(PLOT.w), height: fmt(20) }, clip);
  const g = el('g', { 'clip-path': `url(#${id})` }, svg);
  label(g, PLOT.x, 154, text, { className: 'fig-caption', role: 'caption', size: 13 });
}

function fmtKm(km) {
  const v = finite(km, 0);
  if (Math.abs(v) >= 100) return `${Math.round(v)} km`;
  return `${fmt(v)} km`;
}

function fmtDeg(d) {
  const v = finite(d, 0);
  if (Math.abs(v) >= 10) return `${fmt(v)} deg`;
  return `${fmt(v)} deg`;
}

function drawSpectrum(svg, spec, day, clipId) {
  const { x, y } = spectrumSamples(spec, day);
  const span = Math.max(1e-9, spec.x1_nm - spec.x0_nm);
  const mapX = (lam) => xOf((lam - spec.x0_nm) / span);
  const mapY = (v) => yOf(v / 1.05);
  const g = el('g', { 'clip-path': `url(#${clipId})` }, svg);
  el('path', hair(polylineD(x, y, mapX, mapY), { stroke: BONE, className: 'fig-trace' }), g);

  ticksX(svg, [
    { u: 0, label: `${Math.round(spec.x0_nm)}` },
    { u: 1, label: `${Math.round(spec.x1_nm)} nm` },
  ]);
  ticksY(svg, [
    { u: 0, label: '0' },
    { u: 1 / 1.05, label: '1' },
  ]);

  for (const f of spec.features) {
    const px = mapX(f.centre_nm);
    const stroke = f.mark ? SUN : MID;
    el('path', hair(
      `M ${fmt(px)} ${fmt(PLOT.y)} V ${fmt(PLOT.y + PLOT.h)}`,
      { stroke, mark: f.mark ? 'sunlight' : null, role: f.mark ? 'sunlight' : 'drop' },
    ), svg);
    if (f.label) {
      label(svg, px + 3, PLOT.y + 12, f.label, {
        transform: `rotate(-90 ${fmt(px + 3)} ${fmt(PLOT.y + 12)})`,
        anchor: 'end',
        size: 13,
      });
    }
  }
}

function drawThermal(svg, spec, _day, clipId) {
  const { cols, rows } = spec.grid;
  const cw = PLOT.w / cols;
  const ch = PLOT.h / rows;
  let vmin = spec.values[0];
  let vmax = spec.values[0];
  let hi = 0;
  for (let i = 1; i < spec.values.length; i++) {
    const v = spec.values[i];
    if (v < vmin) vmin = v;
    if (v > vmax) {
      vmax = v;
      hi = i;
    }
  }
  let scaleLo = vmin;
  let scaleHi = vmax;
  if (scaleHi - scaleLo < 1) {
    const mid = (scaleLo + scaleHi) / 2;
    scaleLo = mid - 5;
    scaleHi = mid + 5;
  }
  const g = el('g', { 'clip-path': `url(#${clipId})` }, svg);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const u = (spec.values[i] - scaleLo) / (scaleHi - scaleLo);
      el('rect', {
        x: fmt(PLOT.x + c * cw),
        y: fmt(PLOT.y + r * ch),
        width: fmt(cw + 0.02),
        height: fmt(ch + 0.02),
        fill: thermalColor(u),
        'shape-rendering': 'crispEdges',
      }, g);
    }
  }
  const hr = Math.floor(hi / cols);
  const hc = hi % cols;
  el('rect', {
    x: fmt(PLOT.x + hc * cw + 0.4),
    y: fmt(PLOT.y + hr * ch + 0.4),
    width: fmt(Math.max(1, cw - 0.8)),
    height: fmt(Math.max(1, ch - 0.8)),
    fill: 'none',
    stroke: SUN,
    'stroke-width': fmt(1),
    'vector-effect': 'non-scaling-stroke',
    'data-mark': 'sunlight',
    'shape-rendering': 'crispEdges',
  }, g);
  if (spec.terrain.length >= 2) {
    let d = '';
    for (let i = 0; i < spec.terrain.length; i++) {
      const p = spec.terrain[i];
      const x = PLOT.x + p.x * PLOT.w;
      const y = PLOT.y + p.y * PLOT.h;
      d += `${i === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)} `;
    }
    el('path', hair(d.trim(), { stroke: BONE, role: 'terrain' }), g);
  }
  const barW = (spec.scale_km / spec.w_km) * PLOT.w;
  const barX = PLOT.x;
  const barY = PLOT.y + PLOT.h + 8;
  el('path', hair(`M ${fmt(barX)} ${fmt(barY)} H ${fmt(barX + barW)}`), svg);
  el('path', hair(`M ${fmt(barX)} ${fmt(barY - 2)} V ${fmt(barY + 2)}`), svg);
  el('path', hair(`M ${fmt(barX + barW)} ${fmt(barY - 2)} V ${fmt(barY + 2)}`), svg);
  label(svg, barX + barW + 6, barY + 3, fmtKm(spec.scale_km), { size: 13 });
  label(svg, PLOT.x + 4, PLOT.y + PLOT.h - 6, `${Math.round(vmin)} K`, { size: 13, fill: MID });
  label(svg, PLOT.x + PLOT.w - 4, PLOT.y + 12, `${Math.round(vmax)} K`, { anchor: 'end', size: 13, fill: MID });
}

function drawStars(svg, spec, _day, clipId) {
  el('rect', {
    x: fmt(PLOT.x),
    y: fmt(PLOT.y),
    width: fmt(PLOT.w),
    height: fmt(PLOT.h),
    fill: VOID,
  }, svg);
  const g = el('g', { 'clip-path': `url(#${clipId})` }, svg);
  spec.stars.forEach((s, i) => {
    const cx = PLOT.x + s.x * PLOT.w;
    const cy = PLOT.y + s.y * PLOT.h;
    const r = pointSourceRadius(s.mag);
    el('circle', {
      cx: fmt(cx),
      cy: fmt(cy),
      r: fmt(r),
      fill: s.mag > 8 ? STAR_DIM : STAR,
    }, g);
    if (i === spec.circled) {
      el('circle', {
        cx: fmt(cx),
        cy: fmt(cy),
        r: fmt(Math.max(r + 3, 4.5)),
        fill: 'none',
        stroke: SUN,
        'stroke-width': fmt(1),
        'vector-effect': 'non-scaling-stroke',
        'data-mark': 'sunlight',
      }, svg);
      const onRight = s.x > 0.55;
      label(svg, cx + (onRight ? -(r + 5) : r + 5), cy - 3, `mag ${fmt(s.mag)}`, {
        anchor: onRight ? 'end' : 'start',
        size: 13,
      });
    }
  });
  const nx = PLOT.x + PLOT.w - 14;
  const ny = PLOT.y + 18;
  el('path', hair(`M ${fmt(nx)} ${fmt(ny)} V ${fmt(ny - 10)}`, { stroke: MID, cap: 'square' }), svg);
  el('path', hair(`M ${fmt(nx - 2.5)} ${fmt(ny - 7)} L ${fmt(nx)} ${fmt(ny - 10)} L ${fmt(nx + 2.5)} ${fmt(ny - 7)}`, { stroke: MID }), svg);
  label(svg, nx, ny + 12, 'N', { anchor: 'middle', size: 13 });
  label(svg, PLOT.x + PLOT.w - 4, PLOT.y + PLOT.h - 6, fmtDeg(spec.fov_deg), { anchor: 'end', size: 13 });
  if (spec.epoch) label(svg, PLOT.x + 4, PLOT.y + 12, spec.epoch, { size: 13 });
}

function drawRanging(svg, spec, day, clipId) {
  const { t, amp } = rangingSamples(spec, day);
  const span = Math.max(1e-9, spec.t1_us - spec.t0_us);
  const mapX = (tu) => xOf((tu - spec.t0_us) / span);
  const mapY = (v) => yOf(v / 1.12);
  const g = el('g', { 'clip-path': `url(#${clipId})` }, svg);
  el('path', hair(polylineD(t, amp, mapX, mapY), { stroke: BONE, className: 'fig-trace' }), g);

  let markT = (spec.t0_us + spec.t1_us) / 2;
  const marked = spec.returns.find((r) => r.mark);
  if (marked) markT = marked.t_us;
  else if (spec.returns.length) {
    let best = spec.returns[0];
    for (const r of spec.returns) if (r.amplitude > best.amplitude) best = r;
    markT = best.t_us;
  }
  el('path', hair(
    `M ${fmt(mapX(markT))} ${fmt(PLOT.y)} V ${fmt(PLOT.y + PLOT.h)}`,
    { stroke: SUN, mark: 'sunlight', role: 'sunlight' },
  ), svg);

  const km = rangingDistanceKm(markT);
  label(svg, PLOT.x + PLOT.w - 4, PLOT.y + 12, fmtKm(km), { anchor: 'end', size: 13 });

  ticksX(svg, [
    { u: 0, label: `${fmt(spec.t0_us)}` },
    { u: 1, label: `${fmt(spec.t1_us)} us` },
  ]);
  ticksY(svg, [
    { u: 0, label: '0' },
    { u: spec.noise_floor / 1.12, label: 'nf' },
    { u: 1 / 1.12, label: '1' },
  ]);
}

function seriesRange(s) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of s.values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (s.band) {
    if (s.band.lo < lo) lo = s.band.lo;
    if (s.band.hi > hi) hi = s.band.hi;
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = 0.08 * (hi - lo);
  return { lo: lo - pad, hi: hi + pad };
}

function drawStrip(svg, spec, _day, clipId) {
  const n = Math.max(1, spec.series.length);
  const gap = 4;
  const panelH = (PLOT.h - gap * (n - 1)) / n;
  const g = el('g', { 'clip-path': `url(#${clipId})` }, svg);

  spec.series.forEach((s, i) => {
    const top = PLOT.y + i * (panelH + gap);
    const { lo, hi } = seriesRange(s);
    const span = hi - lo;
    const mapY = (v) => top + (1 - (v - lo) / span) * panelH;
    if (s.band) {
      const y1 = mapY(s.band.hi);
      const y2 = mapY(s.band.lo);
      el('rect', {
        x: fmt(PLOT.x),
        y: fmt(Math.min(y1, y2)),
        width: fmt(PLOT.w),
        height: fmt(Math.abs(y2 - y1)),
        fill: FAINT,
        'data-role': 'band',
      }, g);
    }
    const vals = s.values.length ? s.values : [0];
    const xs = vals.map((_, k) => (vals.length === 1 ? PLOT.x : PLOT.x + k / (vals.length - 1) * PLOT.w));
    const ys = vals.map((v) => mapY(v));
    el('path', hair(stripStepPath(xs, ys), { stroke: SERIES_STROKE[i] || BONE, className: 'fig-trace' }), g);
    const tag = s.unit ? `${s.name} ${s.unit}` : s.name;
    label(svg, PLOT.x + 4, top + 11, tag, { size: 13 });
  });

  spec.events.forEach((e, i) => {
    const x = xOf(e.t / spec.t_hours);
    const sun = i === 0;
    el('path', hair(
      `M ${fmt(x)} ${fmt(PLOT.y)} V ${fmt(PLOT.y + PLOT.h)}`,
      { stroke: sun ? SUN : MID, mark: sun ? 'sunlight' : null, role: sun ? 'sunlight' : 'event' },
    ), svg);
    if (e.label) {
      const ly = PLOT.y + 11 + (i % 2) * 13;
      label(svg, x + 3, ly, e.label, { size: 13 });
    }
  });

  if (!spec.events.length && spec.series[0] && spec.series[0].values.length) {
    const s = spec.series[0];
    const { lo, hi } = seriesRange(s);
    const last = s.values[s.values.length - 1];
    const x = PLOT.x + PLOT.w;
    const y = PLOT.y + (1 - (last - lo) / (hi - lo)) * panelH;
    el('circle', {
      cx: fmt(x),
      cy: fmt(y),
      r: fmt(2.2),
      fill: SUN,
      'data-mark': 'sunlight',
    }, svg);
  }

  ticksX(svg, [
    { u: 0, label: '0' },
    { u: 1, label: `${fmt(spec.t_hours)} h` },
  ]);
}

function mapGnomonic(g, scale, cx, cy) {
  return { x: cx + g.x * scale, y: cy - g.y * scale };
}

function drawPointing(svg, spec, _day, clipId) {
  const az = spec.boresight.az;
  const elev = spec.boresight.el;
  const half = Math.tan((spec.fov_deg / 2) * RAD) || 1e-6;
  const scale = Math.min(PLOT.w, PLOT.h) * 0.38 / half;
  const cx = PLOT.x + PLOT.w / 2;
  const cy = PLOT.y + PLOT.h / 2;
  const g = el('g', { 'clip-path': `url(#${clipId})` }, svg);

  const span = Math.max(spec.fov_deg * 1.6, 4);
  const step = niceStep(span / 4);
  let azD = '';
  let elD = '';
  const az0 = Math.ceil((az - span) / step) * step;
  for (let a = az0; a <= az + span + 1e-9; a += step) {
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const e = elev - span + 2 * span * k / 16;
      const p = gnomonic(a, e, az, elev);
      if (p) pts.push(mapGnomonic(p, scale, cx, cy));
    }
    azD += polyChunks(pts);
  }
  const el0 = Math.ceil((elev - span) / step) * step;
  for (let e = el0; e <= elev + span + 1e-9; e += step) {
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const a = az - span + 2 * span * k / 16;
      const p = gnomonic(a, e, az, elev);
      if (p) pts.push(mapGnomonic(p, scale, cx, cy));
    }
    elD += polyChunks(pts);
  }
  if (azD) el('path', hair(azD, { stroke: FAINT, role: 'graticule' }), g);
  if (elD) el('path', hair(elD, { stroke: FAINT, role: 'graticule' }), g);

  const h = half * scale;
  el('rect', {
    x: fmt(cx - h),
    y: fmt(cy - h),
    width: fmt(2 * h),
    height: fmt(2 * h),
    fill: 'none',
    stroke: SUN,
    'stroke-width': fmt(1),
    'vector-effect': 'non-scaling-stroke',
    'data-mark': 'sunlight',
  }, svg);

  el('path', hair(`M ${fmt(cx - 3)} ${fmt(cy)} H ${fmt(cx + 3)} M ${fmt(cx)} ${fmt(cy - 3)} V ${fmt(cy + 3)}`, { stroke: MID }), svg);

  if (spec.slew_from) {
    const a0 = azElDir(spec.slew_from.az, spec.slew_from.el);
    const a1 = azElDir(az, elev);
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const d = slerpDir(a0, a1, k / 20);
      const e = Math.asin(clamp(d.z, -1, 1)) / RAD;
      const azk = Math.atan2(d.x, d.y) / RAD;
      const p = gnomonic(azk, e, az, elev);
      if (p) pts.push(mapGnomonic(p, scale, cx, cy));
    }
    const d = polyChunks(pts);
    if (d) el('path', hair(d, { stroke: MID, dash: '3 2', role: 'slew' }), svg);
  }

  for (const t of spec.targets) {
    const p = gnomonic(t.az, t.el, az, elev);
    if (!p) continue;
    const q = mapGnomonic(p, scale, cx, cy);
    el('circle', { cx: fmt(q.x), cy: fmt(q.y), r: fmt(2), fill: BONE }, svg);
    if (t.label) label(svg, q.x + 5, q.y - 3, t.label, { size: 13 });
  }

  label(svg, PLOT.x + 4, PLOT.y + PLOT.h - 6, spec.body, { size: 13 });
}

function polyChunks(pts) {
  if (pts.length < 2) return '';
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${fmt(pts[i].x)} ${fmt(pts[i].y)}`;
  return d + ' ';
}

function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  const n = raw / mag;
  if (n < 1.5) return mag;
  if (n < 3.5) return 2 * mag;
  if (n < 7.5) return 5 * mag;
  return 10 * mag;
}

const DRAW = {
  SpectrumTrace: drawSpectrum,
  ThermalMap: drawThermal,
  StarFieldCrop: drawStars,
  RangingReturn: drawRanging,
  StripChart: drawStrip,
  PointingDiagram: drawPointing,
};

export function renderFigure(spec, widthPx, opts = {}) {
  const clean = sanitizeFigure(spec);
  if (!clean) return null;
  const width = clamp(finite(widthPx, VW), 80, 2400);
  const height = width * VH / VW;
  const day = Math.floor(finite(opts && opts.day, 0));
  figSeq += 1;
  const clipId = `fig-clip-${figSeq}`;
  const svg = el('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `0 0 ${VW} ${VH}`,
    width: fmt(width),
    height: fmt(height),
    role: 'img',
    'data-op': clean.op,
    'aria-label': clean.caption || clean.op,
  });
  el('rect', {
    x: '0',
    y: '0',
    width: fmt(VW),
    height: fmt(VH),
    fill: VOID,
    'data-role': 'ground',
  }, svg);
  drawAxes(svg, clipId);
  DRAW[clean.op](svg, clean, day, clipId);
  captionOf(svg, clean.caption, clipId);
  return svg;
}
