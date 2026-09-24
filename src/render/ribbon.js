// Trajectory ribbon: the orrery and the day ruler beneath the hero view (system spec §7.2).
//
// The orrery is Earth-centred inertial, viewed from ecliptic north. In this file that means:
//   origin at Earth, +x to the right, +y up in inertial space, SVG y flipped so polar angle
//   increases counter-clockwise from +x. The Moon sits at polar angle = moonLongitude (deg)
//   on the log-radius circle u(MOON_DIST). The plan envelope is an Archimedean spiral in
//   log-radius: polar angle advances with logU(envelopeKm(t)) through ENVELOPE_TURNS turns
//   so the growth of the orbit is the whole drawing rather than seventy-odd revolutions.
//   Argument of periapsis of the current revolution is chosen so that apogee lands on the
//   envelope. Sizes and angles are aesthetic; the log axis and the envelope-not-scribble
//   rule are the honest parts.
//
// The ruler is the only scrub control. Future days are absence. Nothing on the ribbon fills.

import { apogee, moonCentreRange, state, MOON_DIST, T_CAPTURE } from '../physics.js';
import { PALETTE } from './palette.js';
import { clamp, fmt, el, setAttrs } from './util.js';

export const ORRERY_SIZE = 92;
export const RULER_DAYS = 365;
export const ENVELOPE_TURNS = 1.25;

const LOG_R0 = Math.log(6500);
const LOG_R1 = Math.log(410000);
const LOG_DEN = LOG_R1 - LOG_R0;
const EARTH_R = 2.5;       // 5px disc
const MOON_R = 1.25;       // 2.5px disc
const CRAFT_GAP = 1.5;     // 3px gap in the stroke
const MISSION_END = 365;

const KIND = {
  ordinary: { h: 7, w: 1, color: PALETTE['bone-faint'], token: 'bone-faint' },
  act: { h: 13, w: 1, color: PALETTE['bone-dim'], token: 'bone-dim' },
  event: { h: 9, w: 2, color: PALETTE['bone-mid'], token: 'bone-mid' },
  investigation: { h: 9, w: 2, color: PALETTE.alert, token: 'alert' },
  today: { h: 19, w: 1, color: PALETTE.sunlight, token: 'sunlight' },
};

const PLAN_T = (() => {
  const ts = [];
  const n = 280;
  for (let i = 0; i <= n; i++) ts.push((i * MISSION_END) / n);
  for (const extra of [0, 7, T_CAPTURE, MISSION_END]) {
    if (!ts.some((x) => Math.abs(x - extra) < 1e-9)) ts.push(extra);
  }
  ts.sort((a, b) => a - b);
  return ts;
})();

const CSS = `
.mc-ribbon {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  width: 100%;
  background: var(--void, #000000);
  border-top: 1px solid var(--bone-faint, #33312D);
  color: var(--bone-mid, #8E8A81);
  font-family: var(--font-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  font-variant-numeric: tabular-nums;
  user-select: none;
  box-sizing: border-box;
  overflow: hidden;
}
.mc-ribbon * { transition: none; }
.mc-ribbon-orrery {
  flex: 0 0 92px;
  width: 92px;
  height: 100%;
  display: block;
  pointer-events: none;
}
.mc-ribbon[data-orrery="off"] .mc-ribbon-orrery { display: none; }
.mc-ribbon-ruler {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: block;
  outline: none;
  cursor: ew-resize;
  touch-action: none;
}
.mc-ribbon-ruler:focus-visible {
  outline: 2px solid var(--sunlight, #FFE9C4);
  outline-offset: 2px;
}
.mc-ribbon-steps {
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  height: 100%;
  border-right: 1px solid var(--bone-faint, #33312D);
}
.mc-ribbon-step {
  flex: 0 0 auto;
  min-width: 36px;
  min-height: 44px;
  height: 100%;
  margin: 0;
  padding: 0 6px;
  background: none;
  border: 0;
  border-radius: 0;
  color: var(--bone-mid, #8E8A81);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  text-transform: lowercase;
  cursor: pointer;
  touch-action: manipulation;
}
.mc-ribbon-step[data-step="today"] { min-width: 52px; }
.mc-ribbon-step:hover { color: var(--bone, #C8C3B8); }
/* Inside the edge: the ribbon clips its overflow, so an outward ring would be cut. */
.mc-ribbon-step:focus-visible {
  outline: 2px solid var(--sunlight, #FFE9C4);
  outline-offset: -2px;
}
.mc-ribbon-step[disabled] {
  color: var(--bone-dim, #6E6A63);
  cursor: default;
}
/* Phones: the cluster gives up padding before the ruler gives up length. */
@media (max-width: 599px) {
  .mc-ribbon-step { min-width: 30px; padding: 0 2px; }
  .mc-ribbon-step[data-step="today"] { min-width: 44px; }
}
`.trim();

let styleRefs = 0;

function ensureStyle() {
  let node = document.getElementById('mc-ribbon-style');
  if (!node) {
    node = document.createElement('style');
    node.id = 'mc-ribbon-style';
    node.textContent = CSS;
    document.head.appendChild(node);
  }
  styleRefs += 1;
}

function releaseStyle() {
  styleRefs = Math.max(0, styleRefs - 1);
  if (styleRefs === 0) {
    const node = document.getElementById('mc-ribbon-style');
    if (node) node.remove();
  }
}

export function logU(r) {
  return (Math.log(Math.max(r, 6500)) - LOG_R0) / LOG_DEN;
}

// Apogee during the spiral; Earth-range of the Moon-centred orbit after capture. Monotonic.
export function envelopeKm(t) {
  const c = clamp(t, 0, MISSION_END);
  return c <= T_CAPTURE ? apogee(c) : MOON_DIST - moonCentreRange(c);
}

export function envelopeTheta(t) {
  const u = logU(envelopeKm(t));
  const u0 = logU(envelopeKm(0));
  const u1 = logU(envelopeKm(MISSION_END));
  return ENVELOPE_TURNS * 2 * Math.PI * (u - u0) / (u1 - u0);
}

function orreryLayout(sizePx) {
  const cx = sizePx / 2;
  const cy = sizePx / 2;
  const scale = sizePx / 2 - 7;
  return { cx, cy, scale };
}

function toXY(u, theta, sizePx) {
  const { cx, cy, scale } = orreryLayout(sizePx);
  return {
    x: cx + scale * u * Math.cos(theta),
    y: cy - scale * u * Math.sin(theta),
  };
}

function polyD(pts) {
  if (!pts.length) return '';
  let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += `L${fmt(pts[i].x)} ${fmt(pts[i].y)}`;
  return d;
}

function envelopePoint(t, sizePx) {
  const theta = envelopeTheta(t);
  const u = logU(envelopeKm(t));
  const p = toXY(u, theta, sizePx);
  return { t, u, theta, x: p.x, y: p.y };
}

let planMemo = { size: null, points: [], d: '' };

function planFor(sizePx) {
  if (planMemo.size !== sizePx) {
    const points = PLAN_T.map((t) => envelopePoint(t, sizePx));
    planMemo = { size: sizePx, points, d: polyD(points) };
  }
  return planMemo;
}

function revolutionD(t, sizePx) {
  const s = state(t);
  if (!s.orbit || s.orbit.body !== 'Earth') return '';
  const a = s.orbit.semiMajorAxis;
  const e = s.orbit.eccentricity;
  const omega = envelopeTheta(t) - Math.PI;
  const n = 96;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const nu = (i / n) * 2 * Math.PI;
    const r = a * (1 - e * e) / (1 + e * Math.cos(nu));
    pts.push(toXY(logU(r), omega + nu, sizePx));
  }
  return polyD(pts);
}

function craftPoint(t, sizePx) {
  const s = state(t);
  if (s.orbit && s.orbit.body === 'Earth') {
    const omega = envelopeTheta(t) - Math.PI;
    const nu = s.orbit.trueAnomaly * Math.PI / 180;
    return toXY(logU(s.rangeFromEarth), omega + nu, sizePx);
  }
  const theta = (s.moonLongitude * Math.PI) / 180;
  return toXY(logU(s.rangeFromEarth), theta, sizePx);
}

export function orreryPath(t, sizePx) {
  const size = sizePx > 0 ? sizePx : ORRERY_SIZE;
  const { cx, cy } = orreryLayout(size);
  const plan = planFor(size);
  const tt = clamp(t, 0, MISSION_END);
  const flownPts = [];
  for (const p of plan.points) {
    if (p.t <= tt) flownPts.push(p);
    else break;
  }
  if (!flownPts.length || flownPts[flownPts.length - 1].t < tt) {
    flownPts.push(envelopePoint(tt, size));
  }
  const s = state(tt);
  const moonTheta = (s.moonLongitude * Math.PI) / 180;
  const moon = toXY(logU(MOON_DIST), moonTheta, size);
  return {
    plan: plan.d,
    flown: flownPts.length >= 2 ? polyD(flownPts) : '',
    revolution: revolutionD(tt, size),
    craft: craftPoint(tt, size),
    moon,
    earth: { x: cx, y: cy },
  };
}

function tickKind(i, today, rec, actSet) {
  if (i === today) return 'today';
  if (rec && rec.openInvestigation) return 'investigation';
  // Act height is the structural mark; an event on an act day still reads as a boundary.
  if (actSet.has(i)) return 'act';
  if (rec && rec.event) return 'event';
  return 'ordinary';
}

export function rulerTicks(today, days, widthPx, act = []) {
  const last = clamp(Math.floor(Number(today)), 0, MISSION_END);
  const todayOn = Number.isFinite(today) && today >= 0 && today <= MISSION_END
    ? Math.floor(today)
    : -1;
  const actSet = new Set((act || []).map((n) => Math.floor(n)));
  const list = days || [];
  const w = widthPx > 0 ? widthPx : 1;
  const ticks = [];
  for (let i = 0; i <= last; i++) {
    const kind = tickKind(i, todayOn, list[i], actSet);
    const spec = KIND[kind];
    ticks.push({
      day: i,
      x: (i / RULER_DAYS) * w,
      h: spec.h,
      w: spec.w,
      color: spec.color,
      kind,
      token: spec.token,
    });
  }
  return ticks;
}

export function filterTicksForWidth(ticks, widthPx) {
  if (widthPx >= 800) return ticks;
  if (widthPx >= 600) {
    return ticks.filter((t) => t.kind !== 'ordinary');
  }
  const events = ticks.filter((t) => t.kind === 'event' || t.kind === 'investigation');
  const showEvents = events.length <= 12;
  return ticks.filter((t) => (
    t.kind === 'today'
    || t.kind === 'act'
    || (showEvents && (t.kind === 'event' || t.kind === 'investigation'))
  ));
}

export function scrubDay(pointerX, widthPx, today) {
  const wall = clamp(Math.floor(Number(today)), 0, MISSION_END);
  if (!(widthPx > 0)) return clamp(0, 0, wall);
  const day = Math.round((pointerX / widthPx) * RULER_DAYS);
  return clamp(day, 0, wall);
}

const BACK = new Set(['j', 'J', 'ArrowLeft']);
const FWD = new Set(['k', 'K', 'ArrowRight']);

export function keyStep(key, current, today, shift = false) {
  const wall = clamp(Math.floor(Number(today)), 0, MISSION_END);
  const here = clamp(Math.floor(Number(current)), 0, wall);
  if (key === 'Home') return 0;
  if (key === 'End') return wall;
  const step = shift ? 10 : 1;
  if (BACK.has(key)) return clamp(here - step, 0, wall);
  if (FWD.has(key)) return clamp(here + step, 0, wall);
  return here;
}

// On-screen day steps (owner, 2026-09-14), for readers catching up without a keyboard. A week
// is the unit a missed stretch is counted in, so the big step is seven rather than the keyboard's
// ten. `today` carries no delta: it returns the page to the live clock (see createRibbon).
export const STEP_DAYS = 7;

export const STEP_CONTROLS = Object.freeze([
  Object.freeze({ id: 'back-week', delta: -STEP_DAYS, label: '−7', title: 'back seven days' }),
  Object.freeze({ id: 'back-day', delta: -1, label: '−1', title: 'back one day' }),
  Object.freeze({ id: 'forward-day', delta: 1, label: '+1', title: 'forward one day' }),
  Object.freeze({ id: 'forward-week', delta: STEP_DAYS, label: '+7', title: 'forward seven days' }),
  Object.freeze({ id: 'today', delta: null, label: 'today', title: 'return to today' }),
]);

export function stepDay(delta, current, today) {
  const wall = clamp(Math.floor(Number(today)), 0, MISSION_END);
  const here = clamp(Math.floor(Number(current)), 0, wall);
  // The today control carries no delta. Tested first: Number(null) is 0, not NaN, so a
  // finiteness check alone would quietly turn it into a step of nothing.
  if (delta == null) return wall;
  const d = Number(delta);
  if (!Number.isFinite(d)) return wall;
  return clamp(here + Math.trunc(d), 0, wall);
}

// A control that cannot move is inert, not hidden: the cluster keeps its shape all year.
export function stepDisabled(delta, current, today) {
  const wall = clamp(Math.floor(Number(today)), 0, MISSION_END);
  const here = clamp(Math.floor(Number(current)), 0, wall);
  return stepDay(delta, current, today) === here;
}

export function ribbonLayout(widthPx, viewportH = 900) {
  let height = 92;
  if (widthPx < 600) height = 56;
  else if (widthPx < 800) height = 64;
  if (viewportH < 480) height = Math.min(height, 48);
  else if (viewportH < 640) height = Math.min(height, 64);
  const orrery = widthPx >= 1100 && height >= 92;
  return { height, orrery, orreryPx: orrery ? ORRERY_SIZE : 0 };
}

function daysSig(days, today) {
  const n = clamp(Math.floor(Number(today)), 0, MISSION_END);
  const list = days || [];
  let s = '';
  for (let i = 0; i <= n; i++) {
    const d = list[i];
    s += d?.openInvestigation ? '2' : d?.event ? '1' : '0';
  }
  return s;
}

export function createRibbon(container, { onScrub, onLive } = {}) {
  ensureStyle();
  container.classList.add('mc-ribbon');

  const orrery = el('svg', {
    class: 'mc-ribbon-orrery',
    viewBox: `0 0 ${ORRERY_SIZE} ${ORRERY_SIZE}`,
    width: String(ORRERY_SIZE),
    height: String(ORRERY_SIZE),
    'aria-hidden': 'true',
  });
  const moonOrbit = el('circle', {
    fill: 'none',
    stroke: 'var(--bone-faint)',
    'stroke-width': '1',
  }, orrery);
  const planPath = el('path', {
    fill: 'none',
    stroke: 'var(--bone-faint)',
    'stroke-width': '1',
    opacity: '0.18',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  }, orrery);
  const revPath = el('path', {
    fill: 'none',
    stroke: 'var(--bone-dim)',
    'stroke-width': '1',
    opacity: '0.55',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  }, orrery);
  const flownPath = el('path', {
    fill: 'none',
    stroke: 'var(--sunlight)',
    'stroke-width': '1.25',
    opacity: '0.55',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  }, orrery);
  const gap = el('circle', {
    r: fmt(CRAFT_GAP),
    fill: 'var(--void)',
  }, orrery);
  const earth = el('circle', {
    r: fmt(EARTH_R),
    fill: 'var(--earth-ocean-mid)',
  }, orrery);
  const moon = el('circle', {
    r: fmt(MOON_R),
    fill: 'var(--moon-highland)',
  }, orrery);
  const labelE = el('text', {
    fill: 'var(--bone-mid)',
    'font-size': '8',
    'font-family': 'var(--font-mono, ui-monospace, monospace)',
    'font-variant-numeric': 'tabular-nums',
    'text-anchor': 'start',
    'dominant-baseline': 'hanging',
  }, orrery);
  labelE.textContent = 'E';
  const labelM = el('text', {
    fill: 'var(--bone-mid)',
    'font-size': '8',
    'font-family': 'var(--font-mono, ui-monospace, monospace)',
    'font-variant-numeric': 'tabular-nums',
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
  }, orrery);
  labelM.textContent = 'M';

  const ruler = el('svg', {
    class: 'mc-ribbon-ruler',
    role: 'slider',
    tabindex: '0',
    'aria-orientation': 'horizontal',
    'aria-label': 'mission day',
    'aria-valuemin': '0',
    'aria-valuemax': '0',
    'aria-valuenow': '0',
    'aria-valuetext': 'day 000',
  });
  const baseline = el('line', {
    stroke: 'var(--bone-faint)',
    'stroke-width': '1',
    'shape-rendering': 'crispEdges',
  }, ruler);
  const tickNodes = [];
  for (let i = 0; i <= MISSION_END; i++) {
    tickNodes.push(el('line', {
      'data-day': String(i),
      visibility: 'hidden',
      'shape-rendering': 'crispEdges',
      'stroke-linecap': 'butt',
    }, ruler));
  }

  // The step cluster sits between the orrery and the ruler at every width: the ribbon's right
  // edge belongs to the `…` settings control (§6.7), and one position all year means a daily
  // reader never hunts for it.
  const steps = document.createElement('div');
  steps.className = 'mc-ribbon-steps';
  steps.setAttribute('role', 'group');
  steps.setAttribute('aria-label', 'step days');
  const stepNodes = STEP_CONTROLS.map((spec) => {
    const node = document.createElement('button');
    node.className = 'mc-ribbon-step';
    node.setAttribute('type', 'button');
    node.setAttribute('data-step', spec.id);
    node.setAttribute('aria-label', spec.title);
    node.textContent = spec.label;
    const onClick = () => activate(spec);
    node.addEventListener('click', onClick);
    steps.appendChild(node);
    return { spec, node, onClick };
  });

  container.appendChild(orrery);
  container.appendChild(steps);
  container.appendChild(ruler);

  let lastToday = 0;
  let lastDay = 0;
  let lastFrame = null;
  let lastOpts = { today: 0, days: [], act: [] };
  let lastBox = '';
  let dragging = false;
  let destroyed = false;
  let lastOrreryKey = '';
  let lastTickKey = '';
  let lastLayoutKey = '';
  let lastStepKey = '';
  let reentering = false;

  let lastEmitted = null;
  function emit(day) {
    const wall = clamp(Math.floor(Number(lastToday)), 0, MISSION_END);
    const d = clamp(Math.floor(day), 0, wall);
    if (d === lastEmitted) return;
    lastEmitted = d;
    if (typeof onScrub === 'function') onScrub(d);
  }

  function pointerDay(e) {
    const rect = ruler.getBoundingClientRect();
    return scrubDay(e.clientX - rect.left, rect.width, lastToday);
  }

  function activate(spec) {
    if (stepDisabled(spec.delta, lastDay, lastToday)) return;
    if (spec.delta == null) {
      // Today resumes the live clock rather than pinning today as a past day. The next step may
      // land back on the day just left, so the repeat guard is cleared with it.
      lastEmitted = null;
      if (typeof onLive === 'function') {
        onLive();
        return;
      }
      emit(lastToday);
      return;
    }
    emit(stepDay(spec.delta, lastDay, lastToday));
  }

  function paintSteps() {
    for (const { spec, node } of stepNodes) {
      if (stepDisabled(spec.delta, lastDay, lastToday)) {
        node.setAttribute('disabled', '');
        node.setAttribute('aria-disabled', 'true');
      } else {
        node.removeAttribute('disabled');
        node.removeAttribute('aria-disabled');
      }
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    dragging = true;
    ruler.focus({ preventScroll: true });
    ruler.setPointerCapture(e.pointerId);
    emit(pointerDay(e));
  }
  function onPointerMove(e) {
    if (!dragging) return;
    emit(pointerDay(e));
  }
  function onPointerUp() {
    dragging = false;
  }
  function onKeyDown(e) {
    if (!BACK.has(e.key) && !FWD.has(e.key) && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    emit(keyStep(e.key, lastDay, lastToday, e.shiftKey));
  }

  ruler.addEventListener('pointerdown', onPointerDown);
  ruler.addEventListener('pointermove', onPointerMove);
  ruler.addEventListener('pointerup', onPointerUp);
  ruler.addEventListener('pointercancel', onPointerUp);
  ruler.addEventListener('keydown', onKeyDown);

  function applyLayout(layout) {
    container.style.height = `${layout.height}px`;
    container.dataset.orrery = layout.orrery ? 'on' : 'off';
    setAttrs(orrery, {
      width: String(ORRERY_SIZE),
      height: String(layout.height),
    });
  }

  function paintOrrery(t) {
    const path = orreryPath(t, ORRERY_SIZE);
    const { cx, cy, scale } = orreryLayout(ORRERY_SIZE);
    const moonOrbitR = scale * logU(MOON_DIST);
    setAttrs(moonOrbit, { cx: fmt(cx), cy: fmt(cy), r: fmt(moonOrbitR) });
    setAttrs(planPath, { d: path.plan || null });
    setAttrs(revPath, { d: path.revolution || null });
    setAttrs(flownPath, { d: path.flown || null });
    setAttrs(gap, { cx: fmt(path.craft.x), cy: fmt(path.craft.y) });
    setAttrs(earth, { cx: fmt(path.earth.x), cy: fmt(path.earth.y) });
    setAttrs(moon, { cx: fmt(path.moon.x), cy: fmt(path.moon.y) });
    setAttrs(labelE, { x: fmt(cx + 5), y: fmt(cy + 4) });
    const mTheta = Math.atan2(-(path.moon.y - cy), path.moon.x - cx) + 0.22;
    const mLab = toXY(logU(MOON_DIST), mTheta, ORRERY_SIZE);
    setAttrs(labelM, {
      x: fmt(clamp(mLab.x, 5, ORRERY_SIZE - 5)),
      y: fmt(clamp(mLab.y, 6, ORRERY_SIZE - 6)),
    });
  }

  function paintTicks(today, days, act, widthPx, heightPx) {
    const raw = rulerTicks(today, days, widthPx, act);
    const shown = filterTicksForWidth(raw, container.clientWidth || widthPx);
    const byDay = new Map(shown.map((t) => [t.day, t]));
    const baseY = heightPx - 8;
    setAttrs(ruler, {
      viewBox: `0 0 ${fmt(widthPx)} ${fmt(heightPx)}`,
      width: '100%',
      height: '100%',
      preserveAspectRatio: 'none',
      'aria-valuemax': String(clamp(Math.floor(today), 0, MISSION_END)),
      'aria-valuenow': String(lastDay),
      'aria-valuetext': `day ${String(lastDay).padStart(3, '0')}`,
    });
    setAttrs(baseline, {
      x1: '0',
      y1: fmt(baseY),
      x2: fmt(widthPx),
      y2: fmt(baseY),
    });
    for (let i = 0; i < tickNodes.length; i++) {
      const tick = byDay.get(i);
      if (!tick) {
        setAttrs(tickNodes[i], { visibility: 'hidden' });
        continue;
      }
      setAttrs(tickNodes[i], {
        visibility: 'visible',
        x1: fmt(tick.x),
        x2: fmt(tick.x),
        y1: fmt(baseY - tick.h),
        y2: fmt(baseY),
        stroke: `var(--${tick.token})`,
        'stroke-width': fmt(tick.w),
        'data-kind': tick.kind,
      });
    }
  }

  function update(frame, { today, days, act } = {}) {
    if (destroyed) return;
    lastFrame = frame;
    lastOpts = { today, days, act };
    lastToday = Number.isFinite(today) ? today : (frame?.day ?? 0);
    lastDay = frame?.day ?? 0;
    const stepKey = `${lastDay}|${lastToday}`;
    if (stepKey !== lastStepKey) {
      paintSteps();
      lastStepKey = stepKey;
    }
    const widthPx = container.clientWidth || 0;
    const viewportH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 900;
    const layout = ribbonLayout(widthPx, viewportH);
    const layoutKey = `${layout.height}|${layout.orrery}|${widthPx}`;
    if (layoutKey !== lastLayoutKey) {
      applyLayout(layout);
      lastLayoutKey = layoutKey;
      lastTickKey = '';
      lastOrreryKey = '';
    }
    const t = frame?.t ?? lastDay;
    const orreryKey = layout.orrery ? `${t}|${ORRERY_SIZE}` : 'off';
    if (orreryKey !== lastOrreryKey) {
      if (layout.orrery) paintOrrery(t);
      lastOrreryKey = orreryKey;
    }
    const rulerW = Math.max(1, widthPx - (layout.orrery ? ORRERY_SIZE : 0));
    const tickKey = `${lastToday}|${daysSig(days, lastToday)}|${(act || []).join(',')}|${rulerW}|${layout.height}|${widthPx}`;
    if (tickKey !== lastTickKey) {
      paintTicks(lastToday, days || [], act || [], rulerW, layout.height);
      lastTickKey = tickKey;
    } else {
      setAttrs(ruler, {
        'aria-valuenow': String(lastDay),
        'aria-valuetext': `day ${String(lastDay).padStart(3, '0')}`,
      });
    }
  }

  const ro = new ResizeObserver(() => {
    if (destroyed || reentering || !lastFrame) return;
    const vw = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 0;
    const box = `${container.clientWidth}x${container.clientHeight}x${vw}`;
    if (box === lastBox) return;
    lastBox = box;
    lastLayoutKey = '';
    lastTickKey = '';
    lastOrreryKey = '';
    reentering = true;
    try { update(lastFrame, lastOpts); } finally { reentering = false; }
  });
  ro.observe(container);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    ro.disconnect();
    ruler.removeEventListener('pointerdown', onPointerDown);
    ruler.removeEventListener('pointermove', onPointerMove);
    ruler.removeEventListener('pointerup', onPointerUp);
    ruler.removeEventListener('pointercancel', onPointerUp);
    ruler.removeEventListener('keydown', onKeyDown);
    for (const { node, onClick } of stepNodes) node.removeEventListener('click', onClick);
    orrery.remove();
    steps.remove();
    ruler.remove();
    container.classList.remove('mc-ribbon');
    container.style.height = '';
    delete container.dataset.orrery;
    releaseStyle();
  }

  return { update, destroy };
}
