// Boot, clock seam, URL contract, day change, scrubbing and mode crossfades.
//
// All time enters through missionTFromDate so tests can pin any instant with `now=`.
// Drawing modules never read this file: they consume Frames from buildFrame. Local
// storage holds only the two §9 keys, and every read is wrapped in try/catch.

import { missionTFromDate } from '../clock.js';
import { buildFrame } from '../render/frame.js';
import { smoothstep } from '../render/util.js';
import { VEHICLE_EVENT_OPS } from '../render/setpieces.js';
import { createScheduler } from './scheduler.js';
import {
  loadContent, dayRecord, currentBundle, isSealed, unlockUntil, unlockedThroughDay, DEFAULT_CONTENT,
} from './content.js';
import { createScene, breakpointOf } from './scene.js';

export const STORAGE_KEYS = Object.freeze({
  lastVisit: 'mission-clock:lastVisit',
  briefOpened: 'mission-clock:briefOpened',
});

const ALLOWED_KEYS = new Set(Object.values(STORAGE_KEYS));

export const TRANSITIONS = Object.freeze([
  { at: 7, durationMs: 1200 },
  { at: 340, durationMs: 8000 },
  { at: 364, durationMs: 1200 },
]);

export const ACT_DAYS = Object.freeze([0, 7, 340, 364, 365]);

export function readStorage(key, store) {
  if (!ALLOWED_KEYS.has(key)) return null;
  try {
    const s = store || globalThis.localStorage;
    if (!s) return null;
    return s.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key, value, store) {
  if (!ALLOWED_KEYS.has(key)) return false;
  try {
    const s = store || globalThis.localStorage;
    if (!s) return false;
    s.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function clampDayToToday(day, today) {
  const cap = Math.max(0, Math.min(365, Math.floor(Number(today))));
  const d = Math.floor(Number(day));
  if (!Number.isFinite(d)) return 0;
  if (!Number.isFinite(cap)) return 0;
  return Math.max(0, Math.min(d, cap));
}

export function parseMissionUrl(search, hash, { now = new Date() } = {}) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  let clock = now instanceof Date ? now : new Date(now);
  const nowParam = q.get('now');
  if (nowParam) {
    const parsed = new Date(nowParam);
    if (!Number.isNaN(+parsed)) clock = parsed;
  }
  const liveT = missionTFromDate(clock);
  const today = clampDayToToday(Math.floor(liveT), 365);

  const liveParam = q.get('live');
  let live = !(liveParam === '0' || liveParam === 'false');
  const tParam = q.get('t');
  let t;
  let pinned = false;
  if (tParam != null && tParam !== '') {
    const n = Number(tParam);
    t = Number.isFinite(n) ? n : liveT;
    pinned = true;
  } else if (!live) {
    t = today;
    pinned = true;
  } else {
    t = liveT;
  }

  const hashStr = String(hash || '');
  const dayMatch = hashStr.match(/day=(\d+)/);
  if (dayMatch) {
    t = clampDayToToday(Number(dayMatch[1]), today);
    live = false;
    pinned = true;
  }

  const contentParam = q.get('content');
  return {
    t,
    live,
    pinned,
    reducedMotion: q.get('motion') === 'off',
    dim: q.get('dim') === '1' || q.get('dim') === 'true',
    content: contentParam && /^[a-z0-9_-]+$/i.test(contentParam) ? contentParam : DEFAULT_CONTENT,
    nowParam: nowParam || null,
    clock,
    liveT,
    today,
  };
}

export function transitionFor(fromT, toT, { reducedMotion = false, loading = false } = {}) {
  if (reducedMotion || loading) return null;
  const from = Number(fromT);
  const to = Number(toT);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  for (const tr of TRANSITIONS) {
    if (from < tr.at && to >= tr.at) return { at: tr.at, durationMs: tr.durationMs };
  }
  return null;
}

function daysMeta() {
  const rows = [];
  for (let i = 0; i <= 365; i++) {
    const rec = dayRecord(i);
    const visuals = (rec && rec.visuals) || [];
    rows.push({
      event: visuals.some((v) => VEHICLE_EVENT_OPS.includes(v.op)),
      openInvestigation: !!(rec && rec.anomalyTicks && rec.anomalyTicks.length),
    });
  }
  return rows;
}

import { createArchive, archiveT } from '../render/archive.js';
import * as lightingForTests from '../render/lighting.js';
import * as scaleForTests from '../render/scale.js';
import { PALETTE as paletteForTests } from '../render/palette.js';

export async function boot(win = globalThis) {
  const doc = win.document;
  let settleReady;
  const ready = new Promise((resolve) => { settleReady = resolve; });
  const stats = { svgNodes: 0, liveMotes: 0, drawMs: 0 };
  const fpsWindow = [];
  // Read live rather than stored at draw time, so a hidden page reports 0 instead of the last
  // rate it drew at.
  Object.defineProperty(stats, 'fps', {
    enumerable: true,
    get: () => {
      const cutoff = nowFn() - 1000;
      while (fpsWindow.length && fpsWindow[0] < cutoff) fpsWindow.shift();
      return fpsWindow.length;
    },
  });
  Object.defineProperty(stats, 'targetFps', {
    enumerable: true,
    get: () => (doc.hidden || !scheduler ? 0 : scheduler.getRate()),
  });

  let scene = null;
  let archive = null;
  let scheduler = null;
  let following = true;
  let pinnedT = 0;
  let pinnedLive = true;
  let lastDay = null;
  let booted = false;
  let lastChromeMs = -Infinity;
  let trans = null;
  let url = parseMissionUrl(win.location.search, win.location.hash, { now: new Date() });
  let meta = [];

  // The test harness moves time forward through advance(); offsetMs shifts both the monotonic
  // clock the scheduler reads and the wall clock mission time comes from.
  let offsetMs = 0;
  const nowFn = () => offsetMs + (win.performance && typeof win.performance.now === 'function'
    ? win.performance.now()
    : Date.now());

  const wallDate = () => {
    if (url.nowParam) {
      const d = new Date(url.nowParam);
      if (!Number.isNaN(+d)) return new Date(+d + offsetMs);
    }
    return new Date(Date.now() + offsetMs);
  };

  const reducedMotion = () => {
    if (url.reducedMotion) return true;
    if (doc.documentElement && doc.documentElement.getAttribute('data-motion') === 'off') return true;
    try {
      return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  };

  const isDim = () => {
    if (url.dim) return true;
    return !!(doc.documentElement && doc.documentElement.getAttribute('data-gain') === 'dim');
  };

  const liveMissionT = () => missionTFromDate(wallDate());

  // The stage's aspect ratio decides where the bodies' anchors sit. Measured on boot and resize
  // only, so a frame never forces layout.
  let aspect = 16 / 9;
  const measureAspect = () => {
    const stage = doc.querySelector ? doc.querySelector('.stage') : null;
    const r = stage && stage.getBoundingClientRect ? stage.getBoundingClientRect() : null;
    if (r && r.width > 0 && r.height > 0) aspect = r.width / r.height;
  };

  const applyGoto = (t, opts = {}) => {
    if (t == null || t === '' || Number.isNaN(Number(t))) {
      following = true;
      pinnedLive = opts.live !== false;
    } else {
      following = false;
      pinnedT = Number(t);
      pinnedLive = !!opts.live;
    }
    if (scheduler) scheduler.touch();
    draw(nowFn());
  };

  const api = {
    ready,
    frame: null,
    stats,
    goto(t, opts) {
      return ready.then(() => applyGoto(t, opts));
    },
    // Test hooks for tools/browser: step simulated time, and the geometry helpers the visual
    // checks measure against.
    advance(ms) {
      offsetMs += Number(ms) || 0;
      draw(nowFn());
      return api.frame;
    },
    helpers: {
      terminatorMidpoint: lightingForTests.terminatorMidpoint,
      litFraction: lightingForTests.litFraction,
      discRadius: scaleForTests.discRadius,
      squeeze: scaleForTests.squeeze,
      EARTH_ANCHOR: scaleForTests.EARTH_ANCHOR,
      MOON_ANCHOR: scaleForTests.MOON_ANCHOR,
      PALETTE: paletteForTests,
    },
    loaded: null,
  };
  // What the seal has opened so far, for the Phase 7 sweep. Reports days, never content.
  Object.defineProperty(api, 'unlockedThrough', { enumerable: true, get: () => unlockedThroughDay() });
  api.hasDay = (i) => !!dayRecord(i) && dayRecord(i).day === Math.floor(Number(i));
  win.__missionClock = api;

  // A sealed bundle opens new days as the clock reaches them, including while the page is open
  // across Pacific midnight. One request per newly reached day; the redraw follows the open.
  let unlockAsked = -1;
  const maybeUnlock = (today) => {
    if (!isSealed() || today <= unlockedThroughDay() || today <= unlockAsked) return;
    unlockAsked = today;
    unlockUntil(wallDate()).then(() => {
      meta = daysMeta();
      draw(nowFn());
    }, (err) => console.error(err));
  };

  const draw = (nowMs) => {
    const t0 = nowFn();
    const liveT = liveMissionT();
    const today = clampDayToToday(Math.floor(liveT), 365);
    maybeUnlock(liveT < 0 ? -1 : today);
    let t;
    let live;
    if (following) {
      t = liveT;
      live = pinnedLive !== false;
    } else {
      t = pinnedT;
      live = pinnedLive;
    }
    const day = Math.floor(t);
    const rec = dayRecord(day);
    const rm = reducedMotion();
    const dim = isDim();

    const dayChanged = lastDay != null && day !== lastDay;
    if (following && booted && dayChanged) {
      const tr = transitionFor(lastDay, day, { reducedMotion: rm, loading: false });
      if (tr) {
        const fromRec = dayRecord(tr.at - 1e-6);
        trans = {
          fromFrame: buildFrame({
            t: tr.at - 1e-6,
            live: true,
            day: fromRec,
            reducedMotion: rm,
            dim,
            aspect,
          }),
          startMs: nowMs,
          durationMs: tr.durationMs,
        };
      }
    }
    lastDay = day;

    const frame = buildFrame({ t, live, day: rec, reducedMotion: rm, dim, aspect });
    api.frame = frame;
    if (archive) archive.update(frame);

    let mix = 1;
    let fromFrame = null;
    if (trans && !rm) {
      const u = (nowMs - trans.startMs) / trans.durationMs;
      mix = smoothstep(u);
      fromFrame = trans.fromFrame;
      if (u >= 1) {
        trans = null;
        mix = 1;
        fromFrame = null;
      }
    } else if (rm) {
      trans = null;
    }

    const chromeDue = !frame.live
      ? (lastChromeMs < 0 || dayChanged)
      : (nowMs - lastChromeMs >= 1000 || lastChromeMs < 0);
    if (chromeDue) lastChromeMs = nowMs;

    const width = (doc.documentElement && doc.documentElement.clientWidth) || (win.innerWidth) || 1600;
    if (scene) {
      scene.ctx.breakpoint = breakpointOf(width);
      scene.update(frame, nowMs, {
        fromFrame,
        mix,
        today,
        days: meta,
        act: ACT_DAYS,
        dayRecord: rec,
        updateChrome: chromeDue,
        breakpoint: scene.ctx.breakpoint,
      });
      if (scene.svg) stats.svgNodes = scene.svg.getElementsByTagName('*').length;
      stats.liveMotes = (scene.fx && scene.fx.liveMotes) || 0;
    }

    fpsWindow.push(nowMs);
    stats.drawMs = nowFn() - t0;

    if (doc.title != null && rec && rec.log && rec.log.title) doc.title = rec.log.title;
  };

  try {
    if (doc.documentElement) {
      if (url.reducedMotion) doc.documentElement.setAttribute('data-motion', 'off');
      if (url.dim) doc.documentElement.setAttribute('data-gain', 'dim');
    }

    writeStorage(STORAGE_KEYS.lastVisit, wallDate().toISOString());
    readStorage(STORAGE_KEYS.briefOpened);
    readStorage(STORAGE_KEYS.lastVisit);

    // Content and the scene's modules load concurrently; neither needs the other to start.
    const contentLoad = loadContent(url.content, { clock: wallDate }).catch((err) => {
      console.error(err);
    });

    following = !url.pinned;
    pinnedT = url.t;
    pinnedLive = url.live;

    const scenePromise = createScene(doc, {
      onScrub(day) {
        const today = clampDayToToday(Math.floor(liveMissionT()), 365);
        const d = clampDayToToday(day, today);
        following = false;
        pinnedT = d;
        pinnedLive = false;
        if (scheduler) scheduler.touch();
        try {
          const next = new URL(win.location.href);
          next.hash = 'day=' + String(d).padStart(3, '0');
          win.history.replaceState(null, '', next.pathname + next.search + next.hash);
        } catch {
          // replaceState can throw in some test documents; the pin still holds.
        }
        draw(nowFn());
      },
      // The ribbon's `today` control: back to the live clock, not a pin on today. The day
      // fragment goes with it, so a reload from here is live too.
      onLive() {
        following = true;
        pinnedLive = true;
        if (scheduler) scheduler.touch();
        try {
          const next = new URL(win.location.href);
          win.history.replaceState(null, '', next.pathname + next.search);
        } catch {
          // As above: following holds whether or not the address bar can be rewritten.
        }
        draw(nowFn());
      },
    });
    await contentLoad;
    meta = currentBundle().length ? daysMeta() : [];
    scene = await scenePromise;
    api.loaded = scene.loaded;

    // The archive (spec §7.3a) is a view of history, not a Frame drawing module, so it mounts
    // beside the scene rather than in the registry. It never offers a day beyond today, and
    // choosing a day pins the stage to that day's 18:00 Pacific archive pose.
    const todayIndex = () => clampDayToToday(Math.floor(liveMissionT()), 365);
    try {
      archive = createArchive(doc.body, {
        getDay: (i) => (i > todayIndex() ? null : dayRecord(i)),
        getToday: todayIndex,
        onSelectDay(day) {
          following = false;
          pinnedT = archiveT(clampDayToToday(day, todayIndex()));
          pinnedLive = false;
          if (scheduler) scheduler.touch();
          draw(nowFn());
        },
      });
    } catch (err) {
      console.error(err);
    }

    const dpr = (win.devicePixelRatio) || 1;
    measureAspect();
    scene.resize(win.innerWidth || 1600, win.innerHeight || 900, dpr);

    const raf = (cb) => win.requestAnimationFrame(cb);
    const caf = (id) => win.cancelAnimationFrame(id);
    scheduler = createScheduler({
      raf,
      caf,
      now: nowFn,
      hidden: () => !!(doc.hidden),
      onFrame: (t) => {
        draw(t);
        if (!booted) {
          booted = true;
          // Discs, vehicle and chrome are all on screen after this draw (spec §6.9 load order),
          // so it is the first meaningful paint the budget in §6.3.8 is measured against.
          try {
            win.performance.measure('first-meaningful-paint', { start: 0, end: win.performance.now() });
          } catch {
            // Older engines without measure options: the budget falls back to its own timing.
          }
          settleReady();
        }
      },
    });

    const touch = () => scheduler.touch();
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
      win.addEventListener(ev, touch, { passive: true });
    }
    doc.addEventListener('visibilitychange', () => scheduler.notifyVisibility());
    win.addEventListener('resize', () => {
      measureAspect();
      scene.resize(win.innerWidth || 1600, win.innerHeight || 900, win.devicePixelRatio || 1);
      draw(nowFn());
    });
    win.addEventListener('hashchange', () => {
      url = parseMissionUrl(win.location.search, win.location.hash, { now: wallDate() });
      if (/day=\d+/.test(String(win.location.hash || ''))) {
        following = false;
        pinnedT = url.t;
        pinnedLive = false;
        draw(nowFn());
      }
    });

    scheduler.start();
    if (!booted) {
      // Hidden at boot: still resolve so tests and the harness are not stuck.
      booted = true;
      settleReady();
    }
  } catch (err) {
    console.error(err);
    settleReady();
  }

  return api;
}

if (typeof window !== 'undefined' && window.document && window.document.getElementById('scene')) {
  boot(window).catch((err) => console.error(err));
}
