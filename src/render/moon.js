// Moon drawing module. One orthographic projection of the §6.5 catalogue at every
// scale: LOD adds features and never swaps assets. Nodes are created when a LOD
// band is first entered and removed when the Moon leaves that band (a scrub back).
// update() mutates attributes inside a band; it does not create nodes per frame.
//
// Craters stay the three-primitive language (floor, sunward rim arc, anti-sun
// shadow) but floors are a slight albedo dip, rims are thin lit arcs, and giant
// basins do not read as opaque discs. Ground mode (descent/monument) is a
// perspective polar landscape, not the same circles laid on a plane.

import { el, setAttrs, fmt, RAD, clamp, lerp } from './util.js';
import { PALETTE } from './palette.js';
import { projectMoon, onDisc } from './project.js';
import { litPath, earthshineOpacity } from './lighting.js';
import { VIEW } from './scale.js';
import {
  MARIA, CRATERS, RAY_SEGMENTS, PSRS, RILLES, POCKMARKS, YOUNG_NAMES,
  craterRadiusPx, lodBand, isCameraPolar, moonNodeBudget as catalogNodeBudget,
  MOON_CATALOG, REQUIRED_CRATER_NAMES, passesPixelGate, inMare,
  cratersVisibleAt, mariaVisibleAt, catalogFeatureCount, makePockmarks,
  pockmarkSeed, LOD_MIN, lodOpacity, lodMinPx, MOON_D_KM, minDegForBand,
} from './moon-catalog.js';

export {
  MOON_CATALOG, REQUIRED_CRATER_NAMES, craterRadiusPx, lodBand, isCameraPolar,
  passesPixelGate, inMare, cratersVisibleAt, mariaVisibleAt, catalogFeatureCount,
  makePockmarks, pockmarkSeed, LOD_MIN, lodOpacity, lodMinPx, YOUNG_NAMES,
  minDegForBand,
};

const FILL = {
  highland: `var(--moon-highland, ${PALETTE['moon-highland']})`,
  highlandDim: `var(--moon-highland-dim, ${PALETTE['moon-highland-dim']})`,
  mare: `var(--moon-mare, ${PALETTE['moon-mare']})`,
  mareDim: `var(--moon-mare-dim, ${PALETTE['moon-mare-dim']})`,
  floor: `var(--moon-floor, ${PALETTE['moon-floor']})`,
  rim: `var(--moon-rim, ${PALETTE['moon-rim']})`,
  shadow: `var(--moon-shadow, ${PALETTE['moon-shadow']})`,
  earthshine: `var(--moon-earthshine, ${PALETTE['moon-earthshine']})`,
  term: `var(--moon-warm-term, ${PALETTE['moon-warm-term']})`,
  psr: `var(--moon-psr, ${PALETTE['moon-psr']})`,
};

const MARGIN = 240;

// Perspective ground: nadir in the lower-middle, north recedes to a curved horizon.
export const GROUND = {
  horizonY: 258,
  edgeY: 414,
  nearY: 908,
  vanishX: VIEW.w / 2,
  nearHalf: 1080,
  farHalf: 220,
  craterRef: 500,
  shadowStretch: 1.65,
};

function hide(node) {
  setAttrs(node, { display: 'none' });
}

function show(node) {
  setAttrs(node, { display: null });
}

function inExpandedView(x, y) {
  return x > -MARGIN && x < VIEW.w + MARGIN && y > -MARGIN && y < VIEW.h + MARGIN;
}

export function unlitSun(sun) {
  return {
    sx: -sun.sx,
    sy: -sun.sy,
    sz: -sun.sz,
    azDeg: sun.azDeg + 180,
  };
}

export function unlitPath(cx, cy, R, sun) {
  return litPath(cx, cy, R, unlitSun(sun));
}

export function featureLit(p, sun) {
  return p.x * sun.sx + p.y * sun.sy + p.cosc * sun.sz > 0;
}

export function groundHorizonPath() {
  const yE = GROUND.edgeY;
  return `M 0 ${fmt(VIEW.h)} L ${fmt(VIEW.w)} ${fmt(VIEW.h)} L ${fmt(VIEW.w)} ${fmt(yE)} Q ${fmt(VIEW.w / 2)} ${fmt(GROUND.horizonY)} 0 ${fmt(yE)} Z`;
}

export function groundHorizonStroke() {
  const yE = GROUND.edgeY;
  return `M 0 ${fmt(yE)} Q ${fmt(VIEW.w / 2)} ${fmt(GROUND.horizonY)} ${fmt(VIEW.w)} ${fmt(yE)}`;
}

function circlePath(cx, cy, r) {
  return `M ${fmt(cx - r)} ${fmt(cy)} A ${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(cx + r)} ${fmt(cy)} A ${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(cx - r)} ${fmt(cy)} Z`;
}

export function ellipsePath(cx, cy, rx, ry, rotDeg = 0) {
  const a = rotDeg * RAD;
  const dx = Math.cos(a) * rx;
  const dy = Math.sin(a) * rx;
  return `M ${fmt(cx - dx)} ${fmt(cy - dy)} A ${fmt(rx)} ${fmt(ry)} ${fmt(rotDeg)} 1 1 ${fmt(cx + dx)} ${fmt(cy + dy)} A ${fmt(rx)} ${fmt(ry)} ${fmt(rotDeg)} 1 1 ${fmt(cx - dx)} ${fmt(cy - dy)} Z`;
}

// Sunward rim: a thin bright arc, not a full annulus.
export function craterRimArc(cx, cy, r, azDeg, spanDeg = 118) {
  const a0 = (azDeg - spanDeg / 2) * RAD;
  const a1 = (azDeg + spanDeg / 2) * RAD;
  const x0 = cx + Math.cos(a0) * r;
  const y0 = cy + Math.sin(a0) * r;
  const x1 = cx + Math.cos(a1) * r;
  const y1 = cy + Math.sin(a1) * r;
  const large = spanDeg > 180 ? 1 : 0;
  return `M ${fmt(x0)} ${fmt(y0)} A ${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(x1)} ${fmt(y1)}`;
}

export function craterRimArcEllipse(cx, cy, rx, ry, azDeg, spanDeg = 124, rotDeg = 0) {
  const rot = rotDeg * RAD;
  const pt = (deg) => {
    const t = deg * RAD;
    const lx = Math.cos(t) * rx;
    const ly = Math.sin(t) * ry;
    return {
      x: cx + lx * Math.cos(rot) - ly * Math.sin(rot),
      y: cy + lx * Math.sin(rot) + ly * Math.cos(rot),
    };
  };
  const p0 = pt(azDeg - spanDeg / 2);
  const p1 = pt(azDeg + spanDeg / 2);
  const large = spanDeg > 180 ? 1 : 0;
  return `M ${fmt(p0.x)} ${fmt(p0.y)} A ${fmt(rx)} ${fmt(ry)} ${fmt(rotDeg)} ${large} 1 ${fmt(p1.x)} ${fmt(p1.y)}`;
}

// Crescent on the anti-sun wall of a crater floor. Thickness is a fraction of r.
export function craterShadowPath(cx, cy, r, azDeg, thickness = 0.2) {
  const rf = 0.92 * r;
  const a = azDeg * RAD;
  const offset = Math.min(thickness * r, rf * 0.46);
  const bx = cx + Math.cos(a) * offset;
  const by = cy + Math.sin(a) * offset;
  const br = rf * 0.9;
  const lune = twoCircleLune(cx, cy, rf, bx, by, br);
  return lune || `M ${fmt(cx + rf)} ${fmt(cy)} A ${fmt(rf)} ${fmt(rf)} 0 1 1 ${fmt(cx - rf)} ${fmt(cy)} A ${fmt(rf)} ${fmt(rf)} 0 1 1 ${fmt(cx + rf)} ${fmt(cy)} Z`;
}

function twoCircleLune(ax, ay, ar, bx, by, br) {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6 || d >= ar + br || d <= Math.abs(ar - br)) return null;
  const aa = (ar * ar - br * br + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ar * ar - aa * aa));
  const px = ax + (aa * dx) / d;
  const py = ay + (aa * dy) / d;
  const p1x = px + (h * dy) / d;
  const p1y = py - (h * dx) / d;
  const p2x = px - (h * dy) / d;
  const p2y = py + (h * dx) / d;
  return `M ${fmt(p1x)} ${fmt(p1y)} A ${fmt(ar)} ${fmt(ar)} 0 0 1 ${fmt(p2x)} ${fmt(p2y)} A ${fmt(br)} ${fmt(br)} 0 0 0 ${fmt(p1x)} ${fmt(p1y)} Z`;
}

export function groundProject(p) {
  const depth = clamp(0.14 + 0.86 * (0.5 - 0.5 * p.y), 0.11, 1);
  const u = depth * depth;
  const y = GROUND.nearY + (GROUND.horizonY - GROUND.nearY) * u;
  const half = lerp(GROUND.nearHalf, GROUND.farHalf, u);
  const x = GROUND.vanishX + p.x * half;
  const persp = lerp(1.32, 0.18, u);
  const flatten = lerp(0.46, 0.07, u);
  return { x, y, u, persp, flatten, depth };
}

export function groundCraterRadii(dKm, p) {
  const g = groundProject(p);
  let r = (dKm / MOON_D_KM) * GROUND.craterRef * g.persp;
  if (r > 40) r = 40 + (r - 40) * 0.22;
  return { rx: Math.max(0.4, r), ry: Math.max(0.2, r * g.flatten), ...g };
}

export function moonNodeBudget(band, ground) {
  return catalogNodeBudget(band, ground);
}

function mareFillOpacity(m, R, fade) {
  const base = m.dim ? 0.34 : 0.76;
  const small = clamp((R - 8) / 110, 0, 1);
  const scale = 0.22 + 0.78 * small;
  return base * scale * fade;
}

function floorFillOpacity(rPx, scaleR, fade, ground, young) {
  if (ground) return (young ? 0.1 : 0.15) * fade;
  const rel = rPx / Math.max(scaleR, 1);
  const giant = clamp(rel / 0.11, 0, 1);
  const base = young ? 0.08 : 0.155 - 0.11 * giant;
  return Math.max(0.04, base) * fade;
}

function rimStrokeWidth(rPx, ground) {
  if (ground) return clamp(0.45 + 0.035 * rPx, 0.45, 1.7);
  return clamp(0.35 + 0.026 * rPx, 0.35, 1.45);
}

function cacheKey(frame) {
  const m = frame.moon;
  const s = frame.sun;
  const c = frame.moonCamera;
  return [
    m.cx, m.cy, m.r, m.visible ? 1 : 0, m.ground ? 1 : 0,
    s.sx, s.sy, s.sz, s.azDeg,
    c.lat0, c.lon0,
    frame.state.heroMoonAngularDia,
    frame.gain,
  ].map((v) => (typeof v === 'number' ? fmt(v) : v)).join('|');
}

function ensureRegolithPattern(ctx, state) {
  if (state.pat || !ctx?.fx || typeof ctx.fx.regolithPattern !== 'function') return;
  let pattern;
  try {
    pattern = ctx.fx.regolithPattern();
  } catch {
    return;
  }
  if (!pattern) return;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = pattern;
  g.fillRect(0, 0, 128, 128);
  const href = canvas.toDataURL();
  const pat = el('pattern', {
    id: 'moon-regolith',
    patternUnits: 'userSpaceOnUse',
    width: '128',
    height: '128',
  }, ctx.defs);
  el('image', { href, width: '128', height: '128' }, pat);
  state.pat = pat;
}

function countDescendants(n) {
  const kids = n.childNodes;
  if (!kids || !kids.length) return 0;
  let c = 0;
  for (let i = 0; i < kids.length; i++) c += 1 + countDescendants(kids[i]);
  return c;
}

function makeCraterTriple(parent, name, shadowA, rimA) {
  return {
    floor: el('ellipse', { fill: FILL.floor, 'data-name': name || undefined }, parent),
    shadow: el('path', {
      fill: FILL.shadow,
      'fill-opacity': shadowA,
      'data-name': name || undefined,
    }, parent),
    rim: el('path', {
      fill: 'none',
      stroke: FILL.rim,
      'stroke-linecap': 'round',
      'stroke-opacity': rimA,
      'data-name': name || undefined,
    }, parent),
  };
}

function dropTriple(nodes) {
  if (!nodes) return;
  nodes.floor.remove();
  nodes.shadow.remove();
  nodes.rim.remove();
}

export function createMoon(layer, ctx) {
  const defs = ctx.defs || el('defs', {}, ctx.svg);
  ctx.defs = defs;

  const clip = el('clipPath', { id: 'moon-disc-clip' }, defs);
  const clipCirc = el('circle', {}, clip);
  const clipGround = el('clipPath', { id: 'moon-ground-clip' }, defs);
  const clipGroundPath = el('path', { d: groundHorizonPath() }, clipGround);

  const groundGrad = el('linearGradient', {
    id: 'moon-ground-grad',
    gradientUnits: 'userSpaceOnUse',
  }, defs);
  el('stop', { offset: '0', 'stop-color': PALETTE['moon-highland'], 'stop-opacity': '1' }, groundGrad);
  el('stop', { offset: '1', 'stop-color': PALETTE['moon-floor'], 'stop-opacity': '1' }, groundGrad);

  const root = el('g', { 'data-module': 'moon' }, layer);
  const clipped = el('g', { 'clip-path': 'url(#moon-disc-clip)' }, root);

  const highland = el('path', { fill: FILL.shadow, 'data-layer': 'highland' }, clipped);
  const earthshine = el('path', {
    fill: FILL.earthshine,
    'fill-opacity': '0',
    'data-layer': 'earthshine',
  }, clipped);
  const litFill = el('path', { id: 'moon-lit', fill: FILL.highland, 'data-layer': 'lit' }, clipped);
  const terminator = el('path', {
    fill: 'none',
    stroke: FILL.term,
    'stroke-width': '0.6',
    'stroke-opacity': '0.4',
    'data-layer': 'terminator',
  }, clipped);
  // Dim gain (spec §6.2.2): a void veil over everything inside the Moon's clip, so the body
  // darkens toward the sky instead of turning translucent over the stars behind it.
  const veil = el('path', {
    fill: PALETTE.void,
    'fill-opacity': '0',
    display: 'none',
    'data-layer': 'gain-veil',
  }, clipped);

  const youngCraters = YOUNG_NAMES.map((name) => CRATERS.find((c) => c.name === name)).filter(Boolean);
  const mariaNodes = MARIA.map(() => null);
  const craterNodes = CRATERS.map(() => null);
  const haloNodes = youngCraters.map(() => null);
  const pockNodes = POCKMARKS.map(() => null);
  const rilleNodes = RILLES.map(() => null);
  const rayNodes = RAY_SEGMENTS.map(() => null);
  const psrNodes = PSRS.map(() => null);

  const state = {
    lastKey: '',
    pat: null,
    groundGrad,
    builtNodes: countDescendants(layer),
    lodKey: '',
    mariaG: null,
    craterG: null,
    tychoPoint: null,
    haloG: null,
    pockG: null,
    rilleG: null,
    rayG: null,
    psrG: null,
    regolith: null,
    horizon: null,
  };

  function restack() {
    const order = [
      state.mariaG, state.craterG, state.tychoPoint, state.haloG,
      state.pockG, state.rilleG, state.rayG, state.psrG, state.regolith,
    ];
    for (const n of order) {
      if (n) clipped.appendChild(n);
    }
    clipped.appendChild(terminator);
    clipped.appendChild(veil);
  }

  function ensureLayer(key, tag, attrs) {
    if (state[key]) return state[key];
    const node = el(tag, attrs);
    state[key] = node;
    restack();
    return node;
  }

  function dropLayer(key) {
    const n = state[key];
    if (!n) return;
    n.remove();
    state[key] = null;
  }

  function syncMaria(cap, on) {
    if (!on) {
      for (let i = 0; i < mariaNodes.length; i++) {
        if (mariaNodes[i]) {
          mariaNodes[i].remove();
          mariaNodes[i] = null;
        }
      }
      dropLayer('mariaG');
      return;
    }
    const g = ensureLayer('mariaG', 'g', { 'data-layer': 'maria' });
    for (let i = 0; i < MARIA.length; i++) {
      const need = MARIA[i].minDeg <= cap;
      if (need && !mariaNodes[i]) {
        const m = MARIA[i];
        mariaNodes[i] = el('ellipse', {
          'data-name': m.name,
          fill: m.dim ? FILL.mareDim : FILL.mare,
          'fill-opacity': m.dim ? '0.34' : '0.74',
        }, g);
      } else if (!need && mariaNodes[i]) {
        mariaNodes[i].remove();
        mariaNodes[i] = null;
      }
    }
  }

  function syncCraters(cap, on) {
    if (!on) {
      for (let i = 0; i < craterNodes.length; i++) {
        if (craterNodes[i]) {
          dropTriple(craterNodes[i]);
          craterNodes[i] = null;
        }
      }
      dropLayer('craterG');
      return;
    }
    const g = ensureLayer('craterG', 'g', { 'data-layer': 'craters' });
    for (let i = 0; i < CRATERS.length; i++) {
      const need = CRATERS[i].minDeg <= cap;
      if (need && !craterNodes[i]) {
        craterNodes[i] = makeCraterTriple(g, CRATERS[i].name, '0.32', '0.55');
      } else if (!need && craterNodes[i]) {
        dropTriple(craterNodes[i]);
        craterNodes[i] = null;
      }
    }
  }

  function syncHalos(on) {
    if (!on) {
      for (let i = 0; i < haloNodes.length; i++) {
        if (haloNodes[i]) {
          haloNodes[i].remove();
          haloNodes[i] = null;
        }
      }
      dropLayer('haloG');
      return;
    }
    const g = ensureLayer('haloG', 'g', { 'data-layer': 'halos' });
    for (let i = 0; i < youngCraters.length; i++) {
      if (haloNodes[i]) continue;
      const c = youngCraters[i];
      haloNodes[i] = el('ellipse', {
        fill: FILL.rim,
        'fill-opacity': '0',
        'data-name': `${c.name}-halo`,
      }, g);
    }
  }

  function syncPocks(on) {
    if (!on) {
      for (let i = 0; i < pockNodes.length; i++) {
        if (pockNodes[i]) {
          dropTriple(pockNodes[i]);
          pockNodes[i] = null;
        }
      }
      dropLayer('pockG');
      return;
    }
    const g = ensureLayer('pockG', 'g', { 'data-layer': 'pockmarks' });
    for (let i = 0; i < POCKMARKS.length; i++) {
      if (!pockNodes[i]) pockNodes[i] = makeCraterTriple(g, '', '0.22', '0.28');
    }
  }

  function syncRilles(on) {
    if (!on) {
      for (let i = 0; i < rilleNodes.length; i++) {
        if (rilleNodes[i]) {
          rilleNodes[i].remove();
          rilleNodes[i] = null;
        }
      }
      dropLayer('rilleG');
      return;
    }
    const g = ensureLayer('rilleG', 'g', { 'data-layer': 'rilles' });
    for (let i = 0; i < RILLES.length; i++) {
      if (rilleNodes[i]) continue;
      const r = RILLES[i];
      rilleNodes[i] = el('polyline', {
        fill: 'none',
        stroke: FILL.floor,
        'stroke-opacity': '0.4',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'data-name': r.name,
      }, g);
    }
  }

  function syncRays(cap, on) {
    if (!on) {
      for (let i = 0; i < rayNodes.length; i++) {
        if (rayNodes[i]) {
          rayNodes[i].remove();
          rayNodes[i] = null;
        }
      }
      dropLayer('rayG');
      return;
    }
    const g = ensureLayer('rayG', 'g', { 'data-layer': 'rays' });
    let any = false;
    for (let i = 0; i < RAY_SEGMENTS.length; i++) {
      const need = RAY_SEGMENTS[i].minDeg <= cap;
      if (need) any = true;
      if (need && !rayNodes[i]) {
        rayNodes[i] = el('line', {
          stroke: FILL.rim,
          'stroke-opacity': '0.2',
          'stroke-linecap': 'round',
          'data-parent': RAY_SEGMENTS[i].parent,
        }, g);
      } else if (!need && rayNodes[i]) {
        rayNodes[i].remove();
        rayNodes[i] = null;
      }
    }
    if (!any) dropLayer('rayG');
  }

  function syncPsrs(on) {
    if (!on) {
      for (let i = 0; i < psrNodes.length; i++) {
        if (psrNodes[i]) {
          psrNodes[i].remove();
          psrNodes[i] = null;
        }
      }
      dropLayer('psrG');
      return;
    }
    const g = ensureLayer('psrG', 'g', { 'data-layer': 'psrs' });
    for (let i = 0; i < PSRS.length; i++) {
      if (psrNodes[i]) continue;
      psrNodes[i] = el('ellipse', {
        fill: FILL.psr,
        'data-name': PSRS[i].name,
      }, g);
    }
  }

  function syncTychoPoint(on) {
    if (!on) {
      dropLayer('tychoPoint');
      return;
    }
    if (state.tychoPoint) return;
    const node = el('circle', { fill: FILL.rim, 'data-name': 'Tycho-point' });
    state.tychoPoint = node;
    restack();
  }

  function syncRegolith(on) {
    if (!on) {
      dropLayer('regolith');
      return;
    }
    ensureLayer('regolith', 'rect', {
      fill: 'url(#moon-regolith)',
      opacity: '0',
      'pointer-events': 'none',
    });
  }

  function syncHorizon(on) {
    if (!on) {
      if (state.horizon) {
        state.horizon.remove();
        state.horizon = null;
      }
      return;
    }
    if (state.horizon) return;
    state.horizon = el('path', {
      fill: 'none',
      stroke: FILL.highlandDim,
      'stroke-width': '1.1',
      'stroke-opacity': '0.55',
      'data-layer': 'horizon',
    }, root);
  }

  function syncLod(band, ground) {
    const key = ground ? 'ground' : String(band);
    if (key === state.lodKey) return;
    state.lodKey = key;
    const cap = ground ? LOD_MIN.remaining : minDegForBand(band);
    const wantMaria = ground || band >= 1;
    const wantCraters = ground || band >= 3;
    const wantTycho = !ground && band === 2;
    const wantHalos = !ground && band >= 5;
    const wantPocks = ground || band >= 7;
    const wantRilles = !ground && band >= 5;
    const wantRays = !ground && band >= 3;
    const wantPsrs = ground || band >= 6;
    const wantRegolith = ground || band >= 6;
    syncMaria(cap, wantMaria);
    syncCraters(cap, wantCraters);
    syncTychoPoint(wantTycho);
    syncHalos(wantHalos);
    syncPocks(wantPocks);
    syncRilles(wantRilles);
    syncRays(cap, wantRays);
    syncPsrs(wantPsrs);
    syncRegolith(wantRegolith);
    syncHorizon(ground);
    setAttrs(root, { 'data-lod': key });
    state.builtNodes = countDescendants(layer);
  }

  function placeDiscCrater(nodes, lat, lon, dKm, camera, disc, sun, fade, minPx, young) {
    if (fade <= 0.004) {
      hide(nodes.floor);
      hide(nodes.rim);
      hide(nodes.shadow);
      return;
    }
    const p = projectMoon(lat, lon, camera);
    if (p.cosc <= 0) {
      hide(nodes.floor);
      hide(nodes.rim);
      hide(nodes.shadow);
      return;
    }
    const r = craterRadiusPx(dKm, disc.r, p.cosc);
    if (r < minPx) {
      hide(nodes.floor);
      hide(nodes.rim);
      hide(nodes.shadow);
      return;
    }
    const q = onDisc(p, disc);
    if (!inExpandedView(q.x, q.y)) {
      hide(nodes.floor);
      hide(nodes.rim);
      hide(nodes.shadow);
      return;
    }
    const lit = featureLit(p, sun);
    const rf = 0.92 * r;
    const floorA = floorFillOpacity(r, disc.r, fade, false, young) * (lit ? 1 : 0.35);
    const rimA = (young ? 0.78 : 0.5) * fade * (lit ? 1 : 0.28);
    const shA = lit ? 0.3 * fade : 0;
    show(nodes.floor);
    setAttrs(nodes.floor, {
      cx: fmt(q.x),
      cy: fmt(q.y),
      rx: fmt(rf),
      ry: fmt(rf),
      transform: null,
      'fill-opacity': fmt(floorA),
    });
    if (shA < 0.02) {
      hide(nodes.shadow);
    } else {
      show(nodes.shadow);
      setAttrs(nodes.shadow, {
        d: craterShadowPath(q.x, q.y, r, sun.azDeg, young ? 0.24 : 0.18),
        'fill-opacity': fmt(shA),
      });
    }
    show(nodes.rim);
    setAttrs(nodes.rim, {
      d: craterRimArc(q.x, q.y, 0.96 * r, sun.azDeg, young ? 132 : 112),
      'stroke-width': fmt(rimStrokeWidth(r, false)),
      'stroke-opacity': fmt(rimA),
    });
  }

  function placeGroundCrater(nodes, lat, lon, dKm, camera, sun, fade, young, pock) {
    if (fade <= 0.004) {
      hide(nodes.floor);
      hide(nodes.rim);
      hide(nodes.shadow);
      return;
    }
    const p = projectMoon(lat, lon, camera);
    if (p.cosc <= 0.02) {
      hide(nodes.floor);
      hide(nodes.rim);
      hide(nodes.shadow);
      return;
    }
    const g = groundCraterRadii(dKm, p);
    if (g.y < GROUND.horizonY - 8 || g.y > VIEW.h + 40) {
      hide(nodes.floor);
      hide(nodes.rim);
      hide(nodes.shadow);
      return;
    }
    if (g.x < -80 || g.x > VIEW.w + 80) {
      hide(nodes.floor);
      hide(nodes.rim);
      hide(nodes.shadow);
      return;
    }
    if (Math.max(g.rx, g.ry) < (pock ? 0.45 : 0.7)) {
      hide(nodes.floor);
      hide(nodes.rim);
      hide(nodes.shadow);
      return;
    }
    const rfX = 0.92 * g.rx;
    const rfY = 0.92 * g.ry;
    const giant = dKm > 180;
    const floorA = pock ? 0.09 * fade : (young ? 0.12 : giant ? 0.28 : 0.2) * fade;
    show(nodes.floor);
    setAttrs(nodes.floor, {
      cx: fmt(g.x),
      cy: fmt(g.y),
      rx: fmt(rfX),
      ry: fmt(rfY),
      transform: null,
      'fill-opacity': fmt(floorA),
    });
    const a = (sun.azDeg + 180) * RAD;
    if (pock) {
      hide(nodes.shadow);
    } else {
      const stretch = GROUND.shadowStretch * (giant ? 1.15 : 1);
      const len = g.rx * stretch;
      const scx = g.x + Math.cos(a) * len * 0.07;
      const scy = g.y + Math.sin(a) * len * 0.07;
      const srx = g.rx * 0.68 + len * 0.2;
      const sry = Math.max(0.45, g.ry * 0.82);
      show(nodes.shadow);
      setAttrs(nodes.shadow, {
        d: ellipsePath(scx, scy, srx, sry, sun.azDeg + 180),
        'fill-opacity': fmt((giant ? 0.58 : 0.46) * fade),
      });
    }
    show(nodes.rim);
    setAttrs(nodes.rim, {
      d: craterRimArcEllipse(g.x, g.y, 0.98 * g.rx, 0.98 * g.ry, sun.azDeg, young ? 136 : 120),
      'stroke-width': fmt(rimStrokeWidth(g.rx, true)),
      'stroke-opacity': fmt((young ? 0.88 : pock ? 0.28 : 0.78) * fade),
    });
  }

  function update(frame) {
    const key = cacheKey(frame);
    if (key === state.lastKey) return;
    state.lastKey = key;

    const disc = frame.moon;
    if (!disc.visible || disc.r <= 0) {
      hide(root);
      syncLod(0, false);
      return;
    }
    show(root);

    const camera = frame.moonCamera;
    const sun = frame.sun;
    // The sun azimuth this body is lit from, for the one-sun visual check (spec §13, check 1).
    setAttrs(litFill, { 'data-az': fmt(sun.azDeg) });
    const theta = frame.state.heroMoonAngularDia;
    const band = lodBand(theta);
    const polar = isCameraPolar(camera);
    const minPx = lodMinPx(theta);
    const ground = !!disc.ground;
    syncLod(band, ground);
    const veilGain = clamp(frame.gain == null ? 1 : frame.gain, 0, 1);
    if (veilGain >= 0.999) {
      hide(veil);
    } else {
      show(veil);
      setAttrs(veil, {
        d: ground ? groundHorizonPath() : circlePath(disc.cx, disc.cy, disc.r),
        'fill-opacity': fmt(1 - veilGain),
      });
    }

    if (ground) {
      setAttrs(clipped, { 'clip-path': 'url(#moon-ground-clip)' });
      setAttrs(clipGroundPath, { d: groundHorizonPath() });
      const a = sun.azDeg * RAD;
      setAttrs(state.groundGrad, {
        x1: fmt(GROUND.vanishX - 700 * Math.cos(a)),
        y1: fmt(600 - 400 * Math.sin(a)),
        x2: fmt(GROUND.vanishX + 700 * Math.cos(a)),
        y2: fmt(600 + 400 * Math.sin(a)),
      });
      show(highland);
      setAttrs(highland, { d: groundHorizonPath(), fill: 'url(#moon-ground-grad)' });
      hide(earthshine);
      hide(litFill);
      hide(terminator);
      if (state.horizon) {
        show(state.horizon);
        setAttrs(state.horizon, { d: groundHorizonStroke(), 'stroke-opacity': fmt(0.55 * veilGain) });
      }
    } else {
      setAttrs(clipped, { 'clip-path': 'url(#moon-disc-clip)' });
      setAttrs(clipCirc, { cx: fmt(disc.cx), cy: fmt(disc.cy), r: fmt(disc.r) });
      show(highland);
      setAttrs(highland, { d: circlePath(disc.cx, disc.cy, disc.r), fill: FILL.shadow });
      const I = earthshineOpacity(sun);
      if (I <= 0) {
        hide(earthshine);
      } else {
        show(earthshine);
        setAttrs(earthshine, {
          d: unlitPath(disc.cx, disc.cy, disc.r, sun),
          'fill-opacity': fmt(I),
        });
      }
      show(litFill);
      const litD = litPath(disc.cx, disc.cy, disc.r, sun);
      setAttrs(litFill, { d: litD, fill: FILL.highland });
      show(terminator);
      setAttrs(terminator, { d: litD });
    }

    const scaleR = ground ? GROUND.craterRef : disc.r;

    for (let i = 0; i < MARIA.length; i++) {
      const m = MARIA[i];
      const node = mariaNodes[i];
      if (!node) continue;
      const fade = lodOpacity(theta, m.minDeg);
      if (fade <= 0.004) {
        hide(node);
        continue;
      }
      const p = projectMoon(m.lat, m.lon, camera);
      if (p.cosc <= 0) {
        hide(node);
        continue;
      }
      if (ground) {
        const g = groundProject(p);
        const scale = (GROUND.craterRef * g.persp) / MOON_D_KM;
        const rx = (m.dxKm * scale) / 2;
        const ry = ((m.dyKm * scale) / 2) * g.flatten;
        if (Math.max(rx, ry) < 2 || g.y < GROUND.horizonY || g.y > VIEW.h + 80) {
          hide(node);
          continue;
        }
        show(node);
        setAttrs(node, {
          cx: fmt(g.x),
          cy: fmt(g.y),
          rx: fmt(rx),
          ry: fmt(ry),
          transform: null,
          'fill-opacity': fmt(0.3 * fade),
        });
      } else {
        const scale = (2 * scaleR * p.cosc) / MOON_D_KM;
        const rx = (m.dxKm * scale) / 2;
        const ry = (m.dyKm * scale) / 2;
        if (Math.max(rx, ry) < minPx) {
          hide(node);
          continue;
        }
        const q = onDisc(p, disc);
        if (!inExpandedView(q.x, q.y)) {
          hide(node);
          continue;
        }
        const lit = featureLit(p, sun);
        show(node);
        setAttrs(node, {
          cx: fmt(q.x),
          cy: fmt(q.y),
          rx: fmt(rx),
          ry: fmt(ry),
          transform: `rotate(${fmt(m.rot)} ${fmt(q.x)} ${fmt(q.y)})`,
          'fill-opacity': fmt(mareFillOpacity(m, disc.r, fade) * (lit ? 1 : 0.45)),
        });
      }
    }

    for (let i = 0; i < CRATERS.length; i++) {
      const c = CRATERS[i];
      if (!craterNodes[i]) continue;
      const fade = lodOpacity(theta, c.minDeg);
      if (ground) placeGroundCrater(craterNodes[i], c.lat, c.lon, c.d, camera, sun, fade, c.young, false);
      else placeDiscCrater(craterNodes[i], c.lat, c.lon, c.d, camera, disc, sun, fade, minPx, c.young);
    }

    const tychoFade = (theta >= 1.2 && theta < 2.5) ? lodOpacity(theta, 1.2) * (1 - lodOpacity(theta, 2.5)) : 0;
    if (state.tychoPoint) {
      if (tychoFade > 0.004 && !ground) {
        const p = projectMoon(-43.3, -11.22, camera);
        if (p.cosc > 0) {
          const q = onDisc(p, disc);
          const rr = Math.max(0.7, 0.016 * scaleR);
          show(state.tychoPoint);
          setAttrs(state.tychoPoint, {
            cx: fmt(q.x),
            cy: fmt(q.y),
            r: fmt(rr),
            'fill-opacity': fmt(0.85 * tychoFade),
          });
        } else {
          hide(state.tychoPoint);
        }
      } else {
        hide(state.tychoPoint);
      }
    }

    for (let i = 0; i < youngCraters.length; i++) {
      const c = youngCraters[i];
      const node = haloNodes[i];
      if (!node) continue;
      const fade = lodOpacity(theta, Math.max(14, c.minDeg));
      if (fade <= 0.004 || ground) {
        hide(node);
        continue;
      }
      const p = projectMoon(c.lat, c.lon, camera);
      if (p.cosc <= 0) {
        hide(node);
        continue;
      }
      const r = craterRadiusPx(c.d, disc.r, p.cosc);
      const q = onDisc(p, disc);
      if (r < minPx || !inExpandedView(q.x, q.y) || !featureLit(p, sun)) {
        hide(node);
        continue;
      }
      const halo = c.name === 'Tycho' || c.name === 'Aristarchus' ? 2.35 : 1.95;
      show(node);
      setAttrs(node, {
        cx: fmt(q.x),
        cy: fmt(q.y),
        rx: fmt(r * halo),
        ry: fmt(r * halo),
        'fill-opacity': fmt(0.11 * fade),
      });
    }

    const pockFade = ground ? 1 : lodOpacity(theta, LOD_MIN.limb);
    const showPocks = pockFade > 0.004 && (ground || band >= 7);
    for (let i = 0; i < POCKMARKS.length; i++) {
      const pk = POCKMARKS[i];
      if (!pockNodes[i]) continue;
      if (!showPocks) {
        hide(pockNodes[i].floor);
        hide(pockNodes[i].rim);
        hide(pockNodes[i].shadow);
        continue;
      }
      if (ground) placeGroundCrater(pockNodes[i], pk.lat, pk.lon, pk.d, camera, sun, pockFade, false, true);
      else placeDiscCrater(pockNodes[i], pk.lat, pk.lon, pk.d, camera, disc, sun, pockFade, Math.max(minPx, 0.45), false);
    }

    for (let i = 0; i < RILLES.length; i++) {
      const rille = RILLES[i];
      const node = rilleNodes[i];
      if (!node) continue;
      const fade = lodOpacity(theta, rille.minDeg);
      if (fade <= 0.004 || ground) {
        hide(node);
        continue;
      }
      const pts = [];
      for (const pt of rille.points) {
        const p = projectMoon(pt.lat, pt.lon, camera);
        if (p.cosc <= 0) continue;
        const q = onDisc(p, disc);
        pts.push(`${fmt(q.x)},${fmt(q.y)}`);
      }
      if (pts.length < 2) {
        hide(node);
        continue;
      }
      show(node);
      setAttrs(node, {
        points: pts.join(' '),
        'stroke-width': fmt(Math.max(0.4, scaleR * 0.0035)),
        'stroke-opacity': fmt(0.4 * fade),
      });
    }

    for (let i = 0; i < RAY_SEGMENTS.length; i++) {
      const seg = RAY_SEGMENTS[i];
      const node = rayNodes[i];
      if (!node) continue;
      const fade = lodOpacity(theta, seg.minDeg);
      if (ground || fade <= 0.004) {
        hide(node);
        continue;
      }
      const p0 = projectMoon(seg.lat0, seg.lon0, camera);
      const p1 = projectMoon(seg.lat1, seg.lon1, camera);
      if (p0.cosc <= 0 || p1.cosc <= 0) {
        hide(node);
        continue;
      }
      const q0 = onDisc(p0, disc);
      const q1 = onDisc(p1, disc);
      if (!inExpandedView(q0.x, q0.y) && !inExpandedView(q1.x, q1.y)) {
        hide(node);
        continue;
      }
      show(node);
      setAttrs(node, {
        x1: fmt(q0.x),
        y1: fmt(q0.y),
        x2: fmt(q1.x),
        y2: fmt(q1.y),
        'stroke-width': fmt(seg.width),
        'stroke-opacity': fmt(0.2 * fade),
      });
    }

    const psrFade = (theta >= 28 && (polar || ground)) ? lodOpacity(theta, LOD_MIN.regolith) : 0;
    for (let i = 0; i < PSRS.length; i++) {
      const p = PSRS[i];
      const node = psrNodes[i];
      if (!node) continue;
      if (psrFade <= 0.004) {
        hide(node);
        continue;
      }
      const pr = projectMoon(p.lat, p.lon, camera);
      if (pr.cosc <= 0) {
        hide(node);
        continue;
      }
      if (ground) {
        const parent = CRATERS.find((c) => c.name === p.name);
        const dUse = Math.max(p.d * 1.6, parent ? parent.d : p.d, 120);
        const g = groundCraterRadii(dUse, pr);
        if (g.y < GROUND.horizonY || g.y > VIEW.h + 20 || Math.max(g.rx, g.ry) < 0.7) {
          hide(node);
          continue;
        }
        const a = (sun.azDeg + 180) * RAD;
        show(node);
        setAttrs(node, {
          cx: fmt(g.x + Math.cos(a) * g.rx * 0.06),
          cy: fmt(g.y + Math.sin(a) * g.ry * 0.06),
          rx: fmt(0.9 * g.rx),
          ry: fmt(0.9 * g.ry),
          transform: null,
          // Half strength on the ground: at full black the pits read as holes punched in the page.
          'fill-opacity': fmt(0.5 * psrFade),
        });
      } else {
        const r = craterRadiusPx(p.d, disc.r, pr.cosc);
        if (r < 0.3) {
          hide(node);
          continue;
        }
        const q = onDisc(pr, disc);
        if (!inExpandedView(q.x, q.y)) {
          hide(node);
          continue;
        }
        show(node);
        setAttrs(node, {
          cx: fmt(q.x),
          cy: fmt(q.y),
          rx: fmt(r * 0.88),
          ry: fmt(r * 0.88),
          'fill-opacity': fmt(0.88 * psrFade),
        });
      }
    }

    const regolith = state.regolith;
    if (regolith && (theta >= 28 || ground)) {
      ensureRegolithPattern(ctx, state);
      if (state.pat) {
        show(regolith);
        if (ground) {
          setAttrs(regolith, {
            x: '0',
            y: fmt(GROUND.horizonY - 20),
            width: fmt(VIEW.w),
            height: fmt(VIEW.h - GROUND.horizonY + 40),
            opacity: fmt(0.55 * Math.max(lodOpacity(theta, LOD_MIN.regolith), 0.4)),
          });
        } else {
          setAttrs(regolith, {
            x: fmt(disc.cx - disc.r),
            y: fmt(disc.cy - disc.r),
            width: fmt(disc.r * 2),
            height: fmt(disc.r * 2),
            opacity: fmt(0.38 * lodOpacity(theta, LOD_MIN.regolith)),
          });
        }
      } else {
        hide(regolith);
      }
    } else if (regolith) {
      hide(regolith);
    }
  }

  function destroy() {
    root.remove();
    clip.remove();
    clipGround.remove();
    if (state.groundGrad) state.groundGrad.remove();
    if (state.pat) state.pat.remove();
  }

  function nodeCount() {
    return countDescendants(layer);
  }

  return { update, destroy, nodeCount, builtNodes: () => state.builtNodes };
}
