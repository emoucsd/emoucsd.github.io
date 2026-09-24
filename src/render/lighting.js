// The lighting model of system spec §6.3: one sun vector S in view space, shared by every lit
// object in the frame, and the geometry that follows from it.

import { clamp, fmt, lerpHex, smoothstep, RAD, DEG } from './util.js';
import { PALETTE } from './palette.js';

const n0 = Math.hypot(-0.52, -0.28, 0.81);
export const S0 = { sx: -0.52 / n0, sy: -0.28 / n0, sz: 0.81 / n0 };
export const AZ0_DEG = Math.atan2(S0.sy, S0.sx) * DEG;   // upper left

// Owner ruling, 2026-09-13: neither body ever goes fully dark. The lit fraction never drops
// below a quarter of the disc, and the monthly rhythm must stay visible.
export const PHASE_FLOOR = 0.25;
export const PHASE_CEILING = 0.94;

// S for a state. The lit fraction follows the true lunar phase for the displayed instant, remapped
// linearly into [PHASE_FLOOR, PHASE_CEILING] rather than clamped, so a new moon is still a clear
// crescent and every day of the month still waxes or wanes. Both discs show it. The azimuth
// starts at S0's upper left and tips with the seasons, lighting the north pole in June and the
// south in December. In the first week the terminator walks with the orbit, fading out before
// the day-7 handover so the two frames share one sun.
export function sunVector(s) {
  const k = PHASE_FLOOR + (PHASE_CEILING - PHASE_FLOOR) * clamp(s.moonPhase, 0, 1);
  const sz = 2 * k - 1;
  const planar = Math.sqrt(Math.max(0, 1 - sz * sz));
  let azDeg = AZ0_DEG + 0.6 * s.sunDeclination;
  if (s.orbit?.body === 'Earth' && s.t < 7) {
    const amplitude = 20 * (1 - smoothstep(s.t - 6));
    azDeg += amplitude * Math.sin(s.orbit.trueAnomaly * RAD);
  }
  const az = azDeg * RAD;
  return { sx: planar * Math.cos(az), sy: planar * Math.sin(az), sz, azDeg, elDeg: Math.asin(sz) * DEG };
}

// Illuminated fraction of a disc, clamped so a full body keeps form and no body goes dark.
export function litFraction(sun) {
  return clamp((1 + sun.sz) / 2, PHASE_FLOOR, PHASE_CEILING);
}

// The lit region of a disc as a two-arc path: the sunward half circle, then the terminator
// half-ellipse back. The ellipse bows away from the sun for a gibbous disc and toward it for a
// crescent; it is a straight line only at exactly half phase. kOffset draws Earth's twilight band.
export function litPath(cx, cy, R, sun, kOffset = 0) {
  const k = clamp(litFraction(sun) + kOffset, 0, 1);
  const b = R * Math.abs(1 - 2 * k);
  const a = sun.azDeg * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const p = (x, y) => `${fmt(cx + x * c - y * s)} ${fmt(cy + x * s + y * c)}`;
  const sweep = k > 0.5 ? 1 : 0;
  const rot = fmt(sun.azDeg);
  return `M ${p(0, -R)} A ${fmt(R)} ${fmt(R)} ${rot} 0 1 ${p(0, R)} A ${fmt(b)} ${fmt(R)} ${rot} 0 ${sweep} ${p(0, -R)} Z`;
}

// Where the terminator crosses the sun line; the visual checks use it to prove the bow direction.
export function terminatorMidpoint(cx, cy, R, sun) {
  const k = litFraction(sun);
  const x = (k > 0.5 ? -1 : 1) * R * Math.abs(1 - 2 * k);
  const a = sun.azDeg * RAD;
  return { x: cx + x * Math.cos(a), y: cy + x * Math.sin(a) };
}

// §6.3.3: flat earthshine on the Moon's night side, skipped when too faint to matter.
export function earthshineOpacity(sun) {
  const I = 0.04 + 0.14 * (1 - litFraction(sun));
  return I < 0.05 ? 0 : I;
}

const MATERIALS = {
  hull: ['hull-shade', 'hull-lit', null],
  mli: ['mli-shade', 'mli-lit', 'mli-fold'],
  array: ['array-cell', 'array-grid', 'array-glint'],
  radiator: ['radiator-shade', 'radiator', null],
  ceramic: ['ceramic-shade', 'ceramic', null],
  leg: ['leg', 'leg-joint', null],
};

// §6.3.6 hull lighting. nLocal is the path's ship-local normal; rollDeg is the vehicle group's
// rotation in the view plane; gain is the day's director knob times the dim setting.
export function hullFill(material, nLocal, rollDeg, sun, gain = 1) {
  if (material === 'bay') return PALETTE.bay;
  const [shade, lit, spec] = MATERIALS[material] ?? MATERIALS.hull;
  const r = rollDeg * RAD;
  const nx = nLocal[0] * Math.cos(r) - nLocal[1] * Math.sin(r);
  const ny = nLocal[0] * Math.sin(r) + nLocal[1] * Math.cos(r);
  const lambert = clamp((nx * sun.sx + ny * sun.sy + nLocal[2] * sun.sz) * gain, 0, 1);
  let fill = lerpHex(PALETTE[shade], PALETTE[lit], lambert ** 0.85);
  if (spec && lambert > 0.92) fill = lerpHex(fill, PALETTE[spec], (lambert - 0.92) / 0.08);
  return fill;
}
