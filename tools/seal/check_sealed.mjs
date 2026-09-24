#!/usr/bin/env node
// Full-year sweep of a sealed bundle under a simulated clock (system spec §13, Phase 7).
//
//   node tools/seal/check_sealed.mjs [--bundle content/sealed/days.json]
//        [--plain <days.json>] [--archive content/sealed/monument.bin]
//
// For every one of the 366 days it asserts, through the same loader the page uses:
//   - one millisecond before the day's Pacific midnight the day has no record, and at midnight
//     it opens;
//   - the day's own date key opens it and the neighbouring dates' keys do not;
//   - at noon every earlier day replays, and the next day is still sealed;
//   - the frame builder renders the day from the opened record;
//   - with --plain, the opened record equals its plaintext source exactly, and the frame built
//     from it equals the frame built from the source.
// Needs no plaintext to run, so it is safe in CI. Prints counts only, never content.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  SEAL_FORMAT, isoDateOfDay, dayOfIsoDate, openDay, openArchive, archiveHeader, fromB64,
} from '../../src/app/seal.js';
import { loadContent, dayRecord, unlockUntil, unlockedThroughDay, resetContent } from '../../src/app/content.js';
import { utcMsOfMissionT } from '../../src/clock.js';
import { buildFrame } from '../../src/render/frame.js';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');
const ENTRY_KEYS = ['ct', 'date', 'day', 'iv'];

const midnight = (d) => new Date(utcMsOfMissionT(d));
const noon = (d) => new Date(utcMsOfMissionT(d + 0.5));

export async function sweepSealed(bundle, { plain = null, archive = null } = {}) {
  const fail = {};
  const bump = (code) => { fail[code] = (fail[code] || 0) + 1; };
  const counts = { days: 0, opened: 0, sealedBefore: 0, replayed: 0, frames: 0, matched: 0 };

  if (!bundle || bundle.format !== SEAL_FORMAT) bump('format');
  const days = (bundle && bundle.days) || [];
  if (days.length !== 366) bump('count');
  const salt = fromB64(bundle.salt);
  const byDay = new Map();
  for (const e of days) {
    if (Object.keys(e).sort().join() !== ENTRY_KEYS.join()) bump('entry-keys');
    if (dayOfIsoDate(e.date) !== e.day || e.date !== isoDateOfDay(e.day)) bump('entry-date');
    if (byDay.has(e.day)) bump('entry-dup');
    byDay.set(e.day, e);
  }
  const plainBy = plain ? new Map(plain.map((r) => [r.day, r])) : null;
  const fetchJson = async () => ({ ok: true, json: async () => bundle });

  // One loader walks the year forward, crossing every midnight the way an open page does.
  resetContent();
  await loadContent('sealed', { fetch: fetchJson, clock: () => new Date(utcMsOfMissionT(0) - 1) });
  if (unlockedThroughDay() !== -1 || dayRecord(0)) bump('prelaunch-open');

  for (let d = 0; d <= 365; d++) {
    counts.days++;
    const e = byDay.get(d);
    if (!e) { bump('missing'); continue; }

    await unlockUntil(new Date(+midnight(d) - 1));
    if (dayRecord(d) || unlockedThroughDay() !== d - 1) bump('open-before-midnight');
    else counts.sealedBefore++;

    await unlockUntil(midnight(d));
    const rec = dayRecord(d);
    if (!rec || rec.day !== d || rec.date !== e.date || !rec.log) { bump('not-open-at-midnight'); continue; }
    counts.opened++;

    for (const other of [d - 1, d + 1]) {
      if (other < 0 || other > 365) continue;
      try {
        await openDay(salt, { ...e, date: isoDateOfDay(other) });
        bump('opens-under-other-date');
      } catch { /* expected */ }
    }

    await unlockUntil(noon(d));
    let replay = true;
    for (let p = 0; p <= d; p++) if (!dayRecord(p)) replay = false;
    if (d < 365 && dayRecord(d + 1)) bump('next-day-open-at-noon');
    if (replay) counts.replayed++;
    else bump('replay');

    let frame;
    try {
      frame = buildFrame({ t: d + 0.5, live: true, day: rec, reducedMotion: true });
      if (frame.day === d) counts.frames++;
      else bump('frame-day');
    } catch {
      bump('frame-throws');
    }

    if (plainBy) {
      const src = plainBy.get(d);
      const same = src && isDeepStrictEqual(rec, src)
        && isDeepStrictEqual(buildFrame({ t: d + 0.5, live: true, day: src, reducedMotion: true }), frame);
      if (same) counts.matched++;
      else bump('plain-mismatch');
    }
  }

  // A fresh load on a sample of days, as a first visit would be: exactly 0..d open.
  for (const d of [0, 1, 6, 7, 62, 63, 182, 338, 339, 364, 365]) {
    resetContent();
    await loadContent('sealed', { fetch: fetchJson, clock: () => noon(d) });
    if (unlockedThroughDay() !== d || !dayRecord(d) || (d < 365 && dayRecord(d + 1))) bump('fresh-load');
  }
  resetContent();

  if (archive) {
    const head = archiveHeader(archive);
    if (head.date !== '2027-08-31' || head.format !== SEAL_FORMAT) bump('archive-header');
    try {
      await openArchive(archive, new Date(+midnight(365) - 1));
      bump('archive-open-early');
    } catch { /* expected */ }
    try {
      await openArchive(archive, midnight(365));
      counts.archiveOpens = 1;
    } catch {
      bump('archive-not-open-at-touchdown');
    }
  }

  const failures = Object.values(fail).reduce((a, b) => a + b, 0);
  return { ok: failures === 0, counts, fail, failures };
}

export function format(res) {
  const c = res.counts;
  const lines = [
    `sealed sweep: ${res.ok ? 'PASS' : 'FAIL'}`,
    `  days ${c.days}, sealed-before-midnight ${c.sealedBefore}, opened-at-midnight ${c.opened}, `
      + `replayed ${c.replayed}, frames ${c.frames}`
      + (c.matched || res.fail['plain-mismatch'] ? `, matched-source ${c.matched}` : '')
      + (c.archiveOpens != null ? `, archive opens at touchdown ${c.archiveOpens}` : ''),
  ];
  if (!res.ok) lines.push('  failures: ' + Object.entries(res.fail).map(([k, v]) => `${k}=${v}`).join(' '));
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const bundle = JSON.parse(readFileSync(resolve(REPO, arg('--bundle') || 'content/sealed/days.json'), 'utf8'));
  const plainPath = arg('--plain');
  const plain = plainPath ? JSON.parse(readFileSync(resolve(REPO, plainPath), 'utf8')) : null;
  const archivePath = arg('--archive');
  const archive = archivePath && existsSync(resolve(REPO, archivePath))
    ? new Uint8Array(readFileSync(resolve(REPO, archivePath))) : null;
  if (archivePath && !archive) {
    console.error('sealed sweep: archive not found');
    return 1;
  }
  const res = await sweepSealed(bundle, { plain, archive });
  console.log(format(res));
  return res.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`sealed sweep: failed (${err && err.name})`);
    process.exit(1);
  });
}
