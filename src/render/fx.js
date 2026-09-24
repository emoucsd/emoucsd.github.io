// Canvas FX layer: the star field, queued flashes/cones/lines, and live particle systems.
// SVG draws structure; this canvas sits behind it and draws the volume that would choke the
// DOM (system spec §6.1, §6.3.8, §6.8.1 #1, §6.8.2 #19). Coordinates are viewBox units, mapped
// with sliceTransform so particles sit on the SVG they belong to.

import { clamp, lerp, seeded, hexToRgb, RAD } from './util.js';
import { PALETTE } from './palette.js';
import { sliceTransform, viewToClient } from './project.js';
import { VIEW } from './scale.js';

export const STAR_COUNT = 400;
export const STAR_SEED = 20260831; // launch civil date, stated
export const REGOLITH_SEED = 3474; // lunar diameter in km, stated
export const REGOLITH_SIZE = 128;
export const MOTE_CAP = 40;
export const TAU = Math.PI * 2;

export const KIND_ASCENT = 'ascent';
export const KIND_SEPARATION = 'separation';
export const KIND_DUST = 'surface-dust';
export const KIND_PLUME = 'plume-motes';

const CAPPED = new Set([KIND_SEPARATION, KIND_PLUME]);
const PALETTE_HEX = new Set(Object.values(PALETTE).map((h) => h.toUpperCase()));

// Cumulative temperature mix: more G/K than M or B, leftover is dim.
const STAR_TEMPS = [
  [0.08, 'star-k3000'],
  [0.30, 'star-k4500'],
  [0.62, 'star-k5800'],
  [0.84, 'star-k8000'],
  [0.94, 'star-k12000'],
  [1.00, 'star-dim'],
];

const SEED_FOR = {
  [KIND_ASCENT]: 1001,
  [KIND_SEPARATION]: 1002,
  [KIND_DUST]: 1003,
  [KIND_PLUME]: 1004,
};

export function pointSourceRadius(mag) {
  return clamp(1.6 * 10 ** (-0.15 * (mag - 1)), 0.6, 7);
}

export function resolveColor(c, fallback = PALETTE.bone) {
  if (typeof c !== 'string') return fallback;
  if (PALETTE[c]) return PALETTE[c];
  const up = c.toUpperCase();
  return PALETTE_HEX.has(up) ? up : fallback;
}

export function cssRgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

export function mapViewToDevice(x, y, clientW, clientH, dpr) {
  const T = sliceTransform(clientW, clientH);
  const p = viewToClient(x, y, T);
  return { x: p.x * dpr, y: p.y * dpr, scale: T.scale * dpr };
}

export function generateStars(seed = STAR_SEED, count = STAR_COUNT) {
  const rand = seeded(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    const x = rand() * VIEW.w;
    const y = rand() * VIEW.h;
    // Exponent < 1 weights the field toward faint (higher) magnitudes.
    const mag = 1.3 + 5.4 * rand() ** 0.42;
    const r = pointSourceRadius(mag);
    const u = rand();
    let token = 'star-dim';
    for (const [p, name] of STAR_TEMPS) {
      if (u <= p) {
        token = name;
        break;
      }
    }
    if (mag > 5.6) token = 'star-dim';
    stars.push({
      x,
      y,
      mag,
      r,
      color: PALETTE[token],
      token,
      halo: mag < 4,
      alpha: clamp(1.12 - 0.09 * mag, 0.52, 1),
    });
  }
  return stars;
}

export function discCovers(disc, x, y) {
  if (!disc || !disc.visible) return false;
  const dx = x - disc.cx;
  const dy = y - disc.cy;
  return dx * dx + dy * dy <= disc.r * disc.r;
}

// Ground in descent is the Moon disc with ground=true; the same circle test hides stars
// over terrain as over a floating body.
export function starHidden(x, y, frame) {
  if (!frame) return false;
  return discCovers(frame.earth, x, y) || discCovers(frame.moon, x, y);
}

export function moteCountFor(kind, density = 0.5) {
  const d = clamp(density, 0, 1);
  if (kind === KIND_ASCENT) return Math.round(lerp(40, 120, d));
  if (kind === KIND_SEPARATION) return 20;
  if (kind === KIND_DUST) return Math.round(lerp(60, 140, d));
  if (kind === KIND_PLUME) return 12;
  return 0;
}

export function generateRegolithDots(seed = REGOLITH_SEED, size = REGOLITH_SIZE) {
  const rand = seeded(seed);
  const dots = [];
  for (let i = 0; i < 1600; i++) {
    dots.push({
      x: (rand() * size) | 0,
      y: (rand() * size) | 0,
      white: rand() < 0.5,
    });
  }
  return dots;
}

export function moteState(mote, nowMs) {
  if (!mote) return null;
  let age = (nowMs - mote.birthMs) / 1000;
  if (mote.loop && mote.life > 0) {
    if (nowMs < mote.birthMs && age > -mote.life) age = ((age % mote.life) + mote.life) % mote.life;
    else if (age < 0) return null;
    else age = ((age % mote.life) + mote.life) % mote.life;
  } else if (age < 0 || age >= mote.life) {
    return null;
  }
  const u = mote.life > 0 ? clamp(age / mote.life, 0, 1) : 1;
  let x;
  let y;
  if (mote.cone) {
    const ang = mote.angle0 + mote.spread * age;
    const dist = mote.speed * age;
    x = mote.x0 + Math.cos(ang) * dist;
    y = mote.y0 + Math.sin(ang) * dist;
  } else {
    x = mote.x0 + mote.vx * age + 0.5 * mote.ax * age * age;
    y = mote.y0 + mote.vy * age + 0.5 * mote.ay * age * age;
  }
  return {
    x,
    y,
    r: lerp(mote.r0, mote.r1, u),
    color: mote.color,
    alpha: (1 - u) * mote.alpha0,
    additive: mote.additive,
    kind: mote.kind,
  };
}

export function spawnSystem(kind, params = {}) {
  const density = clamp(params.density == null ? 0.5 : params.density, 0, 1);
  const n = moteCountFor(kind, density);
  const seed = params.seed == null ? SEED_FOR[kind] || 1000 : params.seed >>> 0;
  const rand = seeded(seed);
  const x0 = params.x == null ? VIEW.w * 0.5 : params.x;
  const y0 = params.y == null ? VIEW.h * 0.5 : params.y;
  const birth0 = params.birthMs == null ? 0 : params.birthMs;
  const tint = params.color ? resolveColor(params.color, null) : null;
  const motes = [];

  if (kind === KIND_ASCENT) {
    const base = (params.angleDeg == null ? -90 : params.angleDeg) * RAD;
    for (let i = 0; i < n; i++) {
      const off = rand() * 2 - 1;
      const half0 = (3 + rand() * 5) * RAD;
      motes.push({
        kind,
        cone: true,
        x0,
        y0,
        angle0: base + off * half0,
        spread: off * (6 + rand() * 8) * RAD,
        speed: 48 + rand() * 95,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        birthMs: birth0 + rand() * 1600,
        life: 2.8 + rand() * 2.4,
        r0: 1.7 + rand() * 1.5,
        r1: 2.8 + rand() * 1.8,
        color: tint || PALETTE['earth-cloud'],
        alpha0: 0.55 + rand() * 0.4,
        additive: false,
        loop: false,
      });
    }
  } else if (kind === KIND_SEPARATION) {
    const base = (params.angleDeg == null ? 0 : params.angleDeg) * RAD;
    for (let i = 0; i < n; i++) {
      const ang = base + (rand() - 0.5) * Math.PI;
      const spd = 30 + rand() * 80;
      motes.push({
        kind,
        cone: false,
        x0,
        y0,
        angle0: ang,
        spread: 0,
        speed: spd,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        ax: 0,
        ay: 0,
        birthMs: birth0 + rand() * 80,
        life: 0.55 + rand() * 0.85,
        r0: 1.6 + rand() * 1.3,
        r1: 0.6 + rand() * 0.5,
        color: tint || PALETTE.radiator,
        alpha0: 0.7 + rand() * 0.25,
        additive: false,
        loop: false,
      });
    }
  } else if (kind === KIND_DUST) {
    for (let i = 0; i < n; i++) {
      const heading = rand() * TAU;
      const vRad = 40 + rand() * 110;
      const vUp = 12 + rand() * 28;
      // Hang time 4.2–7.7 s so 2 s is a sheet, 5 s is settling, 9 s is empty.
      const tLand = 4.2 + rand() * 3.5;
      const ay = (2 * vUp) / tLand;
      motes.push({
        kind,
        cone: false,
        x0: x0 + (rand() - 0.5) * 22,
        y0: y0 + (rand() - 0.5) * 10,
        angle0: heading,
        spread: 0,
        speed: vRad,
        vx: Math.cos(heading) * vRad,
        vy: -vUp,
        ax: 0,
        ay,
        birthMs: birth0,
        life: Math.min(tLand, 7.9),
        r0: 2.0 + rand() * 1.8,
        r1: 0.8 + rand() * 0.6,
        color: tint || PALETTE['moon-highland-dim'],
        alpha0: 0.72 + rand() * 0.22,
        additive: false,
        loop: false,
      });
    }
  } else if (kind === KIND_PLUME) {
    const base = (params.angleDeg == null ? 90 : params.angleDeg) * RAD;
    const loop = params.loop !== false;
    // The emitter passes its drawing scale so motes stay inside the plume cone at any ship size.
    const k = params.scale == null ? 1 : clamp(params.scale, 0.2, 4);
    for (let i = 0; i < n; i++) {
      const ang = base + (rand() - 0.5) * 9 * RAD;
      const spd = (36 + rand() * 48) * k;
      const life = 0.4 + rand() * 0.5;
      const core = rand() < 0.45;
      motes.push({
        kind,
        cone: false,
        x0,
        y0,
        angle0: ang,
        spread: 0,
        speed: spd,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        ax: 0,
        ay: 0,
        birthMs: loop ? birth0 - rand() * life * 1000 : birth0 + rand() * 80,
        life,
        r0: (1.4 + rand() * 1.0) * k,
        r1: (0.4 + rand() * 0.3) * k,
        color: tint || (core ? PALETTE['plume-core'] : PALETTE.plume),
        alpha0: 0.45 + rand() * 0.3,
        additive: true,
        loop,
      });
    }
  }

  return { kind, capped: CAPPED.has(kind), motes };
}

export function countLive(systems, nowMs) {
  let n = 0;
  for (const sys of systems) {
    for (const m of sys.motes) if (moteState(m, nowMs)) n++;
  }
  return n;
}

export function countCappedLive(systems, nowMs) {
  let n = 0;
  for (const sys of systems) {
    if (!CAPPED.has(sys.kind)) continue;
    for (const m of sys.motes) if (moteState(m, nowMs)) n++;
  }
  return n;
}

export function applyMoteCap(systems, incoming, nowMs) {
  if (!incoming || !CAPPED.has(incoming.kind)) return incoming;
  const live = countCappedLive(systems, nowMs);
  const room = Math.max(0, MOTE_CAP - live);
  if (incoming.motes.length <= room) return incoming;
  const keep = [];
  for (const m of incoming.motes) {
    if (keep.length >= room) break;
    if (moteState(m, nowMs) || m.loop) keep.push(m);
  }
  return { ...incoming, motes: keep };
}

function get2d(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  return canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
}

function makeTile(ctx) {
  const size = REGOLITH_SIZE;
  let off = null;
  if (typeof OffscreenCanvas === 'function') off = new OffscreenCanvas(size, size);
  else if (typeof document !== 'undefined' && document.createElement) {
    off = document.createElement('canvas');
    off.width = size;
    off.height = size;
  }
  if (!off || !ctx) return null;
  const tctx = off.getContext('2d');
  if (!tctx) return null;
  tctx.clearRect(0, 0, size, size);
  for (const d of generateRegolithDots()) {
    tctx.fillStyle = d.white ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
    tctx.fillRect(d.x, d.y, 1, 1);
  }
  const pattern = ctx.createPattern(off, 'repeat');
  return { off, pattern };
}

function drawStars(ctx, projected, frame) {
  ctx.globalCompositeOperation = 'lighter';
  for (const s of projected) {
    if (starHidden(s.x, s.y, frame)) continue;
    if (s.halo) {
      ctx.fillStyle = cssRgba(s.color, 0.22);
      ctx.beginPath();
      ctx.arc(s.sx, s.sy, s.sr * 3, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = cssRgba(s.color, s.alpha);
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, Math.max(s.sr, 0.45), 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawQueued(ctx, items, T) {
  for (const item of items) {
    if (!item || !item.kind) continue;
    const color = resolveColor(item.color);
    const alpha = item.alpha == null ? 1 : item.alpha;
    if (item.kind === 'point') {
      const p = viewToClient(item.x, item.y, T);
      const r = (item.r || 1) * T.scale;
      if (item.additive) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = cssRgba(color, 0.22 * alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = cssRgba(color, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
      if (item.additive) ctx.globalCompositeOperation = 'source-over';
    } else if (item.kind === 'cone') {
      const p = viewToClient(item.x, item.y, T);
      const len = item.length * T.scale;
      const ang = item.angleDeg * RAD;
      const half = ((item.apexDeg || 0) * RAD) / 2;
      ctx.fillStyle = cssRgba(color, alpha);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(ang - half) * len, p.y + Math.sin(ang - half) * len);
      ctx.lineTo(p.x + Math.cos(ang + half) * len, p.y + Math.sin(ang + half) * len);
      ctx.closePath();
      ctx.fill();
    } else if (item.kind === 'line') {
      const a = viewToClient(item.x0, item.y0, T);
      const b = viewToClient(item.x1, item.y1, T);
      ctx.strokeStyle = cssRgba(color, alpha);
      ctx.lineWidth = Math.max(0.5, (item.width || 1) * T.scale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

function drawMotes(ctx, systems, nowMs, T) {
  for (const sys of systems) {
    for (const m of sys.motes) {
      const s = moteState(m, nowMs);
      if (!s || s.alpha <= 0.01) continue;
      const p = viewToClient(s.x, s.y, T);
      const r = Math.max(s.r * T.scale, 0.4);
      ctx.globalCompositeOperation = s.additive ? 'lighter' : 'source-over';
      ctx.fillStyle = cssRgba(s.color, s.alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// frontCanvas, when given, sits above the SVG scene and carries the vehicle's particles: exhaust
// rising off a limb, cold gas at a separation, dust on the ground and the plume. Drawn on the back
// canvas those were painted over by the very Earth disc or ground they belong to. Stars and the
// content vocabulary's queued items stay behind the scene, which is where §6.1 puts them.
export function createFx(canvas, frontCanvas = null) {
  const stars = generateStars();
  let ctx = get2d(canvas);
  let fctx = frontCanvas && typeof frontCanvas.getContext === 'function' ? frontCanvas.getContext('2d') : null;
  let clientW = 0;
  let clientH = 0;
  let dpr = 1;
  let T = sliceTransform(1, 1);
  let projected = [];
  let queue = [];
  let systems = [];
  let alive = true;
  let pattern = null;
  let patternKey = '';
  let tile = null;

  function project() {
    projected = stars.map((s) => ({
      ...s,
      sx: T.dx + s.x * T.scale,
      sy: T.dy + s.y * T.scale,
      sr: s.r * T.scale,
    }));
  }

  return {
    resize(w, h, devicePixelRatio) {
      if (!alive) return;
      clientW = w;
      clientH = h;
      dpr = devicePixelRatio || 1;
      T = sliceTransform(clientW, clientH);
      if (canvas) {
        canvas.width = Math.max(1, Math.round(clientW * dpr));
        canvas.height = Math.max(1, Math.round(clientH * dpr));
        if (canvas.style) {
          canvas.style.width = `${clientW}px`;
          canvas.style.height = `${clientH}px`;
        }
        ctx = get2d(canvas);
      }
      if (frontCanvas) {
        frontCanvas.width = Math.max(1, Math.round(clientW * dpr));
        frontCanvas.height = Math.max(1, Math.round(clientH * dpr));
        if (frontCanvas.style) {
          frontCanvas.style.width = `${clientW}px`;
          frontCanvas.style.height = `${clientH}px`;
        }
        fctx = typeof frontCanvas.getContext === 'function' ? frontCanvas.getContext('2d') : null;
      }
      project();
      pattern = null;
      tile = null;
      patternKey = '';
    },

    queue(item) {
      if (!alive || !item) return;
      queue.push(item);
    },

    emit(kind, params = {}) {
      if (!alive) return;
      if (kind !== KIND_ASCENT && kind !== KIND_SEPARATION && kind !== KIND_DUST && kind !== KIND_PLUME) return;
      systems = systems.filter((s) => s.kind !== kind);
      const now = params.nowMs == null ? (params.birthMs == null ? 0 : params.birthMs) : params.nowMs;
      systems.push(applyMoteCap(systems, spawnSystem(kind, params), now));
    },

    clear(kind) {
      if (!alive) return;
      systems = kind == null ? [] : systems.filter((s) => s.kind !== kind);
    },

    draw(frame, nowMs) {
      if (!alive || !ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = PALETTE.void;
      ctx.fillRect(0, 0, clientW, clientH);
      drawStars(ctx, projected, frame);
      const front = fctx ? queue.filter((q) => q && q.front) : [];
      drawQueued(ctx, fctx ? queue.filter((q) => !q || !q.front) : queue, T);
      queue = [];
      const moving = frame && frame.live && !frame.reducedMotion;
      if (fctx) {
        fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        fctx.globalCompositeOperation = 'source-over';
        fctx.clearRect(0, 0, clientW, clientH);
        drawQueued(fctx, front, T);
        if (moving) drawMotes(fctx, systems, nowMs, T);
      } else if (moving) {
        drawMotes(ctx, systems, nowMs, T);
      }
    },

    regolithPattern() {
      if (!alive || !ctx) return null;
      const key = `${clientW}x${clientH}x${dpr}`;
      if (pattern && patternKey === key) return pattern;
      const built = makeTile(ctx);
      if (!built) return null;
      tile = built.off;
      pattern = built.pattern;
      patternKey = key;
      return pattern;
    },

    destroy() {
      alive = false;
      queue = [];
      systems = [];
      projected = [];
      pattern = null;
      tile = null;
      ctx = null;
      fctx = null;
      for (const c of [canvas, frontCanvas]) {
        if (!c) continue;
        c.width = 0;
        c.height = 0;
      }
    },
  };
}
