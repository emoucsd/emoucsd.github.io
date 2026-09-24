// Archive view (system spec §7.3a): a first-class reading of every day from
// launch through today. The log column is a glance; this is for sitting down
// with. It is what the piece becomes after touchdown (§12).
//
// This module may read the physics table because it is a view of history, not
// a scene drawing. It never interprets content strings as markup.

import { state, PHASES } from '../physics.js';
import { missionTAtPacificClock, pacificStamp } from '../clock.js';
import { renderFigure } from './figures.js';
import { renderMarks } from './marks.js';

export const MAX_DAY_BLOCKS = 30;
export const ARCHIVE_HOUR = 18;
export const ROW_ESTIMATE = 360;

const SECTION_NAMES = ['event', 'action', 'checks', 'assessment'];

export function clampToday(today) {
  const n = Math.floor(Number(today));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(365, n));
}

export function padDay(day) {
  const n = Math.max(0, Math.floor(Number(day) || 0));
  return String(n).padStart(3, '0');
}

// Archive stills freeze at 18:00 Pacific so a day has one comparable pose.
export function archiveT(day) {
  const d = Math.max(0, Math.floor(Number(day) || 0));
  return missionTAtPacificClock(d, ARCHIVE_HOUR, 0);
}

export function phaseLabelForDay(day) {
  try {
    return state(archiveT(day)).phaseLabel;
  } catch {
    return '';
  }
}

// First mission-day index of each phase that has begun by today. A phase that
// occupies only a few hours still appears, jumping to the day that contains it.
export function phaseStarts(today) {
  const cap = clampToday(today);
  const horizon = cap + 1;
  const out = [];
  let startT = 0;
  for (const p of PHASES) {
    if (startT >= horizon) break;
    const day = Math.max(0, Math.min(cap, Math.floor(startT)));
    out.push({ id: p.id, label: p.label, day, t: startT });
    startT = p.end;
    if (!Number.isFinite(startT)) break;
  }
  return out;
}

export function windowBounds({ today, anchorDay, size, align } = {}) {
  const cap = clampToday(today);
  const n = Math.max(1, Math.min(MAX_DAY_BLOCKS, Number(size) || MAX_DAY_BLOCKS, cap + 1));
  if (cap + 1 <= n) return { start: 0, end: cap };
  const anchor = Math.max(0, Math.min(cap, Math.floor(Number(anchorDay) || 0)));
  let start = align === 'start' ? anchor : anchor - Math.floor(n / 2);
  start = Math.max(0, Math.min(start, cap - n + 1));
  return { start, end: Math.min(cap, start + n - 1) };
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

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function eventSections(record) {
  const log = record && record.log;
  if (!log || !log.sections) return null;
  const s = log.sections;
  if (s.event || s.action || s.checks || s.assessment) {
    return {
      event: s.event || '',
      action: s.action || '',
      checks: s.checks || '',
      assessment: s.assessment || '',
    };
  }
  return null;
}

function isoDate(record, day) {
  if (record && record.date) return String(record.date);
  try {
    return pacificStamp(archiveT(day)).slice(0, 10);
  } catch {
    return '';
  }
}

export function createArchive(root, opts = {}) {
  if (!root) throw new Error('createArchive requires a root element');

  const getDay = typeof opts.getDay === 'function' ? opts.getDay : () => null;
  const getToday = typeof opts.getToday === 'function' ? opts.getToday : () => 0;
  const onSelectDay = typeof opts.onSelectDay === 'function' ? opts.onSelectDay : () => {};

  const html = (typeof document !== 'undefined' && document.documentElement) || root;

  const control = h('button', {
    className: 'archive-marker',
    type: 'button',
    text: 'archive',
    'aria-expanded': 'false',
    'aria-controls': 'archive',
  });

  const archive = h('section', {
    className: 'archive',
    id: 'archive',
    hidden: true,
    role: 'region',
    'aria-label': 'archive',
  });
  archive.tabIndex = -1;

  const nav = h('nav', { className: 'archive-nav', 'aria-label': 'index' }, archive);
  h('p', { className: 'archive-nav-kicker label', text: 'phases' }, nav);
  const phasesBox = h('div', { className: 'archive-phases' }, nav);
  h('p', { className: 'archive-nav-kicker label', text: 'days' }, nav);
  const dayIndex = h('div', { className: 'archive-day-index' }, nav);

  const scroller = h('div', { className: 'archive-main' }, archive);
  const measure = h('div', { className: 'archive-measure' }, scroller);
  const spacerTop = h('div', { className: 'archive-spacer', 'aria-hidden': 'true' }, measure);
  const daysBox = h('div', { className: 'archive-days' }, measure);
  const spacerBottom = h('div', { className: 'archive-spacer', 'aria-hidden': 'true' }, measure);

  const created = [control, archive];
  root.appendChild(archive);
  root.appendChild(control);

  const heights = new Array(366);
  for (let i = 0; i < 366; i++) heights[i] = ROW_ESTIMATE;

  const pool = [];
  let openState = false;
  let destroyed = false;
  let lastKey = '';
  let navToday = -1;
  let winStart = 0;
  let winEnd = -1;
  let rebinding = false;
  let scrollLock = false;
  let io = null;

  function currentToday() {
    try {
      return clampToday(getToday());
    } catch {
      return 0;
    }
  }

  function heightAt(i) {
    const hgt = heights[i];
    return Number.isFinite(hgt) && hgt > 0 ? hgt : ROW_ESTIMATE;
  }

  function liveCount(cap) {
    return Math.min(MAX_DAY_BLOCKS, cap + 1);
  }

  function motionOff(frame) {
    if (frame && frame.reducedMotion) return true;
    if (html && html.getAttribute && html.getAttribute('data-motion') === 'off') return true;
    try {
      return !!(typeof window !== 'undefined'
        && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  function placeControl() {
    if (openState) {
      control.style.position = '';
      control.style.left = '';
      control.style.top = '';
      control.style.right = '';
      control.style.bottom = '';
      control.style.margin = '';
      return;
    }
    const brief = root.querySelector('.brief-marker')
      || (typeof document !== 'undefined' && document.querySelector
        ? document.querySelector('.brief-marker')
        : null);
    if (!brief || typeof brief.getBoundingClientRect !== 'function') return;
    const r = brief.getBoundingClientRect();
    if (!r) return;
    // Page coordinates, not the viewport: on phones the page scrolls (owner, 2026-09-14) and the
    // control must travel with the brief marker on the stage. The control lives on the body.
    const w = typeof window !== 'undefined' ? window : {};
    const sx = Number(w.scrollX ?? w.pageXOffset) || 0;
    const sy = Number(w.scrollY ?? w.pageYOffset) || 0;
    control.style.position = 'absolute';
    control.style.left = `${Math.round((r.right || 0) + sx + 8)}px`;
    control.style.top = `${Math.round((r.top || 0) + sy)}px`;
    control.style.right = 'auto';
    control.style.bottom = 'auto';
    // The phone stylesheet gives the control a margin; pinned beside the brief it would push the
    // label 8px lower than its neighbour.
    control.style.margin = '0';
  }

  function paintPhaseActive(anchorDay) {
    const label = phaseLabelForDay(anchorDay);
    const kids = phasesBox.children || [];
    for (let i = 0; i < kids.length; i++) {
      const btn = kids[i];
      const on = btn.textContent === label;
      if (btn.classList && btn.classList.toggle) btn.classList.toggle('is-active', on);
    }
  }

  function rebuildNav(today) {
    const cap = clampToday(today);
    clear(phasesBox);
    const phases = phaseStarts(cap);
    for (const p of phases) {
      const btn = h('button', {
        className: 'archive-phase',
        type: 'button',
        text: p.label,
        'data-day': String(p.day),
        'data-phase': p.id,
      }, phasesBox);
      btn.addEventListener('click', () => revealDay(p.day));
    }
    clear(dayIndex);
    for (let i = 0; i <= cap; i++) {
      const btn = h('button', {
        className: 'archive-day-jump' + (i === cap ? ' is-today' : ''),
        type: 'button',
        text: padDay(i),
        'data-day': String(i),
      }, dayIndex);
      btn.addEventListener('click', () => revealDay(i));
    }
    navToday = cap;
  }

  function fillCards(slot, rec) {
    clear(slot.cards);
    const cards = (rec && rec.cards) || [];
    slot.cards.hidden = cards.length === 0;
    for (const c of cards) {
      const art = h('article', { className: 'archive-card' }, slot.cards);
      if (c && c.class && c.severity && c.time) {
        const l = h('p', { className: 'archive-card-label label' }, art);
        setText(l, `${c.class} · ${c.severity} · ${c.time}`);
      }
      const t = h('h3', { className: 'archive-card-title' }, art);
      const b = h('div', { className: 'archive-card-body' }, art);
      // Inline marks, as in the log column (marks.js); never markup.
      renderMarks(t, c && c.title, { paragraphs: false });
      renderMarks(b, c && c.body);
    }
  }

  function fillTicks(slot, rec) {
    clear(slot.ticks);
    const ticks = (rec && rec.anomalyTicks) || [];
    slot.ticks.hidden = ticks.length === 0;
    for (const tick of ticks) {
      const row = h('p', { className: 'archive-tick fault' }, slot.ticks);
      setText(row, tick && tick.body);
    }
  }

  function fillEncy(slot, rec) {
    clear(slot.ency);
    const entries = asArray(rec && rec.encyclopedia).filter((e) => e && (e.title || e.body));
    slot.ency.hidden = entries.length === 0;
    for (const e of entries) {
      const wrap = h('section', { className: 'archive-ency' }, slot.ency);
      const t = h('h3', { className: 'archive-ency-title' }, wrap);
      const b = h('p', { className: 'archive-ency-body' }, wrap);
      setText(t, e.title);
      setText(b, e.body);
      const src = e.source || e.attribution || e.credit;
      if (src) {
        const s = h('p', { className: 'archive-ency-source' }, wrap);
        setText(s, src);
      }
    }
  }

  function fillFigure(slot, rec, day) {
    clear(slot.fig);
    const spec = rec && rec.figure;
    if (!spec) {
      slot.fig.hidden = true;
      return;
    }
    let node = null;
    try {
      const width = (measure.clientWidth || 0) > 80 ? measure.clientWidth : 440;
      node = renderFigure(spec, width, { day });
    } catch {
      node = null;
    }
    if (node) {
      slot.fig.appendChild(node);
      slot.fig.hidden = false;
    } else {
      slot.fig.hidden = true;
    }
  }

  function fillBlock(slot, day, today) {
    slot.article.setAttribute('data-day', String(day));
    const isToday = day === today;
    if (slot.article.classList && slot.article.classList.toggle) {
      slot.article.classList.toggle('is-today', isToday);
    }
    let rec = null;
    try {
      rec = day <= today ? getDay(day) : null;
    } catch {
      rec = null;
    }
    setText(slot.dateEl, isoDate(rec, day));
    setText(slot.numEl, padDay(day));
    setText(slot.phaseEl, phaseLabelForDay(day));
    const log = rec && rec.log;
    setText(slot.titleEl, log && log.title);
    const sections = eventSections(rec);
    if (sections) {
      slot.bodyEl.hidden = true;
      clear(slot.bodyEl);
      for (const name of SECTION_NAMES) {
        const sec = slot.secs[name];
        sec.wrap.hidden = false;
        renderMarks(sec.body, sections[name]);
      }
    } else {
      slot.bodyEl.hidden = false;
      renderMarks(slot.bodyEl, log && log.body);
      for (const name of SECTION_NAMES) slot.secs[name].wrap.hidden = true;
    }
    fillCards(slot, rec);
    fillTicks(slot, rec);
    fillEncy(slot, rec);
    fillFigure(slot, rec, day);
  }

  function createBlock() {
    const article = h('article', { className: 'archive-day', hidden: true }, daysBox);
    const head = h('header', { className: 'archive-day-head' }, article);
    const dateEl = h('p', { className: 'archive-day-date label' }, head);
    const numEl = h('p', { className: 'archive-day-num' }, head);
    const phaseEl = h('p', { className: 'archive-day-phase label' }, head);
    const viewBtn = h('button', {
      className: 'archive-view',
      type: 'button',
      text: 'view',
    }, head);
    // Cards above the entry, as in the log column.
    const cards = h('div', { className: 'archive-cards', hidden: true }, article);
    const titleEl = h('h2', { className: 'archive-day-title' }, article);
    const bodyEl = h('div', { className: 'archive-day-body' }, article);
    const secs = {};
    for (const name of SECTION_NAMES) {
      const wrap = h('section', { className: 'archive-sec', hidden: true }, article);
      h('h3', { className: 'archive-sec-title label', text: name }, wrap);
      const body = h('div', { className: 'archive-sec-body' }, wrap);
      secs[name] = { wrap, body };
    }
    const ticks = h('div', { className: 'archive-ticks', hidden: true }, article);
    const ency = h('div', { className: 'archive-ency-list', hidden: true }, article);
    const fig = h('div', { className: 'archive-figure', hidden: true }, article);
    viewBtn.addEventListener('click', () => {
      const day = Number(article.getAttribute('data-day'));
      if (!Number.isFinite(day)) return;
      onSelectDay(day);
      close();
    });
    return { article, dateEl, numEl, phaseEl, viewBtn, titleEl, bodyEl, secs, cards, ticks, ency, fig };
  }

  for (let i = 0; i < MAX_DAY_BLOCKS; i++) pool.push(createBlock());

  function bindWindow(start, cap) {
    const today = cap;
    const n = liveCount(today);
    const maxStart = Math.max(0, today + 1 - n);
    start = Math.max(0, Math.min(Math.floor(start), maxStart));
    const end = Math.min(today, start + n - 1);
    rebinding = true;
    winStart = start;
    winEnd = end;
    for (let i = 0; i < pool.length; i++) {
      const day = start + i;
      const slot = pool[i];
      if (day > end || day > today) {
        slot.article.hidden = true;
        slot.article.removeAttribute('data-day');
        continue;
      }
      slot.article.hidden = false;
      fillBlock(slot, day, today);
    }
    let top = 0;
    for (let d = 0; d < start; d++) top += heightAt(d);
    let bot = 0;
    for (let d = end + 1; d <= today; d++) bot += heightAt(d);
    spacerTop.style.height = `${top}px`;
    spacerBottom.style.height = `${bot}px`;
    for (const slot of pool) {
      if (slot.article.hidden) continue;
      const day = Number(slot.article.getAttribute('data-day'));
      const ht = slot.article.offsetHeight;
      if (Number.isFinite(ht) && ht > 0) heights[day] = ht;
    }
    paintPhaseActive(start);
    rebinding = false;
  }

  function setScrollTop(y, reduce) {
    const top = Math.max(0, y);
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    } else {
      scroller.scrollTop = top;
    }
  }

  function articleFor(day) {
    for (const slot of pool) {
      if (slot.article.hidden) continue;
      if (slot.article.getAttribute('data-day') === String(day)) return slot.article;
    }
    return null;
  }

  function pinArticle(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return;
    if (typeof scroller.getBoundingClientRect !== 'function') return;
    const sr = scroller.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const delta = er.top - sr.top - 24;
    if (Math.abs(delta) > 1) {
      scroller.scrollTop = (Number(scroller.scrollTop) || 0) + delta;
    }
  }

  function jumpTo(day) {
    let y = 0;
    for (let i = 0; i < day; i++) y += heightAt(i);
    setScrollTop(y, true);
    const el = articleFor(day);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
    pinArticle(el);
    const jump = dayIndex.querySelector(`[data-day="${day}"]`);
    if (jump && typeof jump.getBoundingClientRect === 'function'
      && typeof dayIndex.getBoundingClientRect === 'function') {
      const br = jump.getBoundingClientRect();
      const box = dayIndex.getBoundingClientRect();
      if (box.height) {
        dayIndex.scrollTop = Math.max(0, (Number(dayIndex.scrollTop) || 0) + br.top - box.top - box.height / 3);
      }
      if (box.width) {
        dayIndex.scrollLeft = Math.max(0, (Number(dayIndex.scrollLeft) || 0) + br.left - box.left - box.width / 3);
      }
    }
    paintPhaseActive(day);
  }

  function revealDay(day) {
    const today = currentToday();
    const d = Math.max(0, Math.min(today, Math.floor(Number(day) || 0)));
    const n = liveCount(today);
    const bounds = windowBounds({ today, anchorDay: d, size: n, align: 'start' });
    scrollLock = true;
    bindWindow(bounds.start, today);
    jumpTo(d);
    const finish = () => {
      if (destroyed) return;
      bindWindow(bounds.start, today);
      jumpTo(d);
      const release = () => { scrollLock = false; };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(release);
      else release();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
    else finish();
  }

  function onScroll() {
    if (destroyed || rebinding || !openState || scrollLock) return;
    const today = currentToday();
    const y = Number(scroller.scrollTop) || 0;
    let acc = 0;
    let i = 0;
    while (i < today && acc + heightAt(i) < y + 1) {
      acc += heightAt(i);
      i++;
    }
    const n = liveCount(today);
    const bounds = windowBounds({ today, anchorDay: i, size: n });
    if (bounds.start !== winStart) bindWindow(bounds.start, today);
    paintPhaseActive(i);
  }

  function onIntersect() {
    if (destroyed || rebinding || !openState || scrollLock) return;
    onScroll();
  }

  function open(day) {
    if (destroyed) return;
    const today = currentToday();
    if (navToday !== today) rebuildNav(today);
    archive.hidden = false;
    if (root.classList && root.classList.add) root.classList.add('archive-open');
    if (html && html.classList && html.classList.add) html.classList.add('archive-open');
    openState = true;
    control.setAttribute('aria-expanded', 'true');
    const target = day == null || day === '' ? today : day;
    revealDay(target);
    placeControl();
    if (typeof archive.focus === 'function') archive.focus();
  }

  function close() {
    if (destroyed) return;
    const wasOpen = openState;
    archive.hidden = true;
    if (root.classList && root.classList.remove) root.classList.remove('archive-open');
    if (html && html.classList && html.classList.remove) html.classList.remove('archive-open');
    openState = false;
    control.setAttribute('aria-expanded', 'false');
    if (wasOpen && typeof control.focus === 'function') control.focus();
  }

  function isOpen() {
    return !destroyed && openState;
  }

  function update(frame) {
    if (destroyed) return;
    const today = currentToday();
    const rm = !!(frame && frame.reducedMotion);
    const key = `${today}|${openState ? 1 : 0}|${rm ? 1 : 0}`;
    if (key === lastKey) {
      placeControl();
      return;
    }
    lastKey = key;
    if (openState && navToday !== today) {
      rebuildNav(today);
      revealDay(Math.min(Math.max(winStart, 0), today));
    }
    placeControl();
  }

  function onKey(ev) {
    if (destroyed || !openState) return;
    if (ev && (ev.key === 'Escape' || ev.key === 'Esc')) {
      if (ev.preventDefault) ev.preventDefault();
      close();
    }
  }

  function onResize() {
    if (destroyed) return;
    placeControl();
  }

  control.addEventListener('click', () => {
    if (openState) close();
    else open();
  });
  scroller.addEventListener('scroll', onScroll);
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', onKey);
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', onResize);
  }
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(onIntersect, {
      root: scroller,
      rootMargin: '240px 0px',
      threshold: 0,
    });
    for (const slot of pool) io.observe(slot.article);
  }

  placeControl();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    openState = false;
    if (io && io.disconnect) io.disconnect();
    io = null;
    if (typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('keydown', onKey);
    }
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('resize', onResize);
    }
    if (root.classList && root.classList.remove) root.classList.remove('archive-open');
    if (html && html.classList && html.classList.remove) html.classList.remove('archive-open');
    for (const node of created) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
  }

  return {
    open,
    close,
    isOpen,
    update,
    destroy,
    windowRange() { return { start: winStart, end: winEnd }; },
  };
}
