// Closed rendering vocabulary of system spec §6.8: content may name these elements and
// nothing else. sanitizeVisuals is the jail — unknown ops, extra keys, bad colours and
// out-of-range numbers cannot reach drawing. createAnomalyLayer paints scene elements 1–15
// into g#anomaly. Vehicle-event elements 16–19 are kept in the sanitised list for the
// vehicle module; figures 20–25 are ignored here.

import { PALETTE } from './palette.js';
import { clamp, lerp, lerpHex, fmt, seeded, el, setAttrs, RAD } from './util.js';
import { projectEarth, projectMoon, onDisc } from './project.js';
import { VIEW } from './scale.js';
import { litPath, litFraction } from './lighting.js';
import { VEHICLE_EVENT_OPS } from './setpieces.js';
import { R_EARTH, R_MOON } from '../physics.js';

export const SCENE_OPS = Object.freeze([
  'PointSource', 'ExtendedGlow', 'Occulter', 'LimbArc', 'TerminatorNotch',
  'SurfacePatch', 'TransitMark', 'FlashSequence', 'PulseRing', 'ResidualGhost',
  'SkyBand', 'ShadowCast', 'MeasureGrid', 'DistortionRings', 'UmbraCoin',
]);

const SCENE_SET = new Set(SCENE_OPS);
const VEHICLE_SET = new Set(VEHICLE_EVENT_OPS);
const ADDITIVE = new Set(['PointSource', 'FlashSequence']);
const FRAMES = new Set(['scene', 'earth', 'moon', 'sky', 'limb-earth', 'limb-moon', 'ship']);
const BODY = ['earth', 'moon'];
const ANNULUS_DEFAULT = '#E8A070';
const THERMAL = [
  [-40, '#2A3A88'],
  [-20, '#4A6888'],
  [0, null],
  [20, '#C07848'],
  [40, '#C05030'],
];

export function pointSourceRadius(mag) {
  return clamp(1.6 * 10 ** (-0.15 * (mag - 1)), 0.6, 7);
}

function num(v, lo, hi, def) {
  if (typeof v !== 'number' || Number.isNaN(v)) return def;
  if (v === Infinity) return hi;
  if (v === -Infinity) return lo;
  if (!Number.isFinite(v)) return def;
  return clamp(v, lo, hi);
}

function enu(v, allowed, def) {
  return allowed.includes(v) ? v : def;
}

function flag(v, def) {
  return v === true || v === false ? v : def;
}

function color(v, def) {
  if (typeof v !== 'string') return def;
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v.toUpperCase();
  const name = v.startsWith('--') ? v.slice(2) : v;
  return Object.prototype.hasOwnProperty.call(PALETTE, name) ? name : def;
}

function labelOf(v) {
  if (typeof v !== 'string') return '';
  return v.length <= 24 ? v : v.slice(0, 24);
}

function paintColor(c) {
  if (typeof c !== 'string') return PALETTE.bone;
  if (c.charCodeAt(0) === 35) return c;
  return PALETTE[c] || PALETTE.bone;
}

function sanitizeAt(at) {
  if (!at || typeof at !== 'object') return { frame: 'scene', x: 0.5, y: 0.5 };
  const frame = FRAMES.has(at.frame) ? at.frame : 'scene';
  if (frame === 'earth' || frame === 'moon') {
    return { frame, lon: num(at.lon, -180, 180, 0), lat: num(at.lat, -90, 90, 0) };
  }
  if (frame === 'sky') {
    return { frame, az: num(at.az, 0, 360, 0), el: num(at.el, -90, 90, 0) };
  }
  if (frame === 'limb-earth' || frame === 'limb-moon') {
    return { frame, angle: num(at.angle, 0, 360, 0) };
  }
  if (frame === 'ship') {
    return { frame, x: num(at.x, -400, 400, 0), y: num(at.y, -400, 400, 0) };
  }
  return { frame: 'scene', x: num(at.x, 0, 1, 0.5), y: num(at.y, 0, 1, 0.5) };
}

function sanitizePoints(raw, fallbackAt) {
  if (!Array.isArray(raw)) return [fallbackAt || { frame: 'scene', x: 0.5, y: 0.5 }];
  const pts = [];
  for (let i = 0; i < raw.length && pts.length < 12; i++) {
    const p = raw[i];
    if (!p || typeof p !== 'object') continue;
    pts.push(sanitizeAt(p));
  }
  return pts.length ? pts : [fallbackAt || { frame: 'scene', x: 0.5, y: 0.5 }];
}

function sanitizePoly(raw) {
  if (!Array.isArray(raw)) return null;
  const pts = [];
  for (let i = 0; i < raw.length && pts.length < 4; i++) {
    const p = raw[i];
    if (!p || typeof p !== 'object') continue;
    pts.push({ x: num(p.x, 0, 1, 0.5), y: num(p.y, 0, 1, 0.5) });
  }
  return pts.length >= 3 ? pts : null;
}

function sanitizePath(raw) {
  const pt = (p, dx) => {
    if (!p || typeof p !== 'object') return { x: dx, y: 0 };
    return { x: num(p.x, -1, 1, dx), y: num(p.y, -1, 1, 0) };
  };
  if (!Array.isArray(raw) || raw.length < 2) return [pt(null, -0.4), pt(null, 0.4)];
  return [pt(raw[0], -0.4), pt(raw[1], 0.4)];
}

function hours(v, def) {
  return num(v, 0, 24, def);
}

function sanitizeOne(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const op = raw.op;
  if (typeof op !== 'string' || !(SCENE_SET.has(op) || VEHICLE_SET.has(op))) return null;

  if (op === 'PointSource') {
    const out = {
      op, at: sanitizeAt(raw.at), mag: num(raw.mag, -1, 18, 6),
      color: color(raw.color, 'star-k5800'), label: labelOf(raw.label),
      kind: enu(raw.kind, ['star', 'glint'], 'star'),
      hold_s: num(raw.hold_s, 0.05, 120, 1.2), period_s: num(raw.period_s, 0.5, 400, 60),
    };
    if (raw.occult && typeof raw.occult === 'object') {
      out.occult = {
        body: enu(raw.occult.body, BODY, 'earth'),
        t_in_s: num(raw.occult.t_in_s, 0, 86400, 0),
        t_out_s: num(raw.occult.t_out_s, 0, 86400, 0),
      };
    }
    return out;
  }
  if (op === 'ExtendedGlow') {
    let shape = enu(raw.shape, ['ellipse', 'polygon'], 'ellipse');
    const points = shape === 'polygon'
      ? (sanitizePoly(raw.points) || [{ x: 0.45, y: 0.45 }, { x: 0.55, y: 0.45 }, { x: 0.5, y: 0.55 }])
      : undefined;
    const out = {
      op, at: sanitizeAt(raw.at), shape,
      rx_deg: num(raw.rx_deg, 0.1, 25, 2), ry_deg: num(raw.ry_deg, 0.1, 25, 1),
      rot_deg: num(raw.rot_deg, -180, 180, 0), color: color(raw.color, 'star-k5800'),
      opacity: num(raw.opacity, 0.02, 0.35, 0.12), blur: true,
    };
    if (points) out.points = points;
    return out;
  }
  if (op === 'Occulter') {
    return {
      op, at: sanitizeAt(raw.at), r_deg: num(raw.r_deg, 0.02, 8, 0.2),
      shape: enu(raw.shape, ['disc', 'notch'], 'disc'), opacity: num(raw.opacity, 0.4, 1, 0.92),
    };
  }
  if (op === 'LimbArc') {
    return {
      op, body: enu(raw.body, BODY, 'earth'),
      angle0: num(raw.angle0, 0, 360, 0), angle1: num(raw.angle1, 0, 360, 40),
      width_px: num(raw.width_px, 1, 8, 2), color: color(raw.color, 'earth-limb'),
      opacity: num(raw.opacity, 0, 1, 0.6),
    };
  }
  if (op === 'TerminatorNotch') {
    return {
      op, body: enu(raw.body, BODY, 'earth'), along: num(raw.along, 0, 1, 0.5),
      depth_px: num(raw.depth_px, 4, 24, 8), width_px: num(raw.width_px, 8, 48, 16),
    };
  }
  if (op === 'SurfacePatch') {
    return {
      op, body: enu(raw.body, BODY, 'moon'),
      lon: num(raw.lon, -180, 180, 0), lat: num(raw.lat, -90, 90, 0),
      r_km: num(raw.r_km, 5, 800, 40), mode: enu(raw.mode, ['thermal', 'albedo'], 'thermal'),
      dT: num(raw.dT, -40, 40, 0), dA: num(raw.dA, -0.4, 0.4, 0),
      shape: enu(raw.shape, ['ellipse', 'hex'], 'ellipse'),
      side: enu(raw.side, ['lit', 'night', 'any'], 'any'),
    };
  }
  if (op === 'TransitMark') {
    return {
      op, body: enu(raw.body, BODY, 'earth'), path: sanitizePath(raw.path),
      r_px: num(raw.r_px, 2, 8, 4), duration_s: num(raw.duration_s, 8, 120, 30),
    };
  }
  if (op === 'FlashSequence') {
    return {
      op, points: sanitizePoints(raw.points).slice(0, 12),
      period_s: num(raw.period_s, 0.5, 400, 74), on_s: num(raw.on_s, 0.2, 8, 1.2),
      color: color(raw.color, 'star-k5800'), mag: num(raw.mag, -1, 18, 6),
      order: enu(raw.order, ['sequence', 'simultaneous', 'random-seeded'], 'sequence'),
    };
  }
  if (op === 'PulseRing') {
    return {
      op, at: sanitizeAt(raw.at), r0_px: num(raw.r0_px, 1, 400, 8),
      r1_px: num(raw.r1_px, 1, 400, 120), period_s: num(raw.period_s, 0.8, 30, 2.6),
      color: color(raw.color, 'star-k5800'), static: flag(raw.static, false),
    };
  }
  if (op === 'ResidualGhost') {
    return {
      op, of: enu(raw.of, ['earth', 'moon', 'ribbon'], 'earth'),
      dx_deg: num(raw.dx_deg, 0, 2, 0), dy_deg: num(raw.dy_deg, 0, 2, 0),
      dr_km: num(raw.dr_km, 0, 20000, 4000), opacity: num(raw.opacity, 0, 1, 0.25),
      color: color(raw.color, 'alert'),
    };
  }
  if (op === 'SkyBand') {
    return {
      op, angle: num(raw.angle, 0, 180, 90), thickness_px: num(raw.thickness_px, 4, 80, 18),
      color: color(raw.color, 'star-k8000'), opacity: num(raw.opacity, 0.03, 0.16, 0.07),
    };
  }
  if (op === 'ShadowCast') {
    let from = 'ship';
    if (raw.from && typeof raw.from === 'object') from = sanitizeAt(raw.from);
    else if (raw.from === 'ship') from = 'ship';
    else if (raw.from != null && raw.from !== 'ship') from = 'ship';
    return {
      op, body: enu(raw.body, BODY, 'moon'), from,
      length_px: num(raw.length_px, 4, 400, 40), opacity: num(raw.opacity, 0, 1, 0.5),
      softness_px: num(raw.softness_px, 0, 6, 0),
    };
  }
  if (op === 'MeasureGrid') {
    return {
      op, body: enu(raw.body, BODY, 'earth'),
      spacing_deg: num(raw.spacing_deg, 0.5, 30, 2), opacity: num(raw.opacity, 0, 1, 0.18),
    };
  }
  if (op === 'DistortionRings') {
    return {
      op, at: sanitizeAt(raw.at), r_px: num(raw.r_px, 20, 220, 80),
      amount: num(raw.amount, 0.02, 0.22, 0.12),
    };
  }
  if (op === 'UmbraCoin') {
    const out = {
      op, at: sanitizeAt(raw.at), annulus: flag(raw.annulus, false),
      annulus_color: color(raw.annulus_color, ANNULUS_DEFAULT),
      path: sanitizePath(raw.path), duration_s: num(raw.duration_s, 8, 120, 30),
    };
    const rDeg = num(raw.r_deg, 0.02, 8, null);
    if (rDeg != null) out.r_deg = rDeg;
    return out;
  }
  if (op === 'AppendageDeploy') {
    return {
      op, what: enu(raw.what, ['arrays', 'legs', 'boom', 'dish'], 'arrays'),
      t0: hours(raw.t0, 0), t1: hours(raw.t1, 24),
      from: num(raw.from, 0, 1, 0), to: num(raw.to, 0, 1, 1), hold: flag(raw.hold, true),
    };
  }
  if (op === 'StageSeparation') {
    return {
      op, what: enu(raw.what, ['fairing', 'upper-stage', 'cruise-module'], 'fairing'),
      t0: hours(raw.t0, 0), t1: hours(raw.t1, 24),
      drift_px_s: num(raw.drift_px_s, 0, 40, 6), spin_deg_s: num(raw.spin_deg_s, 0, 20, 2),
      fade_after_s: num(raw.fade_after_s, 0, 600, 90),
    };
  }
  if (op === 'EngineBurn') {
    return {
      op, engine: enu(raw.engine, ['ion', 'descent', 'attitude', 'kick'], 'ion'),
      t0: hours(raw.t0, 0), t1: hours(raw.t1, 24),
      throttle: num(raw.throttle, 0, 1, 1), flicker_hz: num(raw.flicker_hz, 0, 12, 0),
    };
  }
  if (op === 'ExhaustTrail') {
    const out = {
      op, kind: enu(raw.kind, ['ascent', 'separation', 'surface-dust'], 'ascent'),
      t0: hours(raw.t0, 0), t1: hours(raw.t1, 24),
      density: num(raw.density, 0, 1, 0.5), color: color(raw.color, 'earth-cloud'),
    };
    if (raw.at != null) out.at = sanitizeAt(raw.at);
    return out;
  }
  return null;
}

export function sanitizeVisuals(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  let additive = 0;
  let rings = 0;
  let blur = 0;
  const n = Math.min(list.length, 4096);
  for (let i = 0; i < n && out.length < 10; i++) {
    const el0 = sanitizeOne(list[i]);
    if (!el0) continue;
    if (el0.op === 'DistortionRings') {
      if (rings >= 1) continue;
      rings += 1;
    }
    if (ADDITIVE.has(el0.op)) {
      if (additive >= 4) continue;
      additive += 1;
    }
    if (el0.op === 'ExtendedGlow') {
      if (blur >= 1) el0.blur = false;
      else if (el0.blur) blur += 1;
    } else if (el0.op === 'ShadowCast' && el0.softness_px > 0) {
      if (blur >= 1) el0.softness_px = 0;
      else blur += 1;
    }
    out.push(el0);
  }
  return out;
}

function discOf(frame, body) {
  return body === 'moon' ? frame.moon : frame.earth;
}

function pxPerDeg(frame, body) {
  const disc = discOf(frame, body);
  const theta = body === 'moon' ? frame.state.heroMoonAngularDia : frame.state.heroEarthAngularDia;
  if (!(theta > 0) || !(disc.r > 0)) return 10;
  return (2 * disc.r) / theta;
}

function pxPerDegAt(frame, at) {
  if (!at) return 10;
  if (at.frame === 'moon' || at.frame === 'limb-moon') return pxPerDeg(frame, 'moon');
  if (at.frame === 'earth' || at.frame === 'limb-earth') return pxPerDeg(frame, 'earth');
  return 10;
}

export function resolveAt(at, frame) {
  if (!at) return null;
  switch (at.frame) {
    case 'scene':
      return { x: at.x * VIEW.w, y: at.y * VIEW.h, body: null, cosc: 1 };
    case 'earth': {
      if (!frame.earth.visible) return null;
      const p = projectEarth(at.lat, at.lon, frame.earthSpinDeg);
      if (p.cosc <= 0) return null;
      return { ...onDisc(p, frame.earth), body: 'earth', cosc: p.cosc };
    }
    case 'moon': {
      if (!frame.moon.visible) return null;
      const p = projectMoon(at.lat, at.lon, frame.moonCamera);
      if (p.cosc <= 0) return null;
      return { ...onDisc(p, frame.moon), body: 'moon', cosc: p.cosc };
    }
    case 'sky': {
      const az = at.az * RAD;
      const elv = at.el * RAD;
      return {
        x: VIEW.w / 2 + VIEW.h * 0.42 * Math.cos(elv) * Math.sin(az),
        y: VIEW.h / 2 - VIEW.h * 0.42 * Math.sin(elv),
        body: null, cosc: 1,
      };
    }
    case 'limb-earth': {
      const a = at.angle * RAD;
      return {
        x: frame.earth.cx + frame.earth.r * Math.cos(a),
        y: frame.earth.cy + frame.earth.r * Math.sin(a),
        body: 'earth', cosc: 1,
      };
    }
    case 'limb-moon': {
      if (!frame.moon.visible) return null;
      const a = at.angle * RAD;
      return {
        x: frame.moon.cx + frame.moon.r * Math.cos(a),
        y: frame.moon.cy + frame.moon.r * Math.sin(a),
        body: 'moon', cosc: 1,
      };
    }
    case 'ship':
      return { x: frame.ship.x + at.x, y: frame.ship.y + at.y, body: null, cosc: 1 };
    default:
      return null;
  }
}

function hide(g, hidden) {
  setAttrs(g, { visibility: hidden ? 'hidden' : 'visible' });
}

function setBlend(node, mode) {
  setAttrs(node, { 'mix-blend-mode': mode });
  if (node.style && typeof node.style.setProperty === 'function') {
    node.style.setProperty('mix-blend-mode', mode);
  }
}

function pacificSeconds(frame) {
  return frame.hour * 3600;
}

function occultOpacity(t, occult) {
  if (!occult) return 1;
  const fade = 0.4;
  const a = Math.min(occult.t_in_s, occult.t_out_s);
  const b = Math.max(occult.t_in_s, occult.t_out_s);
  if (t < a - fade || t > b + fade) return 1;
  if (t >= a && t <= b) return 0;
  if (t < a) return (a - t) / fade;
  return (t - b) / fade;
}

function pathU(frame, duration) {
  if (!frame.live) return 0.5;
  return clamp(pacificSeconds(frame) / duration, 0, 1);
}

function circlePath(cx, cy, r) {
  return `M ${fmt(cx - r)} ${fmt(cy)} a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0 a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0 Z`;
}

function clipUrl(id) {
  return `url(#${id})`;
}

function thermalFill(dT) {
  if (dT === 0) return null;
  for (let i = 1; i < THERMAL.length; i++) {
    if (dT <= THERMAL[i][0]) {
      const [t0, c0] = THERMAL[i - 1];
      const [t1, c1] = THERMAL[i];
      const u = (dT - t0) / (t1 - t0 || 1);
      if (!c0) return c1;
      if (!c1) return c0;
      return lerpHex(c0, c1, u);
    }
  }
  return THERMAL[THERMAL.length - 1][1];
}

function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * (Math.PI / 3);
    pts.push(`${fmt(cx + r * Math.cos(a))},${fmt(cy + r * Math.sin(a))}`);
  }
  return pts.join(' ');
}

function flashLit(i, n, visual, t) {
  const { period_s: P, on_s: on, order } = visual;
  const phase = ((t % P) + P) % P;
  if (order === 'simultaneous') return phase < on;
  if (order === 'random-seeded') {
    const rng = seeded((i + 1) * 104729);
    const off = rng() * P;
    return (((t + off) % P) + P) % P < on;
  }
  const slot = P / Math.max(n, 1);
  const local = (((phase - i * slot) % P) + P) % P;
  return local < on;
}

function surfacePos(visual, frame) {
  const disc = discOf(frame, visual.body);
  if (!disc.visible) return null;
  const p = visual.body === 'moon'
    ? projectMoon(visual.lat, visual.lon, frame.moonCamera)
    : projectEarth(visual.lat, visual.lon, frame.earthSpinDeg);
  if (p.cosc <= 0) return null;
  return { ...onDisc(p, disc), cosc: p.cosc, disc };
}

function umbraRadius(frame, visual) {
  if (visual.r_deg != null) return visual.r_deg * pxPerDeg(frame, 'earth');
  return (200 / R_EARTH) * frame.earth.r;
}

function ensureClips(defs) {
  const mkClip = (id) => el('clipPath', { id, clipPathUnits: 'userSpaceOnUse' }, defs);
  const earthClip = mkClip('vocab-clip-earth');
  const moonClip = mkClip('vocab-clip-moon');
  const earthLit = mkClip('vocab-clip-earth-lit');
  const moonLit = mkClip('vocab-clip-moon-lit');
  const earthNight = mkClip('vocab-clip-earth-night');
  const moonNight = mkClip('vocab-clip-moon-night');
  const nodes = {
    earthCirc: el('circle', {}, earthClip),
    moonCirc: el('circle', {}, moonClip),
    earthLitPath: el('path', {}, earthLit),
    moonLitPath: el('path', {}, moonLit),
    earthNightPath: el('path', {}, earthNight),
    moonNightPath: el('path', {}, moonNight),
  };
  setAttrs(nodes.earthNightPath, { 'clip-rule': 'evenodd' });
  setAttrs(nodes.moonNightPath, { 'clip-rule': 'evenodd' });
  const blur = el('filter', {
    id: 'vocab-blur', x: '-50%', y: '-50%', width: '200%', height: '200%',
  }, defs);
  nodes.fe = el('feGaussianBlur', { stdDeviation: '2' }, blur);
  nodes.owned = [earthClip, moonClip, earthLit, moonLit, earthNight, moonNight, blur];
  return nodes;
}

function updateClips(clips, frame) {
  const e = frame.earth;
  const m = frame.moon;
  setAttrs(clips.earthCirc, { cx: fmt(e.cx), cy: fmt(e.cy), r: fmt(e.r) });
  setAttrs(clips.moonCirc, { cx: fmt(m.cx), cy: fmt(m.cy), r: fmt(m.r) });
  const eLit = litPath(e.cx, e.cy, e.r, frame.sun);
  const mLit = litPath(m.cx, m.cy, m.r, frame.sun);
  setAttrs(clips.earthLitPath, { d: eLit });
  setAttrs(clips.moonLitPath, { d: mLit });
  setAttrs(clips.earthNightPath, { d: `${circlePath(e.cx, e.cy, e.r)} ${eLit}` });
  setAttrs(clips.moonNightPath, { d: `${circlePath(m.cx, m.cy, m.r)} ${mLit}` });
}

function sideClip(body, side) {
  if (side === 'lit') return clipUrl(body === 'moon' ? 'vocab-clip-moon-lit' : 'vocab-clip-earth-lit');
  if (side === 'night') return clipUrl(body === 'moon' ? 'vocab-clip-moon-night' : 'vocab-clip-earth-night');
  return clipUrl(body === 'moon' ? 'vocab-clip-moon' : 'vocab-clip-earth');
}

function build(op, g) {
  const stroke = { fill: 'none', 'stroke-linecap': 'round' };
  if (op === 'PointSource') {
    const text = el('text', {
      'font-size': '13', fill: PALETTE['bone-mid'], 'text-anchor': 'start',
    }, g);
    text.textContent = '';
    return { text };
  }
  if (op === 'ExtendedGlow') {
    return {
      ellipse: el('ellipse', { stroke: 'none', 'mix-blend-mode': 'screen' }, g),
      polygon: el('polygon', { stroke: 'none', 'mix-blend-mode': 'screen' }, g),
    };
  }
  if (op === 'Occulter') return { circle: el('circle', { fill: PALETTE.void, stroke: 'none' }, g) };
  if (op === 'LimbArc') return { path: el('path', { ...stroke, 'stroke-linecap': 'round' }, g) };
  if (op === 'TerminatorNotch') return { path: el('path', { fill: PALETTE.void, stroke: 'none' }, g) };
  if (op === 'SurfacePatch') {
    return {
      ellipse: el('ellipse', { stroke: 'none' }, g),
      hex: el('polygon', {}, g),
    };
  }
  if (op === 'TransitMark') return { circle: el('circle', { stroke: 'none' }, g) };
  if (op === 'FlashSequence') return {};
  if (op === 'PulseRing') {
    return { circle: el('circle', { fill: 'none', 'stroke-width': '1' }, g) };
  }
  if (op === 'ResidualGhost') return { path: el('path', { stroke: 'none' }, g) };
  if (op === 'SkyBand') {
    return { circle: el('circle', { fill: 'none', 'mix-blend-mode': 'screen' }, g) };
  }
  if (op === 'ShadowCast') return { poly: el('polygon', { stroke: 'none' }, g) };
  if (op === 'MeasureGrid') {
    const ticks = [];
    for (let i = 0; i < 80; i++) {
      ticks.push(el('path', {
        fill: 'none', stroke: PALETTE['bone-dim'], 'stroke-width': '1',
      }, g));
    }
    return {
      ticks,
      bar: el('line', { stroke: PALETTE['bone-dim'], 'stroke-width': '1' }, g),
      caption: el('text', { fill: PALETTE['bone-mid'], 'font-size': '13' }, g),
    };
  }
  if (op === 'DistortionRings') {
    const rings = [];
    for (let i = 0; i < 8; i++) {
      rings.push(el('circle', {
        fill: 'none', stroke: PALETTE['bone-faint'], 'stroke-width': '1', opacity: '0.12',
      }, g));
    }
    const rays = [];
    for (let i = 0; i < 12; i++) {
      rays.push(el('line', {
        stroke: PALETTE['bone-faint'], 'stroke-width': '1', opacity: '0.12',
      }, g));
    }
    return { rings, rays };
  }
  if (op === 'UmbraCoin') {
    return {
      coin: el('circle', { fill: PALETTE.void, stroke: 'none', opacity: '0.75' }, g),
      ring: el('circle', { fill: 'none', 'stroke-width': '3' }, g),
    };
  }
  return {};
}

function paint(item, frame, nowMs, queue, clips) {
  const { visual: v, group: g, nodes } = item;
  const op = v.op;

  if (op === 'PointSource') {
    const pos = resolveAt(v.at, frame);
    if (!pos) { hide(g, true); return; }
    hide(g, false);
    const r = pointSourceRadius(v.mag);
    let alpha = occultOpacity(pacificSeconds(frame), v.occult);
    if (v.kind === 'glint') {
      if (!frame.live) alpha *= 0.6;
      else {
        const t = pacificSeconds(frame);
        const phase = ((t % v.period_s) + v.period_s) % v.period_s;
        alpha *= phase < v.hold_s ? 1 : 0;
      }
    }
    const col = paintColor(v.color);
    queue({ kind: 'point', x: pos.x, y: pos.y, r, color: col, alpha, additive: true });
    if (v.mag < 4) {
      queue({
        kind: 'point', x: pos.x, y: pos.y, r: 3 * r, color: col, alpha: 0.22 * alpha, additive: true,
      });
    }
    if (v.kind === 'glint' && frame.grade > 0.3 && alpha > 0) {
      queue({ kind: 'line', x0: pos.x - 6, y0: pos.y, x1: pos.x + 6, y1: pos.y, width: 1, color: col, alpha });
      queue({ kind: 'line', x0: pos.x, y0: pos.y - 6, x1: pos.x, y1: pos.y + 6, width: 1, color: col, alpha });
    }
    nodes.text.textContent = v.label;
    setAttrs(nodes.text, {
      x: fmt(pos.x + r + 4), y: fmt(pos.y + 4), opacity: v.label ? '1' : '0',
    });
    return;
  }

  if (op === 'ExtendedGlow') {
    const pos = resolveAt(v.at, frame);
    if (!pos) { hide(g, true); return; }
    hide(g, false);
    const ppd = pxPerDegAt(frame, v.at);
    let rx = v.rx_deg * ppd;
    let ry = v.ry_deg * ppd;
    // A glow pinned to a point on a body is drawn no larger than that body's disc, aspect kept.
    // Degrees convert at the body's true angular size, so a few degrees on a half-degree Moon
    // became an oval many times the disc, a grey smudge on the black sky (day 12, owner review).
    const disc = pos.body ? discOf(frame, pos.body) : null;
    const cap = disc && disc.r > 0 ? disc.r / Math.max(rx, ry, 1e-9) : 1;
    if (cap < 1) {
      rx *= cap;
      ry *= cap;
    }
    const wide = Math.max(2 * rx, 2 * ry);
    const useBlur = v.blur && wide < 40 && wide > 0;
    if (useBlur) setAttrs(clips.fe, { stdDeviation: '2' });
    const filter = useBlur ? 'url(#vocab-blur)' : null;
    const col = paintColor(v.color);
    if (v.shape === 'polygon' && v.points) {
      setAttrs(nodes.ellipse, { visibility: 'hidden' });
      setAttrs(nodes.polygon, {
        visibility: 'visible',
        points: v.points.map((p) => `${fmt(p.x * VIEW.w)},${fmt(p.y * VIEW.h)}`).join(' '),
        fill: col, opacity: fmt(v.opacity), filter,
      });
      setBlend(nodes.polygon, 'screen');
    } else {
      setAttrs(nodes.polygon, { visibility: 'hidden' });
      setAttrs(nodes.ellipse, {
        visibility: 'visible',
        cx: fmt(pos.x), cy: fmt(pos.y), rx: fmt(rx), ry: fmt(ry),
        fill: col, opacity: fmt(v.opacity),
        transform: `rotate(${fmt(v.rot_deg)} ${fmt(pos.x)} ${fmt(pos.y)})`,
        filter,
      });
      setBlend(nodes.ellipse, 'screen');
    }
    return;
  }

  if (op === 'Occulter') {
    const pos = resolveAt(v.at, frame);
    if (!pos) { hide(g, true); return; }
    hide(g, false);
    const r = v.r_deg * pxPerDegAt(frame, v.at);
    const clip = pos.body ? clipUrl(pos.body === 'moon' ? 'vocab-clip-moon' : 'vocab-clip-earth') : null;
    setAttrs(nodes.circle, {
      cx: fmt(pos.x), cy: fmt(pos.y), r: fmt(Math.max(r, 0.5)),
      fill: PALETTE.void, opacity: fmt(v.opacity), 'clip-path': clip,
    });
    return;
  }

  if (op === 'LimbArc') {
    const disc = discOf(frame, v.body);
    if (!disc.visible) { hide(g, true); return; }
    hide(g, false);
    let delta = ((v.angle1 - v.angle0) % 360 + 360) % 360;
    if (delta < 0.05) delta = 0.05;
    const a0 = v.angle0 * RAD;
    const a1 = a0 + delta * RAD;
    const large = delta > 180 ? 1 : 0;
    const x0 = disc.cx + disc.r * Math.cos(a0);
    const y0 = disc.cy + disc.r * Math.sin(a0);
    const x1 = disc.cx + disc.r * Math.cos(a1);
    const y1 = disc.cy + disc.r * Math.sin(a1);
    setAttrs(nodes.path, {
      d: `M ${fmt(x0)} ${fmt(y0)} A ${fmt(disc.r)} ${fmt(disc.r)} 0 ${large} 1 ${fmt(x1)} ${fmt(y1)}`,
      fill: 'none', stroke: paintColor(v.color), 'stroke-width': fmt(v.width_px),
      'stroke-linecap': 'round', opacity: fmt(v.opacity),
    });
    return;
  }

  if (op === 'TerminatorNotch') {
    const disc = discOf(frame, v.body);
    if (!disc.visible) { hide(g, true); return; }
    hide(g, false);
    const az = frame.sun.azDeg * RAD;
    const tx = Math.cos(az + Math.PI / 2);
    const ty = Math.sin(az + Math.PI / 2);
    const nx = Math.cos(az);
    const ny = Math.sin(az);
    const along = v.along * 2 - 1;
    const px = disc.cx + tx * disc.r * along * 0.92;
    const py = disc.cy + ty * disc.r * along * 0.92;
    const depth = Math.min(v.depth_px, disc.r * 0.45);
    const half = v.width_px / 2;
    const x0 = px - tx * half;
    const y0 = py - ty * half;
    const x1 = px + tx * half;
    const y1 = py + ty * half;
    const bx = px - nx * depth;
    const by = py - ny * depth;
    setAttrs(nodes.path, {
      d: `M ${fmt(x0)} ${fmt(y0)} Q ${fmt(bx)} ${fmt(by)} ${fmt(x1)} ${fmt(y1)} Z`,
      fill: PALETTE.void,
      'clip-path': clipUrl(v.body === 'moon' ? 'vocab-clip-moon' : 'vocab-clip-earth'),
    });
    return;
  }

  if (op === 'SurfacePatch') {
    const pos = surfacePos(v, frame);
    if (!pos) { hide(g, true); return; }
    hide(g, false);
    const R = v.body === 'moon' ? R_MOON : R_EARTH;
    const rPx = (v.r_km / R) * pos.disc.r * Math.max(pos.cosc, 0.15);
    const clip = sideClip(v.body, v.side);
    const hexStroke = frame.grade > 0.4 ? PALETTE['bone-dim'] : 'none';
    if (v.mode === 'thermal') {
      const fill = thermalFill(v.dT);
      const opy = fill ? Math.min(0.55, (Math.abs(v.dT) / 20) * 0.25) : 0;
      if (v.shape === 'hex') {
        setAttrs(nodes.ellipse, { visibility: 'hidden' });
        setAttrs(nodes.hex, {
          visibility: 'visible', points: hexPoints(pos.x, pos.y, rPx),
          fill: fill || PALETTE.void, opacity: fmt(opy), stroke: hexStroke, 'stroke-width': '1',
          'clip-path': clip,
        });
      } else {
        setAttrs(nodes.hex, { visibility: 'hidden' });
        setAttrs(nodes.ellipse, {
          visibility: 'visible', cx: fmt(pos.x), cy: fmt(pos.y), rx: fmt(rPx), ry: fmt(rPx * 0.72),
          fill: fill || PALETTE.void, opacity: fmt(opy), 'clip-path': clip,
        });
      }
    } else {
      const posA = v.dA >= 0;
      const fill = posA ? '#FFFFFF' : '#000000';
      const blend = posA ? 'screen' : 'multiply';
      const opy = Math.abs(v.dA);
      if (v.shape === 'hex') {
        setAttrs(nodes.ellipse, { visibility: 'hidden' });
        setAttrs(nodes.hex, {
          visibility: 'visible', points: hexPoints(pos.x, pos.y, rPx),
          fill, opacity: fmt(opy), stroke: hexStroke, 'stroke-width': '1',
          'mix-blend-mode': blend, 'clip-path': clip,
        });
      } else {
        setAttrs(nodes.hex, { visibility: 'hidden' });
        setAttrs(nodes.ellipse, {
          visibility: 'visible', cx: fmt(pos.x), cy: fmt(pos.y), rx: fmt(rPx), ry: fmt(rPx * 0.72),
          fill, opacity: fmt(opy), 'mix-blend-mode': blend, 'clip-path': clip,
        });
      }
    }
    return;
  }

  if (op === 'TransitMark') {
    const disc = discOf(frame, v.body);
    if (!disc.visible) { hide(g, true); return; }
    hide(g, false);
    const u = pathU(frame, v.duration_s);
    const p0 = v.path[0];
    const p1 = v.path[1];
    const unit = { x: lerp(p0.x, p1.x, u), y: lerp(p0.y, p1.y, u) };
    const p = onDisc(unit, disc);
    setAttrs(nodes.circle, {
      cx: fmt(p.x), cy: fmt(p.y), r: fmt(v.r_px),
      fill: v.body === 'moon' ? PALETTE['moon-shadow'] : PALETTE['earth-night'],
      'clip-path': clipUrl(v.body === 'moon' ? 'vocab-clip-moon' : 'vocab-clip-earth'),
    });
    return;
  }

  if (op === 'FlashSequence') {
    hide(g, false);
    const still = !frame.live || frame.reducedMotion;
    const t = still ? 0.3 * v.period_s : pacificSeconds(frame);
    const n = v.points.length;
    const col = paintColor(v.color);
    const r = pointSourceRadius(v.mag);
    for (let i = 0; i < n; i++) {
      const pos = resolveAt(v.points[i], frame);
      if (!pos) continue;
      const on = flashLit(i, n, v, t);
      const alpha = on ? 1 : 0;
      queue({ kind: 'point', x: pos.x, y: pos.y, r, color: col, alpha, additive: true });
      if (v.mag < 4 && on) {
        queue({ kind: 'point', x: pos.x, y: pos.y, r: 3 * r, color: col, alpha: 0.22, additive: true });
      }
    }
    return;
  }

  if (op === 'PulseRing') {
    const pos = resolveAt(v.at, frame);
    if (!pos) { hide(g, true); return; }
    hide(g, false);
    const frozen = !frame.live || frame.reducedMotion || v.static;
    let u;
    let opy;
    if (frozen) {
      u = 0.4;
      opy = 0.3;
    } else {
      const periodMs = v.period_s * 1000;
      u = ((nowMs % periodMs) + periodMs) % periodMs / periodMs;
      opy = 0.5 * (1 - u);
    }
    const r = lerp(v.r0_px, v.r1_px, u);
    setAttrs(nodes.circle, {
      cx: fmt(pos.x), cy: fmt(pos.y), r: fmt(r),
      stroke: paintColor(v.color), opacity: fmt(opy),
    });
    return;
  }

  if (op === 'ResidualGhost') {
    if (v.of === 'ribbon') {
      hide(g, false);
      const lift = (v.dr_km / 4000) * 8;
      setAttrs(nodes.path, {
        d: `M 80 ${fmt(830 - lift)} C 480 ${fmt(790 - lift)} 960 ${fmt(860 - lift)} 1520 ${fmt(810 - lift)}`,
        fill: 'none', stroke: paintColor(v.color), 'stroke-width': '1.2', opacity: fmt(v.opacity),
        'clip-path': null,
      });
      return;
    }
    const disc = discOf(frame, v.of);
    if (!disc.visible) { hide(g, true); return; }
    hide(g, false);
    const ppd = pxPerDeg(frame, v.of);
    const dx = v.dx_deg * ppd;
    const dy = v.dy_deg * ppd;
    const night = `${circlePath(disc.cx, disc.cy, disc.r)} ${litPath(disc.cx, disc.cy, disc.r, frame.sun)}`;
    setAttrs(nodes.path, {
      d: night, fill: paintColor(v.color), opacity: fmt(v.opacity),
      'fill-rule': 'evenodd',
      transform: `translate(${fmt(dx)} ${fmt(dy)})`,
    });
    return;
  }

  if (op === 'SkyBand') {
    hide(g, false);
    const a = v.angle * RAD;
    const cx = VIEW.w / 2 - Math.sin(a) * 1800;
    const cy = VIEW.h / 2 + Math.cos(a) * 1800;
    setAttrs(nodes.circle, {
      cx: fmt(cx), cy: fmt(cy), r: '2000',
      stroke: paintColor(v.color), 'stroke-width': fmt(v.thickness_px),
      opacity: fmt(v.opacity),
    });
    setBlend(nodes.circle, 'screen');
    return;
  }

  if (op === 'ShadowCast') {
    const moonTooSmall = frame.state.heroMoonAngularDia < 20;
    const opy = moonTooSmall ? 0 : v.opacity;
    setAttrs(g, { opacity: fmt(opy) });
    // The ship's own shadow is drawn by the vehicle module, which knows where the feet are and
    // how high the craft is; drawn from the ship's centre here it lay across the hull.
    if (v.from === 'ship' || typeof v.from === 'string') { hide(g, true); return; }
    const origin = resolveAt(v.from, frame);
    if (!origin) { hide(g, true); return; }
    hide(g, false);
    const nx = -frame.sun.sx;
    const ny = -frame.sun.sy;
    const n = Math.hypot(nx, ny) || 1;
    const ux = nx / n;
    const uy = ny / n;
    const px = -uy;
    const py = ux;
    const w0 = 3;
    const w1 = 8 + v.softness_px;
    const x1 = origin.x + ux * v.length_px;
    const y1 = origin.y + uy * v.length_px;
    const pts = [
      origin.x + px * w0, origin.y + py * w0,
      origin.x - px * w0, origin.y - py * w0,
      x1 - px * w1, y1 - py * w1,
      x1 + px * w1, y1 + py * w1,
    ];
    const useBlur = v.softness_px > 0 && !moonTooSmall;
    if (useBlur) setAttrs(clips.fe, { stdDeviation: fmt(v.softness_px) });
    const pairs = [];
    for (let i = 0; i < pts.length; i += 2) pairs.push(`${fmt(pts[i])},${fmt(pts[i + 1])}`);
    setAttrs(nodes.poly, {
      points: pairs.join(' '),
      fill: PALETTE['moon-shadow'],
      filter: useBlur ? 'url(#vocab-blur)' : null,
      'clip-path': clipUrl(v.body === 'earth' ? 'vocab-clip-earth' : 'vocab-clip-moon'),
    });
    return;
  }

  if (op === 'MeasureGrid') {
    const disc = discOf(frame, v.body);
    const opy = v.opacity * frame.grade;
    setAttrs(g, { opacity: fmt(opy) });
    if (!disc.visible || opy <= 0) { hide(g, opy <= 0); if (opy <= 0) return; }
    hide(g, false);
    const spacing = v.spacing_deg;
    const pts = [];
    const maxLat = 80;
    for (let lat = -maxLat; lat <= maxLat && pts.length < 80; lat += spacing) {
      for (let lon = -180; lon < 180 && pts.length < 80; lon += spacing) {
        const p = v.body === 'moon'
          ? projectMoon(lat, lon, frame.moonCamera)
          : projectEarth(lat, lon, frame.earthSpinDeg);
        if (p.cosc <= 0.2) continue;
        pts.push(onDisc(p, disc));
      }
    }
    for (let i = 0; i < nodes.ticks.length; i++) {
      if (i >= pts.length) {
        setAttrs(nodes.ticks[i], { visibility: 'hidden' });
        continue;
      }
      const p = pts[i];
      setAttrs(nodes.ticks[i], {
        visibility: 'visible',
        d: `M ${fmt(p.x - 2.5)} ${fmt(p.y)} L ${fmt(p.x + 2.5)} ${fmt(p.y)} M ${fmt(p.x)} ${fmt(p.y - 2.5)} L ${fmt(p.x)} ${fmt(p.y + 2.5)}`,
        'clip-path': clipUrl(v.body === 'moon' ? 'vocab-clip-moon' : 'vocab-clip-earth'),
      });
    }
    const barPx = 50;
    const R = v.body === 'moon' ? R_MOON : R_EARTH;
    const km = disc.r > 0 ? (barPx * R) / disc.r : 0;
    const x0 = Math.max(24, disc.cx - disc.r * 0.55);
    const y0 = Math.min(VIEW.h - 28, disc.cy + Math.min(disc.r * 0.7, 80));
    setAttrs(nodes.bar, { x1: fmt(x0), y1: fmt(y0), x2: fmt(x0 + barPx), y2: fmt(y0) });
    nodes.caption.textContent = `${Math.round(km)} km`;
    setAttrs(nodes.caption, { x: fmt(x0), y: fmt(y0 - 6) });
    return;
  }

  if (op === 'DistortionRings') {
    const pos = resolveAt(v.at, frame);
    if (!pos) { hide(g, true); return; }
    hide(g, false);
    for (let i = 0; i < 8; i++) {
      const ri = v.r_px * ((i + 1) / 8) * (1 + v.amount * Math.sin(i));
      setAttrs(nodes.rings[i], { cx: fmt(pos.x), cy: fmt(pos.y), r: fmt(ri) });
    }
    const showRays = frame.grade > 0.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      setAttrs(nodes.rays[i], {
        visibility: showRays ? 'visible' : 'hidden',
        x1: fmt(pos.x), y1: fmt(pos.y),
        x2: fmt(pos.x + v.r_px * Math.cos(a)), y2: fmt(pos.y + v.r_px * Math.sin(a)),
      });
    }
    return;
  }

  if (op === 'UmbraCoin') {
    if (!frame.earth.visible) { hide(g, true); return; }
    hide(g, false);
    const u = pathU(frame, v.duration_s);
    const unit = { x: lerp(v.path[0].x, v.path[1].x, u), y: lerp(v.path[0].y, v.path[1].y, u) };
    const p = onDisc(unit, frame.earth);
    const r = umbraRadius(frame, v);
    setAttrs(nodes.coin, {
      cx: fmt(p.x), cy: fmt(p.y), r: fmt(r),
      'clip-path': 'url(#vocab-clip-earth-lit)',
    });
    setAttrs(nodes.ring, {
      cx: fmt(p.x), cy: fmt(p.y), r: fmt(r),
      stroke: paintColor(v.annulus_color),
      visibility: v.annulus ? 'visible' : 'hidden',
      'clip-path': 'url(#vocab-clip-earth-lit)',
    });
  }
}

export function createAnomalyLayer(layer, ctx) {
  const defs = ctx && ctx.defs;
  const queue = (item) => {
    if (ctx && ctx.fx && typeof ctx.fx.queue === 'function') ctx.fx.queue(item);
  };
  let clips = null;
  let key = null;
  let items = [];

  function rebuild(visuals) {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    items = [];
    for (const visual of visuals) {
      if (!SCENE_SET.has(visual.op)) continue;
      const group = el('g', { 'data-op': visual.op }, layer);
      const nodes = build(visual.op, group);
      items.push({ visual, group, nodes });
    }
  }

  function update(frame, nowMs = 0) {
    if (defs && !clips) clips = ensureClips(defs);
    const visuals = sanitizeVisuals(frame.visuals);
    const scene = visuals.filter((v) => SCENE_SET.has(v.op));
    const next = JSON.stringify(scene);
    if (next !== key) {
      key = next;
      rebuild(visuals);
    }
    if (clips) updateClips(clips, frame);
    for (const item of items) paint(item, frame, nowMs, queue, clips || { fe: { setAttribute() {} } });
  }

  function destroy() {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    if (clips && defs) {
      for (const n of clips.owned) {
        if (n.parentNode === defs) defs.removeChild(n);
      }
    }
    clips = null;
    key = null;
    items = [];
  }

  return { update, destroy };
}
