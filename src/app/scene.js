// Composition of the drawing modules onto the §6.1 layer tree.
//
// Other tasks own earth, moon, vehicle, fx, vocabulary, ribbon and chrome, and they
// land in parallel. Each factory is loaded with a dynamic import in a try so a missing
// file becomes a no-op stub; `loaded` records which ones actually arrived. Modules
// consume Frames and never read the clock.

import { el, setAttrs, fmt } from '../render/util.js';

export const MODULE_REGISTRY = [
  { key: 'fx', url: '../render/fx.js', exportName: 'createFx', kind: 'fx' },
  { key: 'earth', url: '../render/earth.js', exportName: 'createEarth', kind: 'layer', layerId: 'earth' },
  { key: 'moon', url: '../render/moon.js', exportName: 'createMoon', kind: 'layer', layerId: 'moon' },
  { key: 'anomaly', url: '../render/vocabulary.js', exportName: 'createAnomalyLayer', kind: 'layer', layerId: 'anomaly' },
  { key: 'vehicle', url: '../render/vehicle.js', exportName: 'createVehicle', kind: 'layer', layerId: 'vehicle' },
  { key: 'ribbon', url: '../render/ribbon.js', exportName: 'createRibbon', kind: 'ribbon' },
  { key: 'chrome', url: '../render/chrome.js', exportName: 'createChrome', kind: 'chrome' },
];

const noopModule = () => ({ update() {}, destroy() {} });

function stubFx(canvas) {
  return {
    resize(clientW, clientH, dpr) {
      if (!canvas) return;
      const w = Math.max(1, Math.round(Number(clientW) * Number(dpr || 1)) || 1);
      const h = Math.max(1, Math.round(Number(clientH) * Number(dpr || 1)) || 1);
      canvas.width = w;
      canvas.height = h;
    },
    queue() {},
    draw() {},
    emit() {},
    regolithPattern() { return null; },
    destroy() {},
  };
}

export const STUBS = {
  fx: stubFx,
  earth: noopModule,
  moon: noopModule,
  anomaly: noopModule,
  vehicle: noopModule,
  ribbon: noopModule,
  chrome: noopModule,
};

export function breakpointOf(widthPx) {
  const w = Number(widthPx) || 0;
  if (w >= 1440) return 'xl';
  if (w >= 1100) return 'lg';
  if (w >= 800) return 'md';
  if (w >= 600) return 'sm';
  return 'xs';
}

export async function resolveModules(load = (url) => import(url)) {
  const factories = {};
  const loaded = {};
  // Imported in parallel: awaiting them one by one cost first paint a request round-trip each.
  const results = await Promise.all(MODULE_REGISTRY.map(async (entry) => {
    try {
      const mod = await load(entry.url);
      const candidate = mod && mod[entry.exportName];
      return typeof candidate === 'function' ? candidate : null;
    } catch {
      // A missing or broken module falls back to its stub so the shell still boots.
      return null;
    }
  }));
  MODULE_REGISTRY.forEach((entry, i) => {
    const ok = typeof results[i] === 'function';
    factories[entry.key] = ok ? results[i] : STUBS[entry.key];
    loaded[entry.key] = ok;
  });
  return { factories, loaded };
}

function makeLayer(factories, key, node, ctx) {
  try {
    return factories[key](node, ctx) || STUBS[key](node, ctx);
  } catch {
    return STUBS[key](node, ctx);
  }
}

export async function createScene(doc, { onScrub, onLive } = {}, load) {
  const { factories, loaded } = await resolveModules(load);
  const svg = doc.getElementById('scene');
  const canvas = doc.getElementById('fx');
  const frontCanvas = doc.getElementById('fx-front');
  const hud = doc.querySelector('.hud');
  const ribbonEl = doc.querySelector('.ribbon');
  let defs = svg ? svg.querySelector('defs') : null;
  if (svg && !defs) defs = el('defs', {}, svg);

  const fx = (() => {
    try {
      return factories.fx(canvas, frontCanvas) || STUBS.fx(canvas);
    } catch {
      return STUBS.fx(canvas);
    }
  })();

  const ctx = {
    svg,
    defs,
    fx,
    breakpoint: 'xl',
  };

  const earthG = doc.getElementById('earth');
  const moonG = doc.getElementById('moon');
  const anomalyG = doc.getElementById('anomaly');
  const vehicleG = doc.getElementById('vehicle');

  const earth = makeLayer(factories, 'earth', earthG, ctx);
  const moon = makeLayer(factories, 'moon', moonG, ctx);
  const anomaly = makeLayer(factories, 'anomaly', anomalyG, ctx);
  const vehicle = makeLayer(factories, 'vehicle', vehicleG, ctx);

  let ribbon;
  try {
    // onLive is passed through only when the shell offers one, so the ribbon keeps its own
    // fallback (scrub to today) in the demos and tests that mount it alone.
    ribbon = factories.ribbon(ribbonEl, { onScrub: onScrub || (() => {}), onLive }) || STUBS.ribbon();
  } catch {
    ribbon = STUBS.ribbon();
  }

  let chrome;
  try {
    chrome = factories.chrome(doc.body || hud) || STUBS.chrome();
  } catch {
    chrome = STUBS.chrome();
  }

  // Second posed copy of the four scene groups, built when a mode crossfade starts and torn
  // down when it ends. It doubles the scene, so it must not exist for the rest of the year.
  let fadeRoot = null;
  let fadeEarth = noopModule();
  let fadeMoon = noopModule();
  let fadeAnomaly = noopModule();
  let fadeVehicle = noopModule();
  const buildFade = () => {
    fadeRoot = el('g', { id: 'crossfade', 'pointer-events': 'none' }, svg);
    fadeEarth = makeLayer(factories, 'earth', el('g', { id: 'earth-fade' }, fadeRoot), ctx);
    fadeMoon = makeLayer(factories, 'moon', el('g', { id: 'moon-fade' }, fadeRoot), ctx);
    fadeAnomaly = makeLayer(factories, 'anomaly', el('g', { id: 'anomaly-fade' }, fadeRoot), ctx);
    fadeVehicle = makeLayer(factories, 'vehicle', el('g', { id: 'vehicle-fade' }, fadeRoot), ctx);
  };
  const dropFade = () => {
    if (!fadeRoot) return;
    for (const mod of [fadeEarth, fadeMoon, fadeAnomaly, fadeVehicle]) {
      if (mod && typeof mod.destroy === 'function') mod.destroy();
    }
    fadeEarth = fadeMoon = fadeAnomaly = fadeVehicle = noopModule();
    if (fadeRoot.parentNode) fadeRoot.parentNode.removeChild(fadeRoot);
    fadeRoot = null;
  };

  // While chrome.js is absent, keep a one-line day label so the shell is readable.
  let fallback = null;
  if (!loaded.chrome && hud && hud.ownerDocument) {
    fallback = hud.ownerDocument.createElement('div');
    fallback.setAttribute('data-fallback', 'chrome');
    fallback.style.cssText = [
      'position:absolute',
      'top:16px',
      'left:16px',
      'font:11px/1.3 "IBM Plex Mono",ui-monospace,monospace',
      'color:var(--bone, #C8C3B8)',
      'letter-spacing:0.06em',
      'font-variant-numeric:tabular-nums',
      'pointer-events:none',
    ].join(';');
    hud.appendChild(fallback);
  }

  const pose = (mod, frame, nowMs) => {
    if (mod && typeof mod.update === 'function') mod.update(frame, nowMs);
  };

  const destroyMod = (mod) => {
    if (mod && typeof mod.destroy === 'function') mod.destroy();
  };

  const setGroupOpacity = (node, value) => {
    if (!node) return;
    if (value == null || value >= 1) setAttrs(node, { opacity: null });
    else setAttrs(node, { opacity: fmt(value) });
  };

  return {
    loaded,
    ctx,
    fx,
    svg,
    resize(widthPx, heightPx, dpr) {
      const w = widthPx != null ? widthPx : (doc.documentElement && doc.documentElement.clientWidth) || 1600;
      ctx.breakpoint = breakpointOf(w);
      if (typeof fx.resize === 'function') {
        const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: w, height: heightPx || 900 };
        fx.resize(rect.width || w, rect.height || heightPx || 900, dpr || 1);
      }
    },
    update(frame, nowMs, extra = {}) {
      ctx.breakpoint = extra.breakpoint || ctx.breakpoint;
      const mix = extra.mix == null ? 1 : extra.mix;
      const fromFrame = extra.fromFrame;
      const cross = fromFrame && mix < 1 && svg;

      if (svg) {
        setAttrs(svg, {
          'data-day': String(frame.day),
          'data-mode': frame.mode,
          'data-live': frame.live ? '1' : '0',
        });
      }

      pose(earth, frame, nowMs);
      pose(moon, frame, nowMs);
      pose(anomaly, frame, nowMs);
      pose(vehicle, frame, nowMs);

      if (cross) {
        if (!fadeRoot) buildFade();
        setGroupOpacity(earthG, mix);
        setGroupOpacity(moonG, mix);
        setGroupOpacity(anomalyG, mix);
        setGroupOpacity(vehicleG, mix);
        setAttrs(fadeRoot, { opacity: fmt(1 - mix) });
        pose(fadeEarth, fromFrame, nowMs);
        pose(fadeMoon, fromFrame, nowMs);
        pose(fadeAnomaly, fromFrame, nowMs);
        pose(fadeVehicle, fromFrame, nowMs);
      } else if (fadeRoot) {
        setGroupOpacity(earthG, 1);
        setGroupOpacity(moonG, 1);
        setGroupOpacity(anomalyG, 1);
        setGroupOpacity(vehicleG, 1);
        dropFade();
      }

      if (typeof fx.draw === 'function') fx.draw(frame, nowMs);

      if (ribbon && typeof ribbon.update === 'function') {
        ribbon.update(frame, {
          today: extra.today,
          days: extra.days,
          act: extra.act,
        });
      }

      if (extra.updateChrome !== false && chrome && typeof chrome.update === 'function') {
        chrome.update(frame, extra.dayRecord, ctx);
      }
      if (fallback) {
        const rec = extra.dayRecord;
        const title = rec && rec.log && rec.log.title ? rec.log.title : '';
        fallback.textContent = title ? `${title}  ${frame.mode}` : String(frame.day);
      }
    },
    destroy() {
      destroyMod(earth);
      destroyMod(moon);
      destroyMod(anomaly);
      destroyMod(vehicle);
      dropFade();
      destroyMod(ribbon);
      destroyMod(chrome);
      destroyMod(fx);
      if (fallback && fallback.parentNode) fallback.parentNode.removeChild(fallback);
    },
  };
}
