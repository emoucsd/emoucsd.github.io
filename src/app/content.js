// Day-record loader for the mission clock.
//
// A bundle lives at content/<name>/days.json. Two shapes are accepted:
//
// - sealed (the published shape, spec §10): { format: 'mission-clock-sealed/1', salt, days: [
//   { day, date, iv, ct } ] }. Only days the clock has reached are opened (src/app/seal.js), and
//   a day that is still sealed has no record: dayRecord returns null for it.
// - plaintext (development and the Phase 4 harness only): a JSON array of 366 records. It is
//   never published; tools/seal/verify_publish.mjs fails if one would be.
//
// The path is resolved from this module so the same fetch works from index.html and from a
// demo page in a subdirectory.

import { SEAL_FORMAT, openBundle } from './seal.js';

export const DEFAULT_CONTENT = 'sealed';

let bundle = [];
let bundleName = '';
let sealed = null;
let opened = new Map();
let through = -1;
let unlocking = null;

const NAME_OK = /^[a-z0-9_-]+$/i;

export function contentUrl(name, base = import.meta.url) {
  const safe = NAME_OK.test(name) ? name : DEFAULT_CONTENT;
  return new URL(`../../content/${safe}/days.json`, base).href;
}

function rebuild() {
  bundle = [...opened.values()].sort((a, b) => a.day - b.day);
}

// Open every sealed day the clock now permits. Safe to call on every frame: it does nothing
// unless the permitted day has moved, and concurrent calls share one pass.
export async function unlockUntil(now) {
  if (!sealed) return through;
  if (unlocking) return unlocking;
  const mine = sealed;
  unlocking = (async () => {
    try {
      const res = await openBundle(mine, now, opened);
      if (sealed === mine) {
        through = Math.max(through, res.through);
        rebuild();
      }
      return through;
    } finally {
      unlocking = null;
    }
  })();
  return unlocking;
}

export async function loadContent(name = DEFAULT_CONTENT, { fetch: fetchFn, base, clock } = {}) {
  const fetchImpl = fetchFn || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('loadContent requires fetch');
  }
  const safe = NAME_OK.test(name) ? name : DEFAULT_CONTENT;
  const url = contentUrl(safe, base);
  const res = await fetchImpl(url);
  if (!res || !res.ok) {
    throw new Error(`content bundle not found: ${safe}`);
  }
  const data = await res.json();
  resetContent();
  bundleName = safe;
  if (data && !Array.isArray(data) && data.format === SEAL_FORMAT) {
    sealed = data;
    await unlockUntil(typeof clock === 'function' ? clock() : new Date());
    return bundle;
  }
  bundle = Array.isArray(data) ? data : [];
  return bundle;
}

export function dayRecord(day) {
  if (!bundle.length) return null;
  const i = Math.floor(Number(day));
  if (sealed) {
    // Strict: a day the clock has not reached has no record, and nothing stands in for it.
    return Number.isFinite(i) ? (opened.get(i) || null) : null;
  }
  if (!Number.isFinite(i)) return bundle[0];
  const found = bundle.find((row) => row && row.day === i);
  if (found) return found;
  if (i <= bundle[0].day) return bundle[0];
  return bundle[bundle.length - 1];
}

export function isSealed() {
  return !!sealed;
}

// The last day index opened so far; -1 when nothing is open.
export function unlockedThroughDay() {
  if (sealed) return through;
  return bundle.length ? bundle[bundle.length - 1].day : -1;
}

export function currentBundle() {
  return bundle;
}

export function currentBundleName() {
  return bundleName;
}

export function resetContent() {
  bundle = [];
  bundleName = '';
  sealed = null;
  opened = new Map();
  through = -1;
  unlocking = null;
}
