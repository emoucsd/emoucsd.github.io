// The per-day seal (system spec §10, §11).
//
// Every day record is encrypted with AES-256-GCM under a key derived by HKDF-SHA256 from the
// project salt and that day's ISO date. The page derives the key for a date only once the
// Pacific clock has reached that date, so what it can open is decided by the clock alone.
//
// This is a curiosity seal, not a secret: the salt ships with the bundle and the derivation is
// this file, so anyone willing to run it for a future date can read that day. It turns spoiling
// from an accident into a deliberate act, which is the bar the spec sets (§11).
//
// The same module runs in the browser and in Node (both expose WebCrypto as globalThis.crypto).
// Sealing is deterministic: the IV is an HMAC of the padded plaintext under a per-date key, so
// resealing unchanged content reproduces the committed bytes, and changed content never reuses
// an IV under the same key.

import { missionTFromDate } from '../clock.js';

export const SEAL_FORMAT = 'mission-clock-sealed/1';
export const PAD_BLOCK = 2048;
export const TOUCHDOWN_DATE = '2027-08-31';
export const LAST_DAY = 365;

const MAGIC = 'MCSEAL1\n';
const DAY_MS = 86400000;
const LAUNCH_UTC = Date.UTC(2026, 7, 31);
const HKDF_SALT = new TextEncoder().encode('mission-clock/seal/v1');

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('WebCrypto is unavailable');
  return c.subtle;
};

export function isoDateOfDay(day) {
  return new Date(LAUNCH_UTC + day * DAY_MS).toISOString().slice(0, 10);
}

export function dayOfIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return NaN;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - LAUNCH_UTC) / DAY_MS);
}

// The last day index the clock allows to be opened: -1 before launch, 365 from touchdown on.
export function unlockedThrough(date) {
  const t = missionTFromDate(date);
  if (!Number.isFinite(t) || t < 0) return -1;
  return Math.min(LAST_DAY, Math.floor(t));
}

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(String(str));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function newSalt() {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

const enc = (s) => new TextEncoder().encode(s);

async function hkdfBits(salt, info, bits) {
  const ikm = await subtle().importKey('raw', salt, 'HKDF', false, ['deriveBits']);
  const buf = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: enc(info) },
    ikm,
    bits,
  );
  return new Uint8Array(buf);
}

async function aesKey(salt, purpose, iso, usages) {
  const raw = await hkdfBits(salt, `${purpose}|${iso}`, 256);
  return subtle().importKey('raw', raw, 'AES-GCM', false, usages);
}

async function synthIv(salt, purpose, iso, plain) {
  const raw = await hkdfBits(salt, `${purpose}-iv|${iso}`, 256);
  const k = await subtle().importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await subtle().sign('HMAC', k, plain));
  return mac.slice(0, 12);
}

const dayAad = (day, iso) => enc(`day|${day}|${iso}`);

function pad(bytes) {
  const size = Math.ceil((bytes.length + 1) / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(size).fill(0x20);
  out.set(bytes);
  return out;
}

export async function sealDay(salt, record) {
  const day = record && record.day;
  if (!Number.isInteger(day) || day < 0 || day > LAST_DAY) throw new Error('record has no valid day');
  const iso = isoDateOfDay(day);
  if (record.date !== iso) throw new Error(`record for slot ${day} is dated ${record.date}`);
  const plain = pad(enc(JSON.stringify(record)));
  const iv = await synthIv(salt, 'day', iso, plain);
  const key = await aesKey(salt, 'day', iso, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: dayAad(day, iso) }, key, plain));
  return { day, date: iso, iv: toB64(iv), ct: toB64(ct) };
}

export async function openDay(salt, entry) {
  const key = await aesKey(salt, 'day', entry.date, ['decrypt']);
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromB64(entry.iv), additionalData: dayAad(entry.day, entry.date) },
    key,
    fromB64(entry.ct),
  );
  const rec = JSON.parse(new TextDecoder().decode(plain));
  if (!rec || rec.day !== entry.day) throw new Error('record does not match its slot');
  return rec;
}

// Opens every day in a sealed bundle that `now` permits and no other. Returns the records in
// day order; a day that fails to open is left out and reported in `failed`.
export async function openBundle(bundle, now, already = new Map()) {
  if (!bundle || bundle.format !== SEAL_FORMAT) throw new Error('not a sealed bundle');
  const salt = fromB64(bundle.salt);
  const through = unlockedThrough(now);
  const failed = [];
  for (const entry of bundle.days || []) {
    if (!entry || entry.day > through || already.has(entry.day)) continue;
    if (dayOfIsoDate(entry.date) !== entry.day) {
      failed.push(entry.day);
      continue;
    }
    try {
      already.set(entry.day, await openDay(salt, entry));
    } catch {
      failed.push(entry.day);
    }
  }
  return { through, records: already, failed };
}

// The archive: one binary blob sealed under a date, with the purpose separated from the day
// keys so the touchdown day's key cannot open it. Layout: magic, u32 header length, header JSON,
// ciphertext.
export async function sealArchive(salt, payload, iso) {
  const iv = await synthIv(salt, 'archive', iso, payload);
  const key = await aesKey(salt, 'archive', iso, ['encrypt']);
  const aad = enc(`archive|${iso}`);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, payload));
  const head = enc(JSON.stringify({ format: SEAL_FORMAT, purpose: 'archive', date: iso, salt: toB64(salt), iv: toB64(iv) }));
  const out = new Uint8Array(MAGIC.length + 4 + head.length + ct.length);
  out.set(enc(MAGIC), 0);
  new DataView(out.buffer).setUint32(MAGIC.length, head.length);
  out.set(head, MAGIC.length + 4);
  out.set(ct, MAGIC.length + 4 + head.length);
  return out;
}

export function archiveHeader(bin) {
  const magic = new TextDecoder().decode(bin.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error('not a sealed archive');
  const len = new DataView(bin.buffer, bin.byteOffset).getUint32(MAGIC.length);
  const head = JSON.parse(new TextDecoder().decode(bin.subarray(MAGIC.length + 4, MAGIC.length + 4 + len)));
  return { ...head, offset: MAGIC.length + 4 + len };
}

export async function openArchive(bin, now) {
  const head = archiveHeader(bin);
  if (unlockedThrough(now) < dayOfIsoDate(head.date)) throw new Error(`sealed until ${head.date}`);
  const key = await aesKey(fromB64(head.salt), 'archive', head.date, ['decrypt']);
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromB64(head.iv), additionalData: enc(`archive|${head.date}`) },
    key,
    bin.subarray(head.offset),
  );
  return new Uint8Array(plain);
}
