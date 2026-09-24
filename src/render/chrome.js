// Page chrome: telemetry corners, the log column, reading view, settings and
// the mission-brief marker. These sit in front of the stage and never draw
// the scene. Values come from a Frame; this module does not read the clock
// or the physics table itself.
//
// Telemetry holds the §7.4 set through day 339, re-bases at the Moon
// reference, gains thrust hours from day 347, then swaps to a descent set
// and a three-line monument set. Numbers snap; they never roll.
//
// The overlay log lives in the lower right, top at 40% of the stage, so the
// Moon's upper-right quarter stays clear through the tableau (days 7–339); the
// top is the same on every day. Owner, 2026-09-14 (third pass): the column is one
// scroll region at every width, in a fixed order that ends with the reference note
// line, with a soft fade and a label-style cue at the fold naming what lies below.

import { heroLayout } from './scale.js';
import { sliceTransform } from './project.js';
import { renderMarks } from './marks.js';

const THIN = '\u202f';
const CARD_POOL = 8;
const ANOMALY_POOL = 4;
const LINE_POOL = 7;

export const SETTINGS = ['gain', 'type', 'motion'];
// Entries a reader has opened, so the reference note stops breathing for good (§6.7.3).
export const REFERENCE_STORAGE_KEY = 'mission-clock:referenceOpened';
export const LOG_TOP_FRAC = 0.4;
export const LOG_INSET_PX = 16;
// Target measures (owner, 2026-09-14: wider for reading, about 70–78 characters a line).
export const LOG_WIDTH_REM = { xl: 34, lg: 30, md: 26, sm: 0, xs: 0 };
export const OVERLAY_RIBBON_PX = 92;
const REM_PX = 16;
// §7.6: the column never overlaps the ship rail. The ship sits at the stage centre at most
// (descent), drawn at 1.4 × the band's wingspan × the stage's slice scale, max(w/1600, h/900).
// Half of that, as vw and vh coefficients rounded up, is what tokens.css subtracts, beside a
// 16px inset and a 16px clearance: width = min(target, 50vw − 32px − max(a·vw, b·vh)).
export const LOG_RAIL = {
  xl: { vw: 3.15, vh: 5.6 },
  lg: { vw: 2.8, vh: 5 },
  md: { vw: 2.45, vh: 4.4 },
};

// Available height is the overlay column's inner box after the 40% top, at the
// reference viewport for each band (xl 1440×900, lg 1100×800, md 800×1000).
// Quiet/event heights are the §7.3 measurements at 16px body in the first-build columns
// (28/24/22 rem), carried through the 17px/32-26-22rem build and rescaled here to the body
// size (height ∝ size²: 18px at xl) and the rail-limited widths at each reference viewport
// (∝ 1/width: 544px, 478px, 324px).
const FIT = {
  xl: { available: 453, quiet: [185, 457], event: [264, 751] },
  lg: { available: 393, quiet: [185, 517], event: [264, 840] },
  md: { available: 513, quiet: [185, 745], event: [264, 1206] },
  sm: { available: 330, quiet: [185, 673], event: [264, 1089] },
  xs: { available: 330, quiet: [185, 673], event: [264, 1089] },
};

export function breakpointFromWidth(width) {
  const w = Number(width);
  if (w >= 1440) return 'xl';
  if (w >= 1100) return 'lg';
  if (w >= 800) return 'md';
  if (w >= 600) return 'sm';
  return 'xs';
}

export function overlayLog(breakpoint) {
  const bp = breakpoint || 'xl';
  return bp === 'xl' || bp === 'lg' || bp === 'md';
}

export function stageBox(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (w < 600) {
    return { x: 0, y: 0, w, h: Math.max(Math.min(0.52 * h, 420), 280) };
  }
  if (w < 800) {
    return { x: 0, y: 0, w, h: Math.min(0.58 * h, 520) };
  }
  return { x: 0, y: 0, w, h: h - OVERLAY_RIBBON_PX };
}

// The overlay column's width for a viewport, as tokens.css computes it. 0 below 800px.
export function logColumnWidth(width, height) {
  const w = Number(width);
  const h = Number(height);
  const bp = breakpointFromWidth(w);
  if (!overlayLog(bp)) return 0;
  const rail = LOG_RAIL[bp];
  const clear = Math.max((rail.vw * w) / 100, (rail.vh * h) / 100);
  return Math.min(LOG_WIDTH_REM[bp] * REM_PX, w / 2 - 2 * LOG_INSET_PX - clear);
}

// The cue at the fold (owner, 2026-09-14). `parts` are the scroll region's visible blocks in
// order, { kind, name, bottom } with bottoms in the same coordinates as `fold`. Whatever ends
// below the fold is named: report sections by name after `report`, the closed disclosure only
// when no open section is below; every other kind by its name. Empty when nothing is below.
// { compact: true } drops the section names, for a line too narrow to hold them.
export function scrollCue(parts, fold, opts = {}) {
  const below = (Array.isArray(parts) ? parts : []).filter((p) => p && Number(p.bottom) > Number(fold) + 0.5);
  if (!below.length) return '';
  const segments = [];
  let report = null;
  for (const p of below) {
    if (p.kind === 'report' || p.kind === 'more') {
      if (!report) {
        report = { open: [], more: [] };
        segments.push(report);
      }
      (p.kind === 'report' ? report.open : report.more).push(p.name);
    } else {
      segments.push(String(p.name));
    }
  }
  const text = segments.map((seg) => {
    if (typeof seg === 'string') return seg;
    return opts && opts.compact ? 'report' : `report · ${(seg.open.length ? seg.open : seg.more).join(', ')}`;
  });
  return `${text.join(' · ')} ↓`;
}

export function logBox(width, height) {
  const w = Number(width);
  const h = Number(height);
  const stage = stageBox(w, h);
  const bp = breakpointFromWidth(w);
  if (!overlayLog(bp)) {
    const leftover = Math.max(0, h - stage.h - (w < 600 ? 56 : 64));
    return { x: 0, y: stage.h, w, h: leftover };
  }
  const colW = logColumnWidth(w, h);
  const top = stage.y + LOG_TOP_FRAC * stage.h;
  return {
    x: stage.x + stage.w - LOG_INSET_PX - colW,
    y: top,
    w: colW,
    h: stage.y + stage.h - top,
  };
}

export function moonScreenRect(s, width, height) {
  const layout = heroLayout(s);
  const m = layout.moon;
  const stage = stageBox(width, height);
  const T = sliceTransform(stage.w, stage.h);
  return {
    x: T.dx + (m.cx - m.r) * T.scale,
    y: T.dy + (m.cy - m.r) * T.scale,
    w: 2 * m.r * T.scale,
    h: 2 * m.r * T.scale,
    visible: !!m.visible,
  };
}

export function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function estimateEntryHeight(words, breakpoint) {
  const row = FIT[breakpoint] || FIT.md;
  const n = Number(words);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const [w0, h0] = row.quiet;
  const [w1, h1] = row.event;
  return h0 + ((n - w0) / (w1 - w0)) * (h1 - h0);
}

export function fitsEntry(words, breakpoint) {
  const row = FIT[breakpoint] || FIT.md;
  return estimateEntryHeight(words, breakpoint) <= row.available + 1e-6;
}

export function wordCount(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  return s.split(/\s+/).length;
}

function groupInt(n) {
  const sign = n < 0 ? '-' : '';
  const s = String(Math.abs(Math.round(n)));
  return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

function formatKm(km) {
  const x = Number(km);
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 100) return `${groupInt(x)} km`;
  if (a >= 10) return `${x.toFixed(1)} km`;
  if (a >= 1) return `${x.toFixed(2)} km`;
  return `${groupInt(x * 1000)} m`;
}

function formatSpeed(ms) {
  const x = Number(ms);
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 100) return `${(x / 1000).toFixed(2)} km/s`;
  if (a >= 10) return `${x.toFixed(1)} m/s`;
  return `${x.toFixed(2)} m/s`;
}

function formatDv(ms) {
  const x = Number(ms);
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 100) return `${(x / 1000).toFixed(2)} km/s`;
  return `${Math.round(x)} m/s`;
}

function formatDuration(days) {
  const x = Number(days);
  if (!Number.isFinite(x) || x <= 0) return '0 d';
  if (x >= 2) return `${Math.round(x)}${THIN}d`;
  const hours = x * 24;
  if (hours >= 2) return `${hours.toFixed(1)}${THIN}h`;
  const minutes = hours * 60;
  if (minutes >= 2) return `${Math.round(minutes)}${THIN}min`;
  return `${Math.round(minutes * 60)}${THIN}s`;
}

function formatPeriod(hours) {
  const x = Number(hours);
  if (!Number.isFinite(x) || x <= 0) return '—';
  if (x >= 24) return `${(x / 24).toFixed(1)}${THIN}d`;
  if (x >= 10) return `${x.toFixed(1)}${THIN}h`;
  return `${x.toFixed(2)}${THIN}h`;
}

function formatThrustHours(hours) {
  const x = Number(hours);
  if (!Number.isFinite(x) || x < 0) return '—';
  return `${groupInt(x)}${THIN}h`;
}

// Vertical speed stays in m/s and keeps its sign. One decimal below 100 m/s, integers above.
function formatVerticalSpeed(ms) {
  const x = Number(ms);
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) < 0.05) return `0.0 m/s`;
  if (Math.abs(x) >= 100) return `${Math.round(x)} m/s`;
  return `${x.toFixed(1)} m/s`;
}

// Descent / monument clocks: hours and minutes, then minutes and seconds under an hour.
function formatClock(days) {
  const x = Number(days);
  if (!Number.isFinite(x) || x <= 0) return `0${THIN}min 00${THIN}s`;
  const totalSec = Math.max(0, Math.round(x * 86400));
  if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `${h}${THIN}h ${String(m).padStart(2, '0')}${THIN}min`;
  }
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}${THIN}min ${String(s).padStart(2, '0')}${THIN}s`;
}

function applyBreakpoint(lines, breakpoint, compact) {
  const bp = breakpoint || 'xl';
  let out = lines.filter(Boolean);
  if (bp === 'md' || bp === 'sm' || bp === 'xs') {
    out = compact;
  } else if (bp === 'lg') {
    out = out.filter((row) => row.label !== 'phase');
  }
  // Chrome is capped at seven values. Phase is the first thing to go when tight (§7.6).
  if (out.length > 7) out = out.filter((row) => row.label !== 'phase');
  return out.slice(0, 7);
}

export function padDay(day) {
  const n = Math.max(0, Math.floor(Number(day) || 0));
  return String(n).padStart(3, '0');
}

function monumentLines(frame) {
  const s = frame && frame.state ? frame.state : {};
  const t = Number(s.t != null ? s.t : frame && frame.t);
  const since = Number.isFinite(t) ? Math.max(0, t - 365) : 0;
  return [
    { label: 'on the surface', value: '—' },
    { label: 'mission day', value: '365' },
    { label: 'time since contact', value: formatClock(since) },
  ];
}

function descentLines(frame, breakpoint) {
  const s = frame && frame.state ? frame.state : {};
  const alt = { label: 'altitude', value: formatKm(s.altitude) };
  const vs = { label: 'vertical speed', value: formatVerticalSpeed(s.verticalSpeed) };
  const vel = { label: 'velocity, moon', value: formatSpeed(s.velocity) };
  const dv = { label: 'delta-v remaining', value: formatDv(s.deltaVRemaining) };
  const ttc = { label: 'time to contact', value: formatClock(s.timeToTouchdown) };
  const phase = { label: 'phase', value: String(s.phaseLabel || '') };
  return applyBreakpoint(
    [alt, vs, vel, dv, ttc, phase],
    breakpoint,
    [alt, vs, vel],
  );
}

export function telemetryLines(frame, breakpoint) {
  const s = frame && frame.state ? frame.state : {};
  const mode = (frame && frame.mode) || s.mode;
  if (mode === 'monument') return monumentLines(frame);
  if (mode === 'descent') return descentLines(frame, breakpoint);

  const moonRef = s.referenceBody === 'Moon';
  const day = { label: 'mission day', value: padDay(frame && frame.day) };
  const rangeOrAlt = moonRef
    ? { label: 'altitude', value: formatKm(s.altitude) }
    : { label: 'range to moon', value: formatKm(s.rangeToMoon) };
  const periodHours = s.orbit && s.orbit.periodHours;
  const period = moonRef && periodHours != null
    ? { label: 'orbital period, lunar', value: formatPeriod(periodHours) }
    : null;
  const body = String(s.referenceBody || 'Earth').toLowerCase();
  const vel = { label: `velocity, ${body}`, value: formatSpeed(s.velocity) };
  const dv = { label: 'delta-v remaining', value: formatDv(s.deltaVRemaining) };
  const phase = { label: 'phase', value: String(s.phaseLabel || '') };
  const ttd = { label: 'time to touchdown', value: formatDuration(s.timeToTouchdown) };
  // Second escalation step: one extra line from day 347. Physics already freezes
  // the integral at jettison, so the printed number holds through parking orbit.
  const showThrust = Number(frame && frame.day) >= 347;
  const thrust = showThrust
    ? { label: 'thrust hours', value: formatThrustHours(s.thrustHours) }
    : null;

  const full = moonRef
    ? [day, rangeOrAlt, period, vel, dv, phase, ttd, thrust]
    : [day, rangeOrAlt, vel, dv, phase, ttd, thrust];
  // md (800–1099) still shows the extra line; it drops below 800px with the strip.
  const compact = showThrust && (breakpoint || 'xl') === 'md'
    ? [day, rangeOrAlt, vel, thrust]
    : [day, rangeOrAlt, vel];
  return applyBreakpoint(full, breakpoint, compact);
}

function h(tag, attrs, parent) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'hidden') node.hidden = !!v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (parent) parent.appendChild(node);
  return node;
}

function setText(node, text) {
  const next = text == null ? '' : String(text);
  if (node.textContent !== next) node.textContent = next;
}

function eventSections(record) {
  const log = record && record.log;
  if (!log) return null;
  if (log.sections && (log.sections.event || log.sections.action || log.sections.checks || log.sections.assessment)) {
    return {
      event: log.sections.event || '',
      action: log.sections.action || '',
      checks: log.sections.checks || '',
      assessment: log.sections.assessment || '',
    };
  }
  return null;
}

// Log and report text: inline marks (marks.js) plus the glossary underline on the first
// appearance of each taught term, in plain runs only. At most two terms, each once.
function fillTerms(target, text, terms) {
  const list = (Array.isArray(terms) ? terms.slice(0, 2) : []).filter((item) => item && item.term);
  const used = new Set();
  const onText = (parent, value) => {
    let remaining = value;
    for (;;) {
      let best = null;
      for (const item of list) {
        const word = String(item.term);
        if (used.has(word.toLowerCase())) continue;
        const idx = remaining.toLowerCase().indexOf(word.toLowerCase());
        if (idx >= 0 && (!best || idx < best.idx)) best = { idx, item, word };
      }
      if (!best) break;
      used.add(best.word.toLowerCase());
      if (best.idx > 0) parent.appendChild(document.createTextNode(remaining.slice(0, best.idx)));
      const mark = h('span', { className: 'term' });
      mark.textContent = remaining.slice(best.idx, best.idx + best.word.length);
      mark.setAttribute('data-def', String(best.item.def || ''));
      mark.tabIndex = 0;
      parent.appendChild(mark);
      remaining = remaining.slice(best.idx + best.word.length);
    }
    if (remaining) parent.appendChild(document.createTextNode(remaining));
  };
  renderMarks(target, text, { onText: list.length ? onText : null });
}

function cardLabel(card) {
  if (!card || !card.class || !card.severity || !card.time) return '';
  return `${card.class} · ${card.severity} · ${card.time}`;
}

// The day's encyclopedia entry, normalised: paragraphs split on blank lines.
function entryOf(record) {
  const raw = record && record.encyclopedia;
  const e = Array.isArray(raw) ? raw.find((x) => x && (x.title || x.body)) : raw;
  if (!e || !(e.title || e.body)) return null;
  const body = String(e.body || '');
  const source = String(e.source || e.attribution || e.credit || '');
  return {
    key: String(e.id || e.title || body.slice(0, 64)),
    sig: [e.id, e.title, body.length, source].join(' '),
    title: String(e.title || ''),
    paras: body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    source,
  };
}

function loadOpened(store) {
  try {
    const s = store || globalThis.localStorage;
    const raw = s ? s.getItem(REFERENCE_STORAGE_KEY) : null;
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveOpened(store, set) {
  try {
    const s = store || globalThis.localStorage;
    if (s) s.setItem(REFERENCE_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Private windows and blocked storage: the note still stops for this session.
  }
}

export function createChrome(root, opts = {}) {
  if (!root) throw new Error('createChrome requires a root element');
  const store = opts && opts.storage;

  const hud = root.querySelector('.hud') || h('div', { className: 'hud' }, root.querySelector('.stage') || root);
  const ribbon = root.querySelector('.ribbon') || h('div', { className: 'ribbon' }, root);
  const stage = root.querySelector('.stage');

  const left = h('div', { className: 'telemetry telemetry-l' }, hud);
  const right = h('div', { className: 'telemetry telemetry-r' }, hud);
  const strip = h('div', { className: 'telemetry-strip' }, root);

  function makeRows(parent, side) {
    const rows = [];
    for (let i = 0; i < LINE_POOL; i++) {
      const row = h('div', { className: 'telemetry-row', hidden: true }, parent);
      const lab = h('div', { className: 'label' }, row);
      const val = h('div', { className: 'value' }, row);
      rows.push({ row, lab, val, side });
    }
    return rows;
  }

  const leftRows = makeRows(left, 'l');
  const rightRows = makeRows(right, 'r');
  const stripRows = makeRows(strip, 's');

  const logCol = h('div', { className: 'log-column', id: 'log' }, stage || root);
  // The day's log. An open encyclopedia entry hides this and takes the column (§6.7.3).
  // One scroll region at every width, in a fixed order (owner, 2026-09-14): date kicker, cards,
  // day title and entry or report, figure, then the reference note line. Focusable so the
  // arrow keys, Page Down and Space scroll it.
  const logMain = h('div', { className: 'log-main', role: 'region', 'aria-label': 'daily log' }, logCol);
  logMain.tabIndex = 0;
  const anomalyBox = h('div', { className: 'log-anomaly', hidden: true }, logMain);
  const anomalyRows = [];
  for (let i = 0; i < ANOMALY_POOL; i++) {
    const row = h('div', { className: 'fault', hidden: true }, anomalyBox);
    anomalyRows.push(row);
  }

  const kicker = h('p', { className: 'label log-kicker' }, logMain);

  // Cards sit above the entry (owner, 2026-09-14): label line, title, body. Severity is
  // carried only by the word; nothing about a card's styling depends on it.
  const cardsBox = h('div', { className: 'log-cards', hidden: true }, logMain);
  const cardNodes = [];
  for (let i = 0; i < CARD_POOL; i++) {
    const card = h('article', { className: 'log-card', hidden: true }, cardsBox);
    const cl = h('p', { className: 'label card-label' }, card);
    const ct = h('h2', { className: 'card-title' }, card);
    const cb = h('div', { className: 'body card-body' }, card);
    cardNodes.push({ card, cl, ct, cb });
  }

  const title = h('h1', { className: 'log-title' }, logMain);
  const body = h('div', { className: 'log-body body' }, logMain);

  // The report (owner, 2026-09-14): no expanding controls. Every section renders open, in order,
  // and the reader reaches each one by scrolling.
  const REPORT = ['event', 'action', 'checks', 'assessment'];
  const reportSecs = REPORT.map((name) => {
    const wrap = h('section', { className: 'log-section', hidden: true }, logMain);
    const head = h('h2', { className: 'log-section-title', text: name }, wrap);
    const text = h('div', { className: 'log-section-body' }, wrap);
    return { name, wrap, head, text };
  });

  const figureSlot = h('div', { className: 'log-figure', hidden: true }, logMain);

  // One label-style line at the end of the log on a day with an encyclopedia entry: last in
  // the scroll region, never pinned.
  const refBtn = h('button', { className: 'label log-ref', type: 'button', hidden: true }, logMain);
  const refDot = h('span', { className: 'log-ref-dot', 'aria-hidden': 'true', text: '•', hidden: true }, refBtn);
  const refText = h('span', { className: 'log-ref-text' }, refBtn);

  // The cue at the fold, outside the scroller, naming what lies below. Shown only on overflow.
  const cue = h('p', { className: 'label log-cue', 'aria-hidden': 'true', hidden: true }, logCol);

  function entryView(parent, className) {
    const wrap = h('div', { className, hidden: true }, parent);
    const head = h('div', { className: 'log-ency-head' }, wrap);
    h('p', { className: 'label log-ency-kicker', text: 'reference note' }, head);
    const closeBtn = h('button', { className: 'label log-ency-close', type: 'button', text: 'close' }, head);
    const t = h('h1', { className: 'log-ency-title' }, wrap);
    const paras = h('div', { className: 'log-ency-body' }, wrap);
    const src = h('p', { className: 'log-ency-source', hidden: true }, wrap);
    return { wrap, closeBtn, t, paras, src };
  }

  const encyPanel = entryView(logCol, 'log-ency');
  encyPanel.wrap.tabIndex = 0;
  // Keep the cue after both scrollers so it always sits at the foot of the column.
  logCol.appendChild(cue);

  const brief = h('button', {
    className: 'brief-marker',
    type: 'button',
    text: 'brief',
  }, hud);
  brief.setAttribute('aria-disabled', 'true');

  const reading = h('div', { className: 'reading-view', hidden: true, role: 'dialog' }, root);
  reading.setAttribute('aria-label', 'reading view');
  const sheet = h('div', { className: 'reading-sheet' }, reading);
  // The reading view's only use: below 800px an opened entry shows here, with the same content
  // and close. The log itself has no reading view (owner, 2026-09-14).
  const readEncy = entryView(sheet, 'reading-ency');

  const settingsBtn = h('button', {
    className: 'settings-toggle',
    type: 'button',
    text: '…',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'aria-label': 'settings',
  }, ribbon);
  const panel = h('div', {
    className: 'settings-panel',
    hidden: true,
    role: 'dialog',
    'aria-label': 'settings',
  }, root);

  function settingRow(id, label) {
    const row = h('label', { className: 'settings-row' }, panel);
    h('span', { text: label }, row);
    const input = h('input', { type: 'checkbox', name: id }, row);
    input.setAttribute('data-setting', id);
    return input;
  }

  const gainInput = settingRow('gain', 'gain dim');
  const typeInput = settingRow('type', 'text size');
  const motionInput = settingRow('motion', 'reduced motion');

  const tip = h('div', { className: 'term-tip', hidden: true }, hud);

  const created = [
    left, right, strip, logCol, brief, reading, settingsBtn, panel, tip,
  ];
  if (logCol.parentNode === hud && stage && !stage.contains(hud)) {
    // hud already in the tree
  }

  const openedTerms = new Set();
  let lastKey = '';
  let lastFigureDay = null;
  let settingsOpen = false;
  let readingOpen = false;
  let destroyed = false;
  let lastBp = 'xl';
  let lastRecDay = null;
  let frameReduced = false;
  let entry = null;
  let entrySig = '';
  let encyOpen = false;
  // The log's scroll offset when an entry opened, restored on close (owner, 2026-09-14).
  let savedLogScroll = null;
  // Reaching the end of the day retires the cue until the day changes.
  let cueDone = false;
  const openedRefs = loadOpened(store);

  const host = () => document.documentElement || root;

  function motionReduced() {
    if (frameReduced) return true;
    for (const node of [host(), root]) {
      if (node && node.getAttribute && node.getAttribute('data-motion') === 'off') return true;
    }
    try {
      const w = typeof window !== 'undefined' ? window : null;
      return !!(w && typeof w.matchMedia === 'function' && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  function paintRef() {
    if (!entry) {
      refBtn.hidden = true;
      return;
    }
    // While the entry holds the column, the line goes with the log it sits beneath.
    refBtn.hidden = encyOpen && overlayLog(lastBp);
    setText(refText, `reference note · ${entry.title}`);
    const opened = openedRefs.has(entry.key);
    const steady = !opened && motionReduced();
    refBtn.classList.toggle('is-opened', opened);
    refBtn.classList.toggle('is-breathing', !opened && !steady);
    refBtn.classList.toggle('is-steady', steady);
    refDot.hidden = !steady;
  }

  function fillEntry(view) {
    setText(view.t, entry ? entry.title : '');
    while (view.paras.firstChild) view.paras.removeChild(view.paras.firstChild);
    for (const text of entry ? entry.paras : []) {
      h('p', { className: 'ency', text }, view.paras);
    }
    setText(view.src, entry ? entry.source : '');
    view.src.hidden = !(entry && entry.source);
  }

  function focusNode(node) {
    if (node && typeof node.focus === 'function') {
      try { node.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ }
    }
  }

  // Place an open entry for the current width: in the column at 800px and up, in the reading
  // view below it. A closed entry leaves both alone.
  function syncEncy() {
    const stacked = !overlayLog(lastBp);
    const inColumn = encyOpen && !stacked;
    logMain.hidden = inColumn;
    encyPanel.wrap.hidden = !inColumn;
    logCol.classList.toggle('log-ency-open', inColumn);
    if (encyOpen && stacked) {
      if (!readingOpen) setReadingOpen(true);
    } else if (readingOpen) {
      readingOpen = false;
      reading.hidden = true;
      logCol.style.visibility = '';
    }
  }

  function setEncyOpen(on) {
    const next = !!on && !!entry;
    if (next && !openedRefs.has(entry.key)) {
      openedRefs.add(entry.key);
      saveOpened(store, openedRefs);
    }
    const changed = next !== encyOpen;
    if (changed && next) savedLogScroll = Number(logMain.scrollTop) || 0;
    encyOpen = next;
    if (changed) encyPanel.wrap.scrollTop = 0;
    syncEncy();
    paintRef();
    if (changed && !next && savedLogScroll != null) {
      logMain.scrollTop = savedLogScroll;
      savedLogScroll = null;
    }
    if (changed) clipToColumn();
  }

  function openEncy() {
    setEncyOpen(true);
    if (!encyOpen) return;
    focusNode(overlayLog(lastBp) ? encyPanel.closeBtn : readEncy.closeBtn);
  }

  function closeEncy() {
    if (!encyOpen) return;
    setEncyOpen(false);
    focusNode(refBtn);
  }

  function applySettings() {
    const el = host();
    const gain = gainInput.checked ? 'dim' : null;
    const type = typeInput.checked ? 'loud' : null;
    const motion = motionInput.checked ? 'off' : null;
    for (const node of [el, root]) {
      if (!node || !node.setAttribute) continue;
      if (gain) node.setAttribute('data-gain', gain);
      else node.removeAttribute('data-gain');
      if (type) node.setAttribute('data-type', type);
      else node.removeAttribute('data-type');
      if (motion) node.setAttribute('data-motion', motion);
      else node.removeAttribute('data-motion');
    }
    paintRef();
  }

  function setSettingsOpen(on) {
    settingsOpen = !!on;
    panel.hidden = !settingsOpen;
    settingsBtn.setAttribute('aria-expanded', settingsOpen ? 'true' : 'false');
  }

  function setReadingOpen(on) {
    readingOpen = !!on;
    reading.hidden = !readingOpen;
    readEncy.wrap.hidden = !readingOpen;
    logCol.style.visibility = readingOpen ? 'hidden' : '';
    if (readingOpen) sheet.scrollTop = 0;
    // Every way out of the reading view (escape, tap outside, scrolling past the end, close)
    // also closes the entry shown there.
    if (!readingOpen && encyOpen) closeEncy();
  }

  function syncLogPlacement(bp) {
    const stacked = !overlayLog(bp);
    logCol.classList.toggle('log-stacked', stacked);
    if (stacked) {
      const host = (stage && stage.parentNode) || root;
      if (logCol.parentNode !== host || (stage && logCol.previousSibling !== stage)) {
        host.insertBefore(logCol, stage ? stage.nextSibling : null);
      }
    } else if (stage && logCol.parentNode !== stage) {
      stage.appendChild(logCol);
    }
  }

  function rectOf(node) {
    try {
      return node && typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
    } catch {
      return null;
    }
  }

  // The visible blocks of whichever region holds the column, in reading order.
  function cueParts(inEntry) {
    const list = inEntry
      ? [
        [encyPanel.paras, 'entry', 'entry'],
        [encyPanel.src, 'sources', 'sources'],
      ]
      : [
        [cardsBox, 'card', 'card'],
        [body, 'log', 'log'],
        ...reportSecs.map((s) => [s.wrap, 'report', s.name]),
        [figureSlot, 'figure', 'figure'],
        [refBtn, 'ref', 'reference note'],
      ];
    const out = [];
    for (const [node, kind, name] of list) {
      if (!node || node.hidden) continue;
      const r = rectOf(node);
      if (!r) continue;
      out.push({ kind, name, bottom: Number(r.bottom) || 0 });
    }
    return out;
  }

  function atEnd(scroller) {
    const sh = Number(scroller.scrollHeight) || 0;
    const ch = Number(scroller.clientHeight) || 0;
    return (Number(scroller.scrollTop) || 0) + ch >= sh - 2;
  }

  function paintCue(scroller, overflow, inEntry) {
    if (!overflow) {
      cue.hidden = true;
      return;
    }
    if (atEnd(scroller)) cueDone = true;
    const r = rectOf(scroller);
    const parts = r ? cueParts(inEntry) : [];
    const fold = r ? Number(r.bottom) || 0 : 0;
    let text = r ? scrollCue(parts, fold) : '';
    if (text) {
      setText(cue, text);
      cue.hidden = false;
      // One line, never an ellipsis: a narrow column gets the names-free form.
      if (Number(cue.scrollWidth) > Number(cue.clientWidth) + 1) {
        text = scrollCue(parts, fold, { compact: true });
        setText(cue, text);
      }
    }
    cue.hidden = !text && !cueDone;
    cue.classList.toggle('is-done', cueDone || !text);
  }

  function clipToColumn(estimatedFit) {
    // The text scrolls inside the log (or the open entry), not the column itself. A measured
    // layout wins; the fit estimate stands in only where nothing has been laid out.
    const inEntry = logMain.hidden && !encyPanel.wrap.hidden;
    const scroller = inEntry ? encyPanel.wrap : logMain;
    if (logMain.style) logMain.style.maxHeight = '';
    // Measure without the cue, so the cue is never the reason the day overflows.
    const cueWas = cue.hidden;
    cue.hidden = true;
    const sh = Number(scroller.scrollHeight) || 0;
    const ch = Number(scroller.clientHeight) || 0;
    // Below 800px the page scrolls instead (owner, 2026-09-14): never a clipped region there.
    const clipped = !overlayLog(lastBp) ? false : (ch > 0 ? sh > ch + 1 : estimatedFit === false);
    cue.hidden = cueWas;
    logCol.classList.toggle('log-clipped', clipped);
    if (clipped) logCol.setAttribute('data-clipped', '1');
    else logCol.removeAttribute('data-clipped');
    if (clipped && !inEntry) {
      // Settle against the region as it will stand, with the cue taking its line beneath it.
      cue.hidden = false;
      settleFold();
    }
    paintCue(scroller, clipped, inEntry);
  }

  // No heading left alone over the fade (owner, 2026-09-14, refined). Only a section heading or a
  // card label can be orphaned; the day title never is. A heading that shows at the fold with
  // fewer than two lines of its text above the fade keeps its place if at least half its first
  // line fits under the fade. If not, the region ends just above the heading, which goes below
  // the fold for the cue to name. The cue itself stays at the foot of the column (tokens.css),
  // so the most this leaves is a small band above the cue, never a large one below it.
  // Desktop only, at rest: it is settled when the day is laid out, not while scrolling.
  const FADE_PX = 32;
  const MIN_REGION_PX = 160;

  function lineHeightOf(node) {
    try {
      const v = parseFloat(getComputedStyle(node).lineHeight);
      if (v > 0) return v;
    } catch {
      // No layout (tests, or a detached node): a body line at 17-18px.
    }
    return 28;
  }

  function settleFold() {
    const mr = rectOf(logMain);
    if (!mr) return;
    const top = Number(mr.top) || 0;
    const bottom = Number(mr.bottom) || 0;
    const pairs = [];
    if (!cardsBox.hidden) {
      for (const n of cardNodes) if (!n.card.hidden) pairs.push([n.cl.hidden ? n.ct : n.cl, n.cb]);
    }
    for (const s of reportSecs) if (!s.wrap.hidden) pairs.push([s.head, s.text]);
    for (const [hd, tx] of pairs) {
      const hr = rectOf(hd);
      const tr = rectOf(tx);
      if (!hr || !tr) continue;
      const headTop = Number(hr.top);
      const textTop = Number(tr.top);
      const line = lineHeightOf(tx);
      if (headTop >= bottom - 2) break;
      if (textTop + 2 * line <= bottom - FADE_PX + 0.5) continue;
      if (textTop + line / 2 <= bottom + 0.5) return;
      const cut = headTop - top;
      if (cut >= MIN_REGION_PX) logMain.style.maxHeight = `${Math.round(cut)}px`;
      return;
    }
  }

  function onRegionScroll() {
    if (destroyed) return;
    const inEntry = logMain.hidden && !encyPanel.wrap.hidden;
    const scroller = inEntry ? encyPanel.wrap : logMain;
    paintCue(scroller, logCol.classList.contains('log-clipped'), inEntry);
  }

  function paintLines(lines, bp) {
    const corners = bp === 'md' || bp === 'sm' || bp === 'xs';
    const split = corners ? lines.length : Math.ceil(lines.length / 2);
    const groups = [
      { rows: leftRows, items: lines.slice(0, split) },
      { rows: rightRows, items: corners ? [] : lines.slice(split) },
      { rows: stripRows, items: lines },
    ];
    for (const { rows, items } of groups) {
      for (let i = 0; i < rows.length; i++) {
        const item = items[i];
        const slot = rows[i];
        if (!item) {
          slot.row.hidden = true;
          continue;
        }
        slot.row.hidden = false;
        setText(slot.lab, item.label);
        setText(slot.val, item.value);
      }
    }
  }

  function onKey(ev) {
    if (ev.key === 'Escape') {
      if (readingOpen) setReadingOpen(false);
      else if (encyOpen) closeEncy();
      else if (settingsOpen) setSettingsOpen(false);
    }
  }

  function onPointer(ev) {
    if (settingsOpen && !panel.contains(ev.target) && ev.target !== settingsBtn) {
      setSettingsOpen(false);
    }
    if (readingOpen && ev.target === reading) setReadingOpen(false);
  }

  function hideTip() { tip.hidden = true; }

  function showTip(from) {
    const def = from.getAttribute('data-def');
    if (!def) return;
    const key = from.textContent.toLowerCase();
    openedTerms.add(key);
    from.style.borderBottomColor = 'transparent';
    setText(tip, def);
    tip.hidden = false;
    const r = from.getBoundingClientRect ? from.getBoundingClientRect() : { left: 0, bottom: 0 };
    const hostR = hud.getBoundingClientRect ? hud.getBoundingClientRect() : { left: 0, top: 0 };
    tip.style.left = `${Math.max(8, r.left - hostR.left)}px`;
    tip.style.top = `${r.bottom - hostR.top + 6}px`;
  }

  function onTerm(ev) {
    const t = ev.target && ev.target.closest ? ev.target.closest('.term') : null;
    if (!t) {
      if (ev.type === 'click') hideTip();
      return;
    }
    if (ev.type === 'mouseover' || ev.type === 'focusin' || ev.type === 'click') showTip(t);
    if (ev.type === 'mouseout' || ev.type === 'focusout') hideTip();
  }

  function onReadScroll() {
    if (!readingOpen) return;
    if (sheet.scrollTop + sheet.clientHeight >= sheet.scrollHeight - 8) setReadingOpen(false);
  }

  function onResize() {
    if (destroyed) return;
    const width = root.clientWidth || (typeof window !== 'undefined' && window.innerWidth) || 1440;
    const bp = breakpointFromWidth(width);
    lastBp = bp;
    syncLogPlacement(bp);
    syncEncy();
    clipToColumn();
  }

  settingsBtn.addEventListener('click', () => setSettingsOpen(!settingsOpen));
  gainInput.addEventListener('change', applySettings);
  typeInput.addEventListener('change', applySettings);
  motionInput.addEventListener('change', applySettings);
  refBtn.addEventListener('click', openEncy);
  encyPanel.closeBtn.addEventListener('click', closeEncy);
  readEncy.closeBtn.addEventListener('click', () => setReadingOpen(false));
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', onResize);
  }
  logMain.addEventListener('scroll', onRegionScroll);
  encyPanel.wrap.addEventListener('scroll', onRegionScroll);
  // Web fonts that arrive after the first layout move every line; measure the fold again then.
  const onFonts = () => { if (!destroyed) clipToColumn(); };
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (fonts) {
    if (fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(onFonts, () => {});
    if (typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', onFonts);
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer);
  logCol.addEventListener('mouseover', onTerm);
  logCol.addEventListener('mouseout', onTerm);
  logCol.addEventListener('focusin', onTerm);
  logCol.addEventListener('focusout', onTerm);
  logCol.addEventListener('click', onTerm);
  sheet.addEventListener('scroll', onReadScroll);

  function update(frame, dayRecord, ctx) {
    if (destroyed) return;
    const bp = (ctx && ctx.breakpoint) || breakpointFromWidth(root.clientWidth || (typeof window !== 'undefined' && window.innerWidth) || 1440);
    const lines = telemetryLines(frame, bp);
    const rec = dayRecord || null;
    const archive = !!(ctx && ctx.archive);
    const key = [
      frame && frame.day,
      frame && frame.t,
      bp,
      lines.map((l) => l.value).join(';'),
      rec && rec.day,
      rec && rec.log && rec.log.title,
      archive ? 'a' : 'l',
    ].join('|');
    paintLines(lines, bp);
    syncLogPlacement(bp);
    frameReduced = !!(frame && frame.reducedMotion);
    if (bp !== lastBp) {
      lastBp = bp;
      syncEncy();
    }
    if (key === lastKey) {
      paintRef();
      clipToColumn();
      return;
    }
    lastKey = key;
    const recDay = rec ? rec.day : null;
    if (recDay !== lastRecDay) {
      lastRecDay = recDay;
      logMain.scrollTop = 0;
      savedLogScroll = null;
      cueDone = false;
    }

    const log = rec && rec.log;
    setText(kicker, (rec && rec.date) || '');
    setText(title, (log && log.title) || '');
    const terms = rec && rec.terms;
    const sections = eventSections(rec);
    const ticks = (rec && rec.anomalyTicks) || [];

    anomalyBox.hidden = ticks.length === 0;
    for (let i = 0; i < anomalyRows.length; i++) {
      const tick = ticks[i];
      anomalyRows[i].hidden = !tick;
      setText(anomalyRows[i], tick ? tick.body : '');
    }

    body.hidden = !!sections;
    if (!sections) fillTerms(body, log && log.body, terms);
    for (const s of reportSecs) {
      s.wrap.hidden = !sections;
      if (sections) fillTerms(s.text, sections[s.name], terms);
    }

    const cards = (rec && rec.cards) || [];
    cardsBox.hidden = cards.length === 0;
    logCol.classList.toggle('log-has-cards', cards.length > 0);
    for (let i = 0; i < cardNodes.length; i++) {
      const c = cards[i];
      const label = cardLabel(c);
      cardNodes[i].card.hidden = !c;
      setText(cardNodes[i].cl, label);
      cardNodes[i].cl.hidden = !label;
      renderMarks(cardNodes[i].ct, c ? c.title : '', { paragraphs: false });
      renderMarks(cardNodes[i].cb, c ? c.body : '');
    }

    const nextEntry = entryOf(rec);
    const nextSig = nextEntry ? nextEntry.sig : '';
    if (nextSig !== entrySig) {
      if (encyOpen) setEncyOpen(false);
      entry = nextEntry;
      entrySig = nextSig;
      fillEntry(encyPanel);
      fillEntry(readEncy);
    }
    paintRef();

    const fig = rec && rec.figure;
    if (fig && ctx && typeof ctx.renderFigure === 'function') {
      if (lastFigureDay !== (frame && frame.day)) {
        while (figureSlot.firstChild) figureSlot.removeChild(figureSlot.firstChild);
        const node = ctx.renderFigure(fig, logCol.clientWidth || 280);
        if (node) figureSlot.appendChild(node);
        lastFigureDay = frame && frame.day;
      }
      figureSlot.hidden = !figureSlot.firstChild;
    } else {
      figureSlot.hidden = true;
    }

    // The default state is everything: cards and the whole report or entry.
    const cardWords = cards.reduce((n, c) => n + wordCount(c && c.body), 0);
    const visibleWords = cardWords + (sections
      ? REPORT.reduce((n, name) => n + wordCount(sections[name]), 0)
      : wordCount(log && log.body));
    clipToColumn(fitsEntry(visibleWords, bp));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer);
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('resize', onResize);
    }
    for (const node of created) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
  }

  // Start from what is already on the page (a URL flag such as ?dim=1 or ?motion=off sets these
  // before the chrome exists), so the first apply does not wipe it.
  {
    const el = host();
    if (el && el.getAttribute) {
      gainInput.checked = el.getAttribute('data-gain') === 'dim';
      typeInput.checked = el.getAttribute('data-type') === 'loud';
      motionInput.checked = el.getAttribute('data-motion') === 'off';
    }
  }
  applySettings();
  return { update, destroy };
}
