// The spacecraft drawing: a rocket stack, nose up. A lander forms the nose (dome, instrument bay,
// stowed legs, attitude nozzles, dish and horn); a cylindrical cruise module below it carries the
// swept array panels, radiators and the ion nozzle at the tail. Posed by vehiclePose.
// DOM is built once; update mutates attributes. Hull Lambert is recomputed at 4 Hz.
// Owner ruling, 2026-09-13: the ship must read as a rocket, not a satellite. The silhouette is a
// tall narrow body with a pointed nose and a plume from the tail, and it must hold at phone size.

import { el, setAttrs, fmt, clamp, lerp, lerpHex, seeded, RAD, DEG } from './util.js';
import { PALETTE } from './palette.js';
import { hullFill } from './lighting.js';
import { vehiclePose } from './vehicle-pose.js';
import { SETPIECES } from './setpieces.js';

// Nominal on-screen size per breakpoint. The name is historical: it is now the rocket's length
// from nose to nozzle exit, in view units at ship scale 1.
export const WINGSPAN = { xl: 72, lg: 64, md: 56, sm: 44, xs: 32 };

const BUS = 16;
const NOSE_Y = -40;
const DOME_BASE_Y = -27;
const DOME_HALF = 7;
const LANDER_BASE_Y = -17;
const BODY_HALF = 9;
const BODY_BOT_Y = 22;
const SKIRT_Y = 26;
const NOZZLE_EXIT_Y = 32;
const UPPER_BOT_Y = 54;
const WING_ROOT = { x: 9, y: 2 };
const WING_TIP_X = 13;
const LANDER_DROP = 22; // after staging the lander settles to the ship's centre
const LEG_THIGH = 5.4;
const LEG_SHIN = 6.6;
const HIP_Y = -19;
const PUFF_SEED = 10007;

const HIP = [
  { x: -8.2, y: HIP_Y, side: -1, n: [-0.55, 0.15, 0.72] },
  { x: 8.2, y: HIP_Y, side: 1, n: [0.55, 0.15, 0.72] },
  { x: -6.6, y: HIP_Y + 1.2, side: -1, n: [-0.45, 0.35, 0.55] },
  { x: 6.6, y: HIP_Y + 1.2, side: 1, n: [0.45, 0.35, 0.55] },
];

function quad(pts) {
  return `M ${pts.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join(' L ')} Z`;
}

// Swept panel: root edge on the body side, tip swept aft. u runs root (0) to tip (1).
const wingTop = (u) => [WING_TIP_X * u, 12 * u];
const wingBot = (u) => [WING_TIP_X * u, 13 + 6 * u];

function wingCells(cells) {
  const g = 0.025;
  const parts = [];
  for (let i = 0; i < cells; i++) {
    const a = i / cells + g;
    const b = (i + 1) / cells - g;
    parts.push(quad([wingTop(a), wingTop(b), wingBot(b), wingBot(a)]));
  }
  return parts.join(' ');
}

function wingFramePath() {
  return quad([wingTop(0), wingTop(1), wingBot(1), wingBot(0)]);
}

function wingGrid(cells) {
  const parts = [];
  for (let i = 1; i < cells; i++) {
    const t = wingTop(i / cells);
    const b = wingBot(i / cells);
    parts.push(`M ${fmt(t[0])} ${fmt(t[1])} L ${fmt(b[0])} ${fmt(b[1])}`);
  }
  parts.push(`M 0 6.5 L ${fmt(WING_TIP_X)} 15.5`);
  return parts.join(' ');
}

// Sunward glass strip along the leading edge. hullFill's specular term lights it.
function wingGlintPath() {
  const t0 = wingTop(0);
  const t1 = wingTop(1);
  return quad([t0, t1, [t1[0], t1[1] + 1.3], [t0[0], t0[1] + 1.3]]);
}

// Inverse of hullFill's in-plane roll, so n_view equals S and the specular term can fire.
function sunFacingLocal(rollDeg, sun) {
  const r = rollDeg * RAD;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [sun.sx * c + sun.sy * s, -sun.sx * s + sun.sy * c, sun.sz];
}

function isoscelesDown(apexX, apexY, length, apexDeg) {
  const half = (apexDeg / 2) * RAD;
  const base = 2 * length * Math.tan(half);
  const by = apexY + length;
  return `M ${fmt(apexX)} ${fmt(apexY)} L ${fmt(apexX - base / 2)} ${fmt(by)} L ${fmt(apexX + base / 2)} ${fmt(by)} Z`;
}

// Plume from a nozzle exit: starts as wide as the exit and tapers to a point aft.
function plumePath(exitY, exitHalf, length) {
  return `M ${fmt(-exitHalf)} ${fmt(exitY)} L ${fmt(exitHalf)} ${fmt(exitY)} L ${fmt(exitHalf * 0.35)} ${fmt(exitY + length)} L ${fmt(-exitHalf * 0.35)} ${fmt(exitY + length)} Z`;
}

function fairingHalf(side) {
  const s = side;
  const x0 = 0.4 * s;
  const w = 12.5 * s;
  return [
    `M ${fmt(x0)} ${fmt(NOSE_Y - 10)}`,
    `C ${fmt(8 * s)} ${fmt(NOSE_Y - 6)} ${fmt(w)} ${fmt(NOSE_Y + 4)} ${fmt(w)} ${fmt(NOSE_Y + 18)}`,
    `L ${fmt(w)} ${fmt(NOZZLE_EXIT_Y)}`,
    `L ${fmt(x0)} ${fmt(NOZZLE_EXIT_Y)} Z`,
  ].join(' ');
}

function domePath() {
  const b = DOME_BASE_Y;
  const h = DOME_HALF;
  return `M ${fmt(-h)} ${fmt(b)} C ${fmt(-h)} ${fmt(b - 7)} ${fmt(-3.5)} ${fmt(NOSE_Y + 1)} 0 ${fmt(NOSE_Y)} C ${fmt(3.5)} ${fmt(NOSE_Y + 1)} ${fmt(h)} ${fmt(b - 7)} ${fmt(h)} ${fmt(b)} Z`;
}

function adapterPath() {
  return quad([[-DOME_HALF, DOME_BASE_Y], [DOME_HALF, DOME_BASE_Y], [BODY_HALF, LANDER_BASE_Y], [-BODY_HALF, LANDER_BASE_Y]]);
}

function bellPath() {
  return quad([[-3, LANDER_BASE_Y], [3, LANDER_BASE_Y], [5, LANDER_BASE_Y + 5], [-5, LANDER_BASE_Y + 5]]);
}

function legGeometry(p, side) {
  const hip = p * 75 * RAD;
  const knee = p * 58 * RAD;
  const kx = side * LEG_THIGH * Math.sin(hip);
  const ky = -LEG_THIGH * Math.cos(hip);
  const ang = hip + knee;
  const fx = kx + side * LEG_SHIN * Math.sin(ang);
  const fy = ky - LEG_SHIN * Math.cos(ang) + p * 5.5;
  return { kx, ky, fx, fy };
}

function legPolyline(p, side) {
  const g = legGeometry(p, side);
  return `M 0 0 L ${fmt(g.kx)} ${fmt(g.ky)} L ${fmt(g.fx)} ${fmt(g.fy)}`;
}

function ellipsePath(cx, cy, rx, ry) {
  return [
    `M ${fmt(cx - rx)} ${fmt(cy)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)} Z`,
  ].join(' ');
}

function wrap180(deg) {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function approach(cur, target, rate, dt) {
  const max = rate * dt;
  const d = wrap180(target - cur);
  if (Math.abs(d) <= max) return target;
  return cur + Math.sign(d) * max;
}

function puffState(frame) {
  if (!frame.live || frame.reducedMotion || frame.present === false) {
    return { on: false, drift: 0 };
  }
  if (frame.day < 1 || frame.day >= 365) return { on: false, drift: 0 };
  const rng = seeded(PUFF_SEED + frame.day * 17);
  let lo = 8;
  let hi = 20;
  if (frame.day >= 347) {
    lo = 2;
    hi = 5;
  } else if (frame.day >= 339) {
    lo = 4;
    hi = 8;
  }
  const intervalSec = (lo + rng() * (hi - lo)) * 60;
  const phase = (frame.t * 86400) % intervalSec;
  const on = phase < 0.12;
  const drift = phase >= 0.12 && phase < 4.12 ? 0.6 * (1 - (phase - 0.12) / 4) : 0;
  return { on, drift };
}

function sepKind(value) {
  if (value === 'on' || value === 'attached') return 'attached';
  if (value === 'off' || value === 'gone') return 'gone';
  return 'leaving';
}

function localToView(lx, ly, x, y, scale, rollDeg) {
  const r = rollDeg * RAD;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x + (lx * c - ly * s) * scale, y: y + (lx * s + ly * c) * scale };
}

function stubFx(fx) {
  if (fx && typeof fx.emit === 'function' && typeof fx.queue === 'function') return fx;
  return { emit() {}, queue() {} };
}

// The ExhaustTrail beats live on the frame's day, keyed to displayed hours.
function trailsNow(frame) {
  const out = [];
  for (const ev of SETPIECES) {
    if (ev.day !== frame.day || ev.op !== 'ExhaustTrail') continue;
    if (frame.hour >= ev.t0 && frame.hour <= ev.t1) out.push(ev);
  }
  return out;
}

export function createVehicle(layer, ctx) {
  const defs = ctx.defs;
  const fx = stubFx(ctx.fx);
  const breakpoint = ctx.breakpoint ?? 'xl';
  const span0 = WINGSPAN[breakpoint] ?? WINGSPAN.xl;
  const hulls = [];
  const owned = [];

  const take = (node) => {
    owned.push(node);
    return node;
  };

  const hull = (tag, attrs, parent, material, n, mode = 'fill', role = null) => {
    const node = el(tag, {
      ...attrs,
      'data-n': `${fmt(n[0])},${fmt(n[1])},${fmt(n[2])}`,
      'data-material': material,
    }, parent);
    hulls.push({ node, n, material, mode, role });
    return node;
  };

  function viewPxPerLocal(scale) {
    const svg = ctx.svg;
    const w = svg && svg.clientWidth ? svg.clientWidth : 0;
    const h = svg && svg.clientHeight ? svg.clientHeight : 0;
    if (!w || !h) return scale;
    return scale * Math.max(w / 1600, h / 900);
  }

  const ionGrad = take(el('linearGradient', {
    id: 'vehicle-ion-plume',
    gradientUnits: 'objectBoundingBox',
    x1: '0.5', y1: '0', x2: '0.5', y2: '1',
  }, defs));
  el('stop', { offset: '0%', 'stop-color': PALETTE['plume-core'], 'stop-opacity': '0.9' }, ionGrad);
  el('stop', { offset: '35%', 'stop-color': PALETTE.plume, 'stop-opacity': '0.55' }, ionGrad);
  el('stop', { offset: '100%', 'stop-color': PALETTE.plume, 'stop-opacity': '0' }, ionGrad);

  const kickGrad = take(el('linearGradient', {
    id: 'vehicle-kick-plume',
    gradientUnits: 'objectBoundingBox',
    x1: '0.5', y1: '0', x2: '0.5', y2: '1',
  }, defs));
  el('stop', { offset: '0%', 'stop-color': PALETTE['plume-kick'], 'stop-opacity': '0.9' }, kickGrad);
  el('stop', { offset: '100%', 'stop-color': PALETTE['plume-kick'], 'stop-opacity': '0' }, kickGrad);

  const root = take(el('g', { id: 'vehicle-root', 'pointer-events': 'none' }, layer));
  const scaled = el('g', { id: 'vehicle-scale' }, root);
  const shadow = el('path', {
    id: 'vehicle-shadow',
    fill: PALETTE['moon-shadow'],
    opacity: '0',
    display: 'none',
  }, scaled);
  const vehicle = el('g', { id: 'vehicle' }, scaled);

  const upperHost = el('g', { id: 'vehicle-upper-host' }, vehicle);
  const cruiseHost = el('g', { id: 'vehicle-cruise-host' }, vehicle);
  const lander = el('g', { id: 'lander' }, vehicle);

  const sepUpper = el('g', { id: 'sep-upper' }, scaled);
  const sepCruise = el('g', { id: 'sep-cruise' }, scaled);
  const sepFairL = el('g', { id: 'sep-fairing-l' }, scaled);
  const sepFairR = el('g', { id: 'sep-fairing-r' }, scaled);

  // Upper stage of the launcher, below the tail until day 0's separation: a tall grey cylinder
  // the width of the body, in the same three shading facets, with a dark interstage band and its
  // own bell, so launch day reads as one tall rocket rather than a box under the ship.
  const upper = el('g', { id: 'upper-stage' }, upperHost);
  const upTop = NOZZLE_EXIT_Y - 7;
  hull('path', {
    d: quad([[-BODY_HALF, upTop], [-3, upTop], [-3, UPPER_BOT_Y], [-BODY_HALF, UPPER_BOT_Y]]),
    fill: PALETTE['hull-shade'],
  }, upper, 'hull', [-0.8, 0, 0.6]);
  hull('path', {
    d: quad([[-3, upTop], [3, upTop], [3, UPPER_BOT_Y], [-3, UPPER_BOT_Y]]),
    fill: PALETTE['hull-lit'],
  }, upper, 'hull', [0, 0, 1]);
  hull('path', {
    d: quad([[3, upTop], [BODY_HALF, upTop], [BODY_HALF, UPPER_BOT_Y], [3, UPPER_BOT_Y]]),
    fill: PALETTE['hull-mid'],
  }, upper, 'hull', [0.8, 0, 0.6]);
  hull('path', {
    d: quad([[-BODY_HALF, upTop], [BODY_HALF, upTop], [BODY_HALF, upTop + 4], [-BODY_HALF, upTop + 4]]),
    fill: PALETTE.bay,
  }, upper, 'bay', [0, 0, 1]);
  hull('path', {
    d: quad([[-3.5, UPPER_BOT_Y], [3.5, UPPER_BOT_Y], [6, UPPER_BOT_Y + 6], [-6, UPPER_BOT_Y + 6]]),
    fill: PALETTE['ceramic-shade'],
  }, upper, 'ceramic', [0, 0.85, 0.2]);

  const cruise = el('g', { id: 'cruise' }, cruiseHost);

  // Ion exhaust lives outside g#vehicle so the silhouette check measures the hull, not the plume.
  const exhaustHost = take(el('g', { id: 'vehicle-exhaust', 'pointer-events': 'none' }));
  if (layer.parentNode) layer.parentNode.appendChild(exhaustHost);
  else layer.appendChild(exhaustHost);
  const exhaustScaled = el('g', { id: 'vehicle-exhaust-scale' }, exhaustHost);
  const exhaustPose = el('g', { id: 'vehicle-exhaust-pose' }, exhaustScaled);
  const ionPlume = el('path', {
    id: 'vehicle-ion-plume-path',
    d: plumePath(NOZZLE_EXIT_Y, 4.6, 3.8 * BUS),
    fill: 'url(#vehicle-ion-plume)',
    opacity: '0',
  }, exhaustPose);

  const wings = el('g', { id: 'wings' }, cruise);
  const makeWing = (id, xform) => {
    const g = el('g', { id, transform: xform }, wings);
    hull('path', {
      d: wingCells(3),
      fill: PALETTE['array-cell'],
    }, g, 'array', [0, 0, 1], 'fill', 'array-cell');
    const grid = hull('path', {
      d: wingGrid(3),
      fill: 'none',
      stroke: PALETTE['array-grid'],
      'stroke-width': '0.45',
      'stroke-linejoin': 'miter',
      'stroke-linecap': 'square',
    }, g, 'array', [0, 0, 1], 'stroke', 'array-grid');
    const glint = hull('path', {
      d: wingGlintPath(),
      fill: PALETTE['array-glint'],
    }, g, 'array', [0, 0, 1], 'fill', 'array-glint');
    // Non-scaling so the frame stays ≥ 1 CSS pixel on a phone-size ship and a hairline at 600px.
    const frame = el('path', {
      d: wingFramePath(),
      fill: 'none',
      stroke: PALETTE['array-glint'],
      'stroke-width': '1',
      'stroke-linejoin': 'miter',
      'vector-effect': 'non-scaling-stroke',
    }, g);
    return { g, grid, glint, frame };
  };
  const wingR = makeWing('wing-r', `translate(${WING_ROOT.x},${WING_ROOT.y})`);
  const wingL = makeWing('wing-l', `translate(${-WING_ROOT.x},${WING_ROOT.y}) scale(-1,1)`);

  // Cylinder in three facets so Lambert shading reads as round.
  hull('path', {
    d: quad([[-BODY_HALF, LANDER_BASE_Y], [-3, LANDER_BASE_Y], [-3, BODY_BOT_Y], [-BODY_HALF, BODY_BOT_Y]]),
    fill: PALETTE['hull-shade'],
  }, cruise, 'hull', [-0.8, 0, 0.6]);
  hull('path', {
    d: quad([[-3, LANDER_BASE_Y], [3, LANDER_BASE_Y], [3, BODY_BOT_Y], [-3, BODY_BOT_Y]]),
    fill: PALETTE['hull-lit'],
  }, cruise, 'hull', [0, 0, 1]);
  hull('path', {
    d: quad([[3, LANDER_BASE_Y], [BODY_HALF, LANDER_BASE_Y], [BODY_HALF, BODY_BOT_Y], [3, BODY_BOT_Y]]),
    fill: PALETTE['hull-mid'],
  }, cruise, 'hull', [0.8, 0, 0.6]);
  hull('path', {
    d: quad([[-BODY_HALF, 2], [BODY_HALF, 2], [BODY_HALF, 8], [-BODY_HALF, 8]]),
    fill: PALETTE['mli-lit'],
  }, cruise, 'mli', [0, 0.05, 0.98]);
  hull('path', {
    d: quad([[-7, -13], [-4.5, -13], [-4.5, -3], [-7, -3]]),
    fill: PALETTE.radiator,
  }, cruise, 'radiator', [-0.55, 0, 0.83]);
  hull('path', {
    d: quad([[4.5, -13], [7, -13], [7, -3], [4.5, -3]]),
    fill: PALETTE['radiator-shade'],
  }, cruise, 'radiator', [0.55, 0, 0.83]);
  hull('path', {
    d: quad([[-BODY_HALF, BODY_BOT_Y], [BODY_HALF, BODY_BOT_Y], [6.5, SKIRT_Y], [-6.5, SKIRT_Y]]),
    fill: PALETTE['hull-shade'],
  }, cruise, 'hull', [0, 0.7, 0.7]);
  hull('path', {
    d: quad([[-3.2, SKIRT_Y], [3.2, SKIRT_Y], [5.4, NOZZLE_EXIT_Y], [-5.4, NOZZLE_EXIT_Y]]),
    fill: PALETTE.ceramic,
  }, cruise, 'ceramic', [0, 0.7, 0.55]);
  const ringInner = hull('ellipse', {
    cx: '0',
    cy: fmt(NOZZLE_EXIT_Y),
    rx: '4.6',
    ry: '1.1',
    fill: 'none',
    stroke: 'none',
    'stroke-width': '1.5',
  }, cruise, 'ceramic', [0, 0.2, 0.9], 'stroke');

  const descentPlume = el('path', {
    id: 'vehicle-descent-plume',
    d: plumePath(LANDER_BASE_Y + 5, 4.4, 2.2 * BUS),
    fill: 'url(#vehicle-kick-plume)',
    opacity: '0',
  }, lander);

  const bell = hull('path', { d: bellPath(), fill: PALETTE['ceramic-shade'] }, lander, 'ceramic', [0, 0.8, 0.4]);
  hull('path', { d: adapterPath(), fill: PALETTE['mli-mid'] }, lander, 'mli', [0, -0.2, 0.95]);
  hull('path', { d: domePath(), fill: PALETTE['hull-lit'] }, lander, 'hull', [0, -0.35, 0.9]);
  const bay = hull('path', {
    d: quad([[-3.4, -36], [3.4, -36], [3.4, -31.4], [-3.4, -31.4]]),
    fill: PALETTE.bay,
  }, lander, 'bay', [0, 0, 1]);
  const bayHoles = el('path', {
    d: 'M -2.6 -35.3 L -1.3 -35.3 L -1.3 -32.1 L -2.6 -32.1 Z M -0.6 -35.3 L 0.6 -35.3 L 0.6 -32.1 L -0.6 -32.1 Z M 1.3 -35.3 L 2.6 -35.3 L 2.6 -32.1 L 1.3 -32.1 Z',
    fill: PALETTE.void,
  }, lander);

  const legsG = el('g', { id: 'legs', 'data-state': 'stowed' }, lander);
  const legParts = HIP.map((hip, i) => {
    const g = el('g', { 'data-leg': String(i) }, legsG);
    const poly = hull('path', {
      d: legPolyline(0, hip.side),
      fill: 'none',
      stroke: PALETTE.leg,
      'stroke-width': '1.2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }, g, 'leg', hip.n, 'stroke');
    const joint = el('circle', { r: '0.8', fill: PALETTE['leg-joint'], cx: '0', cy: '0' }, g);
    const foot = el('circle', { r: '1.1', fill: PALETTE.leg, cx: '0', cy: '0' }, g);
    return { g, poly, joint, foot, hip };
  });

  const nozzles = [];
  const nozzleLocal = [
    { x: -6.8, y: -28.5, rot: -52 },
    { x: 6.8, y: -28.5, rot: 52 },
    { x: -9, y: -18.2, rot: -128 },
    { x: 9, y: -18.2, rot: 128 },
  ];
  const nozzleG = el('g', { id: 'attitude-nozzles' }, lander);
  for (const n of nozzleLocal) {
    const g = el('g', { transform: `translate(${fmt(n.x)},${fmt(n.y)}) rotate(${fmt(n.rot)})` }, nozzleG);
    hull('path', {
      d: 'M 0 0 L 1.1 -0.55 L 1.1 0.55 Z',
      fill: PALETTE.ceramic,
    }, g, 'ceramic', [Math.sin(n.rot * RAD), -Math.cos(n.rot * RAD), 0.4]);
    const cone = el('path', {
      d: isoscelesDown(0, 0, 8, 28),
      fill: PALETTE['plume-kick'],
      opacity: '0',
      transform: 'rotate(180)',
    }, g);
    nozzles.push({ g, cone, n });
  }

  const dishG = el('g', { id: 'dish' }, lander);
  hull('path', {
    d: 'M 0 0 L 2 0 L 2 -0.9 L 0 -0.9 Z',
    fill: PALETTE['hull-mid'],
  }, dishG, 'hull', [0.4, -0.2, 0.85]);
  hull('ellipse', {
    cx: '4.2',
    cy: '-0.45',
    rx: '3.4',
    ry: '2.9',
    fill: PALETTE['hull-lit'],
    stroke: PALETTE['hull-shade'],
    'stroke-width': '0.4',
  }, dishG, 'hull', [0.15, -0.1, 0.98]);

  const boomG = el('g', { id: 'boom' }, lander);
  hull('path', {
    d: 'M 0 0 L -9 0 L -9 0.6 L 0 0.6 Z',
    fill: PALETTE['hull-shade'],
  }, boomG, 'hull', [0, 0.4, 0.8]);
  const hornG = el('g', { id: 'horn' }, boomG);
  hull('path', {
    d: 'M 0 0 L -2 -1 L -2 1 Z',
    fill: PALETTE['hull-lit'],
  }, hornG, 'hull', [-0.7, 0, 0.7]);

  const puffA = el('rect', {
    x: '-1.5', y: '-1.5', width: '3', height: '3',
    fill: PALETTE.radiator, opacity: '0',
  }, lander);
  const puffB = el('rect', {
    x: '-1.5', y: '-1.5', width: '3', height: '3',
    fill: PALETTE.radiator, opacity: '0',
  }, lander);

  hull('path', {
    d: fairingHalf(-1),
    fill: PALETTE['hull-shade'],
    opacity: '0.92',
  }, sepFairL, 'hull', [-0.8, 0, 0.5]);
  hull('path', {
    d: fairingHalf(1),
    fill: PALETTE['hull-mid'],
    opacity: '0.92',
  }, sepFairR, 'hull', [0.8, 0, 0.5]);

  let lookCmd = null;
  let lookBodyAz = 0;
  let lookDishAz = 0;
  let lookPhase = 'idle';
  let lookHoldAt = 0;
  let lookStart = null;
  let lastMs = 0;
  let lastDay = null;
  let dishAngle = 0;
  let lastFillKey = '';
  let lastKey = '';
  let lastNodeCount = -1;
  let plumeKey = '';
  const trailBirth = new Map();

  function look(spec) {
    lookCmd = {
      target: spec?.target ?? null,
      az: spec?.az ?? 0,
      el: spec?.el ?? 0,
      holdSec: spec?.holdSec ?? 22,
    };
    lookPhase = 'lead';
    lookStart = null;
    lookHoldAt = 0;
  }

  function paintHull(rollDeg, sun, gain) {
    for (const h of hulls) {
      const color = hullFill(h.material, h.n, rollDeg, sun, gain);
      if (h.mode === 'stroke') {
        setAttrs(h.node, { stroke: color, fill: h.node.getAttribute('fill') === 'none' || h.material === 'array' || h.material === 'leg' ? 'none' : color });
      } else {
        setAttrs(h.node, { fill: color });
      }
    }
  }

  function adopt(node, parent) {
    if (node.parentNode !== parent) parent.appendChild(node);
  }

  function hide(node, hidden) {
    // display, not visibility: in SVG a child with visibility=visible paints even
    // when an ancestor is hidden, which would leak the cruise module before fairing sep.
    setAttrs(node, { display: hidden ? 'none' : null });
  }

  function clearFx(kind) {
    if (typeof fx.clear === 'function') fx.clear(kind);
  }

  function updateLook(nowMs, dt, liveMotion) {
    if (!lookCmd || !liveMotion) {
      if (!liveMotion) {
        lookBodyAz = 0;
        lookDishAz = 0;
      }
      return;
    }
    if (lookStart == null) lookStart = nowMs;
    const elapsed = (nowMs - lookStart) / 1000;
    if (lookPhase === 'lead') {
      lookDishAz = approach(lookDishAz, lookCmd.az, 4, dt);
      if (elapsed >= 0.5) lookPhase = 'slew';
    }
    if (lookPhase === 'slew') {
      lookDishAz = approach(lookDishAz, lookCmd.az, 4, dt);
      lookBodyAz = approach(lookBodyAz, lookCmd.az, 1.2, dt);
      if (Math.abs(wrap180(lookBodyAz - lookCmd.az)) < 0.05) {
        lookPhase = 'hold';
        lookHoldAt = nowMs;
      }
    } else if (lookPhase === 'hold') {
      lookBodyAz = lookCmd.az;
      lookDishAz = lookCmd.az;
      if ((nowMs - lookHoldAt) / 1000 >= lookCmd.holdSec) lookPhase = 'return';
    } else if (lookPhase === 'return') {
      lookBodyAz = approach(lookBodyAz, 0, 1.2, dt);
      lookDishAz = approach(lookDishAz, 0, 4, dt);
      if (Math.abs(lookBodyAz) < 0.05 && Math.abs(lookDishAz) < 0.05) {
        lookCmd = null;
        lookPhase = 'idle';
        lookBodyAz = 0;
        lookDishAz = 0;
      }
    }
  }

  // ExhaustTrail beats (§6.8.2 #19). Ascent is a rising column re-seeded while its window is
  // open; separation and dust are single throws, emitted once when their window is first seen.
  function emitTrails(frame, nowMs, x, y, s, bodyRot, landerOff, legP) {
    for (const ev of trailsNow(frame)) {
      const key = `${frame.day}|${ev.kind}|${ev.t0}`;
      const born = trailBirth.get(key);
      if (ev.kind === 'ascent') {
        if (born != null && nowMs - born < 2600 && nowMs >= born) continue;
        const e = frame.earth;
        const dx = x - e.cx;
        const limbY = Math.abs(dx) < e.r ? e.cy - Math.sqrt(e.r * e.r - dx * dx) : y + 40;
        fx.emit('ascent', {
          x, y: limbY, angleDeg: -90, density: ev.density, birthMs: nowMs, nowMs, seed: 1001 + (Math.floor(nowMs / 2600) % 97),
        });
        trailBirth.set(key, nowMs);
      } else if (born == null) {
        if (ev.kind === 'separation') {
          const at = frame.day === 0
            ? localToView(0, NOZZLE_EXIT_Y, x, y, s, bodyRot)
            : localToView(0, LANDER_BASE_Y, x, y, s, bodyRot);
          fx.emit('separation', { x: at.x, y: at.y, angleDeg: frame.day === 0 ? 90 : 20, birthMs: nowMs, nowMs });
        } else if (ev.kind === 'surface-dust') {
          const foot = legGeometry(legP, 1);
          const at = localToView(0, HIP_Y + foot.fy + landerOff, x, y, s, bodyRot);
          fx.emit('surface-dust', { x: at.x, y: at.y, density: ev.density ?? 0.5, birthMs: nowMs, nowMs });
        }
        trailBirth.set(key, nowMs);
      }
    }
  }

  function update(frame, nowMs = 0) {
    const pose = vehiclePose(frame);
    const liveMotion = frame.live && !frame.reducedMotion;
    const dt = lastMs && nowMs > lastMs ? Math.min(0.25, (nowMs - lastMs) / 1000) : 0;
    lastMs = nowMs;
    if (lastDay !== frame.day) {
      lastDay = frame.day;
      dishAngle = 0;
      trailBirth.clear();
    }

    const fillTick = Math.floor(nowMs / 250);
    const motionTick = liveMotion ? Math.floor(nowMs / 33) : 0;
    const cruiseKey = typeof pose.cruiseModule === 'object' ? pose.cruiseModule.p : pose.cruiseModule;
    const fairKey = typeof pose.fairing === 'object' ? pose.fairing.p : pose.fairing;
    const upperKey = typeof pose.upperStage === 'object' ? pose.upperStage.p : pose.upperStage;
    const svgW = ctx.svg && ctx.svg.clientWidth ? ctx.svg.clientWidth : 0;
    const svgH = ctx.svg && ctx.svg.clientHeight ? ctx.svg.clientHeight : 0;
    const key = [
      frame.day, frame.hour, frame.live, frame.reducedMotion, pose.present,
      pose.arrays, pose.boom, pose.dish, pose.legs, cruiseKey, fairKey, upperKey,
      pose.ion.on, pose.ion.throttle, pose.descent.on, pose.attitude.on, pose.shadow,
      pose.headingDeg, frame.ship.x, frame.ship.y, frame.ship.scale,
      frame.sun.sx, frame.sun.sy, frame.sun.sz, frame.gain, fillTick, motionTick,
      lookPhase, lookBodyAz, svgW, svgH,
    ].join('|');
    if (key === lastKey) return;
    lastKey = key;

    const span = span0 * frame.ship.scale;
    const s = span / 72;
    const x = frame.ship.x;
    const y = frame.ship.y;
    setAttrs(root, { transform: `translate(${fmt(x)} ${fmt(y)})` });
    setAttrs(scaled, { transform: `scale(${fmt(s)})` });

    hide(root, !pose.present && sepKind(pose.fairing) !== 'leaving');
    hide(exhaustHost, !pose.present && sepKind(pose.fairing) !== 'leaving');

    const puff = puffState({ ...frame, present: pose.present });
    const looking = lookCmd && lookPhase !== 'idle';
    updateLook(nowMs, dt || 1 / 30, liveMotion);
    const thrustBias = pose.ion.on ? 0.4 : 0;
    const bodyRot = pose.headingDeg + lookBodyAz + puff.drift + thrustBias;
    setAttrs(vehicle, { transform: `rotate(${fmt(bodyRot)})` });

    const deployed = pose.arrays >= 0.95;
    const glintN = deployed ? sunFacingLocal(bodyRot, frame.sun) : [0, 0, 1];
    for (const h of hulls) {
      if (h.role === 'array-glint') h.n = glintN;
    }

    const fillKey = `${fmt(bodyRot)}|${fmt(frame.sun.sx)}|${fmt(frame.sun.sy)}|${fmt(frame.sun.sz)}|${fmt(frame.gain)}|${fillTick}|${fmt(glintN[0])}`;
    if (fillKey !== lastFillKey) {
      paintHull(bodyRot, frame.sun, frame.gain);
      lastFillKey = fillKey;
    }

    const px = viewPxPerLocal(s);
    const smallU = clamp((0.9 - px) / 0.55, 0, 1);
    const tiny = smallU > 0.45;
    // Folded flat against the body, the panels unfold outward to their swept pose.
    const unfold = lerp(0.08, 1, pose.arrays);
    const dither = liveMotion && pose.arrays >= 1 ? 0.3 * Math.sin((nowMs / 1000) * Math.PI * 2 * 0.02) : 0;
    setAttrs(wings, { transform: `rotate(${fmt(dither)})` });
    setAttrs(wingR.g, { transform: `translate(${WING_ROOT.x},${WING_ROOT.y}) scale(${fmt(unfold)} 1)` });
    setAttrs(wingL.g, { transform: `translate(${-WING_ROOT.x},${WING_ROOT.y}) scale(${fmt(-unfold)} 1)` });
    const gridLit = hullFill('array', [0, 0, 1], bodyRot, frame.sun, frame.gain);
    const gridColor = lerpHex(gridLit, PALETTE['array-glint'], smallU);
    const frameColor = lerpHex(PALETTE['array-grid'], PALETTE['array-glint'], Math.max(smallU, 0.4));
    const gridW = tiny ? '1' : '0.45';
    const gridVe = tiny ? 'non-scaling-stroke' : null;
    for (const wing of [wingR, wingL]) {
      setAttrs(wing.grid, {
        stroke: gridColor,
        'stroke-width': gridW,
        'vector-effect': gridVe,
      });
      setAttrs(wing.frame, { stroke: frameColor });
    }
    if (smallU > 0) {
      for (const h of hulls) {
        if (h.role !== 'array-cell') continue;
        const base = hullFill('array', h.n, bodyRot, frame.sun, frame.gain);
        setAttrs(h.node, { fill: lerpHex(base, PALETTE['array-glint'], smallU * 0.55) });
      }
    }
    // At phone size the rocket is nose, body, panels and tail. Dish, boom, nozzles and the bay
    // apertures are inspection detail that only muddies the outline.
    hide(dishG, tiny);
    hide(boomG, tiny);
    hide(nozzleG, tiny);
    hide(bayHoles, tiny);
    if (tiny) {
      setAttrs(bay, { fill: hullFill('hull', [0, -0.1, 0.95], bodyRot, frame.sun, frame.gain) });
    } else {
      setAttrs(bay, { fill: PALETTE.bay });
    }

    const boomRot = lerp(-80, -20, pose.boom);
    setAttrs(boomG, { transform: `translate(-6.2,-24) rotate(${fmt(boomRot)})` });
    const hornNod = liveMotion ? 8 * Math.sin((nowMs / 1000) * Math.PI * 2 / 90) : 0;
    setAttrs(hornG, { transform: `translate(-9,0.3) rotate(${fmt(hornNod)})` });

    const earthAng = Math.atan2(frame.earth.cy - y, frame.earth.cx - x) * DEG;
    const dishTarget = pose.dish >= 1
      ? earthAng - bodyRot + (liveMotion ? 0.4 * Math.sin((nowMs / 1000) * Math.PI * 2 * 0.05) : 0) + lookDishAz
      : lerp(-90, earthAng - bodyRot, pose.dish);
    if (liveMotion && pose.dish >= 1 && dt > 0) dishAngle = approach(dishAngle, dishTarget, 4, dt);
    else dishAngle = dishTarget;
    const dishFold = lerp(0.25, 1, pose.dish);
    setAttrs(dishG, {
      transform: `translate(6.2,-24) rotate(${fmt(dishAngle)}) scale(${fmt(dishFold)})`,
    });

    const legP = pose.legs;
    const legState = legP <= 0 ? 'stowed' : legP >= 1 ? 'down' : 'deploying';
    setAttrs(legsG, { 'data-state': legState });
    for (const part of legParts) {
      setAttrs(part.g, { transform: `translate(${fmt(part.hip.x)},${fmt(part.hip.y)})` });
      setAttrs(part.poly, { d: legPolyline(legP, part.hip.side) });
      const g = legGeometry(legP, part.hip.side);
      setAttrs(part.joint, { cx: fmt(g.kx), cy: fmt(g.ky) });
      setAttrs(part.foot, { cx: fmt(g.fx), cy: fmt(g.fy) });
    }

    const ionOp = pose.ion.on ? clamp(0.6 * pose.ion.throttle, 0, 0.6) : 0;
    setAttrs(ringInner, {
      stroke: pose.ion.on ? PALETTE.plume : 'none',
      'stroke-width': pose.ion.on ? '1.5' : '0',
    });

    let descentOp = 0;
    if (pose.descent.on) {
      if (liveMotion && pose.descent.flickerHz > 0) {
        const tick = Math.floor(nowMs * pose.descent.flickerHz / 1000);
        const rng = seeded(4109 + tick);
        descentOp = 0.55 + 0.35 * rng();
      } else {
        descentOp = 0.75;
      }
    }
    setAttrs(descentPlume, {
      opacity: fmt(descentOp),
      display: descentOp > 0 ? null : 'none',
    });

    const attLive = pose.attitude.on && liveMotion;
    const attStatic = pose.attitude.on && !liveMotion;
    for (let i = 0; i < nozzles.length; i++) {
      let op = 0;
      if (attStatic) op = 0.7;
      else if (attLive) {
        const tick = Math.floor(nowMs * 12 / 1000);
        const rng = seeded(7727 + i * 13 + tick);
        op = rng() > 0.4 ? 0.7 : 0.08;
      }
      setAttrs(nozzles[i].cone, { opacity: fmt(op) });
    }

    setAttrs(puffA, {
      transform: 'translate(-7.4,-29)',
      opacity: puff.on ? '0.8' : '0',
    });
    setAttrs(puffB, {
      transform: 'translate(7.4,-29)',
      opacity: puff.on ? '0.8' : '0',
    });

    const cruiseK = sepKind(pose.cruiseModule);
    if (cruiseK === 'attached') adopt(cruise, cruiseHost);
    else adopt(cruise, sepCruise);
    hide(cruise, cruiseK === 'gone');
    hide(sepCruise, cruiseK !== 'leaving');
    // The descent bell is housed in the cruise module's top until staging exposes it.
    hide(bell, cruiseK === 'attached');
    let landerOff = 0;
    if (cruiseK === 'leaving') {
      const p = pose.cruiseModule.p;
      landerOff = p * LANDER_DROP;
      setAttrs(sepCruise, {
        transform: `rotate(${fmt(bodyRot)}) translate(${fmt(p * 46)} ${fmt(p * 64)}) rotate(${fmt(p * 24)})`,
        opacity: fmt(p < 0.82 ? 1 : (1 - p) / 0.18),
      });
    } else {
      if (cruiseK === 'gone') landerOff = LANDER_DROP;
      setAttrs(sepCruise, { transform: '', opacity: '1' });
    }
    setAttrs(lander, { transform: landerOff ? `translate(0 ${fmt(landerOff)})` : null });

    // Ground shadow (§7.7.2): an ellipse on the surface under the feet that closes on the craft
    // as altitude falls. The vehicle owns it because only the vehicle knows where its feet are.
    const altKm = Number(frame.state && frame.state.altitude);
    if (pose.shadow && Number.isFinite(altKm) && altKm < 2) {
      const u = clamp(altKm / 2, 0, 1);
      const foot = legGeometry(legP, 1);
      const groundY = HIP_Y + foot.fy + landerOff + 1.2;
      const away = frame.sun.sx >= 0 ? -1 : 1;
      const d = ellipsePath(away * u * 46, groundY + u * 26, lerp(12.5, 17, u), lerp(3, 4.2, u));
      setAttrs(shadow, { d, opacity: fmt(lerp(0.55, 0.25, u)), display: null });
    } else {
      setAttrs(shadow, { opacity: '0', display: 'none' });
    }

    const plumeOn = ionOp > 0 && cruiseK !== 'gone';
    setAttrs(exhaustHost, { transform: `translate(${fmt(x)} ${fmt(y)})` });
    setAttrs(exhaustScaled, { transform: `scale(${fmt(s)})` });
    if (cruiseK === 'leaving') {
      const p = pose.cruiseModule.p;
      setAttrs(exhaustPose, {
        transform: `rotate(${fmt(bodyRot)}) translate(${fmt(p * 46)} ${fmt(p * 64)}) rotate(${fmt(p * 24)})`,
        opacity: fmt(p < 0.82 ? 1 : (1 - p) / 0.18),
      });
    } else {
      setAttrs(exhaustPose, { transform: `rotate(${fmt(bodyRot)})`, opacity: '1' });
    }
    setAttrs(ionPlume, {
      opacity: fmt(ionOp),
      display: plumeOn ? null : 'none',
    });

    const upperK = sepKind(pose.upperStage);
    if (upperK === 'attached') adopt(upper, upperHost);
    else adopt(upper, sepUpper);
    hide(upper, upperK === 'gone' || !pose.present);
    hide(sepUpper, upperK !== 'leaving');
    if (upperK === 'leaving') {
      const p = pose.upperStage.p;
      setAttrs(sepUpper, {
        transform: `translate(${fmt(p * 8)} ${fmt(p * 48)}) rotate(${fmt(-p * 14)})`,
        opacity: fmt(p < 0.82 ? 1 : (1 - p) / 0.18),
      });
    } else {
      setAttrs(sepUpper, { transform: '', opacity: '1' });
    }

    const fairK = sepKind(pose.fairing);
    hide(sepFairL, fairK !== 'leaving');
    hide(sepFairR, fairK !== 'leaving');
    if (fairK === 'leaving') {
      const p = pose.fairing.p;
      const fade = p < 0.82 ? 1 : (1 - p) / 0.18;
      setAttrs(sepFairL, {
        transform: `translate(${fmt(-p * 36)} ${fmt(-p * 10)}) rotate(${fmt(-20 - p * 48)})`,
        opacity: fmt(fade),
      });
      setAttrs(sepFairR, {
        transform: `translate(${fmt(p * 36)} ${fmt(-p * 10)}) rotate(${fmt(20 + p * 48)})`,
        opacity: fmt(fade),
      });
    }

    hide(lander, !pose.present);
    hide(cruiseHost, cruiseK === 'gone');

    // Plume motes: one looping system anchored at the nozzle exit, re-emitted only when the
    // nozzle moves, and cleared the moment the engine or the nozzle is gone.
    if (plumeOn && liveMotion && cruiseK === 'attached') {
      const exit = localToView(0, NOZZLE_EXIT_Y + 1, x, y, s, bodyRot);
      const pk = `${fmt(exit.x)}|${fmt(exit.y)}|${fmt(s)}|${fmt(bodyRot)}|${fmt(pose.ion.throttle)}`;
      if (pk !== plumeKey) {
        fx.emit('plume-motes', {
          x: exit.x, y: exit.y, angleDeg: bodyRot + 90, scale: s, day: frame.day,
          density: pose.ion.throttle,
        });
        plumeKey = pk;
      }
    } else if (plumeKey) {
      clearFx('plume-motes');
      plumeKey = '';
    }

    if (liveMotion) emitTrails(frame, nowMs, x, y, s, bodyRot, landerOff, legP);

    if (attLive) {
      for (let i = 0; i < nozzles.length; i++) {
        const tick = Math.floor(nowMs * 12 / 1000);
        const rng = seeded(7727 + i * 13 + tick);
        if (rng() <= 0.4) continue;
        const n = nozzles[i].n;
        const pt = localToView(n.x, n.y + landerOff, x, y, s, bodyRot);
        fx.queue({
          kind: 'cone',
          x: pt.x,
          y: pt.y,
          // The SVG cone points along the nozzle's local -y; on the canvas that heading is rot − 90°.
          angleDeg: n.rot + bodyRot - 90,
          length: 8 * s,
          apexDeg: 28,
          color: PALETTE['plume-kick'],
          alpha: 0.7,
          front: true,
        });
      }
    }

    lastNodeCount = hulls.length;
  }

  function destroy() {
    clearFx('plume-motes');
    for (const node of owned) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    owned.length = 0;
    hulls.length = 0;
    lastKey = '';
  }

  return {
    update,
    destroy,
    look,
    hullCount: () => hulls.length,
    lastNodeCount: () => lastNodeCount,
  };
}
