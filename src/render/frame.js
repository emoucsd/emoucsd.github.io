// The Frame: everything a renderer module needs to draw one moment, computed purely from mission
// time and the day's content record. Modules consume frames and never read the clock, the physics
// table or each other, which is what lets them be built and tested independently.

import { state } from '../physics.js';
import { missionTAtPacificClock, pacificHour, utcMsOfMissionT } from '../clock.js';
import { heroLayout } from './scale.js';
import { sunVector } from './lighting.js';
import { clamp, lerp, smoothstep } from './util.js';

export const ARCHIVE_HOUR = 18;
const SIDEREAL_MONTH = 27.321662;
const DRACONIC_MONTH = 27.212221;

// §6.5: the selenographic point the lunar camera faces. Near side to day 120, real libration to
// day 300, eased toward the south pole by day 340, then settled over the polar target by day 350.
export function moonCamera(t) {
  const libration = (x) => ({
    lat0: 6 * Math.sin((2 * Math.PI * (x - 120)) / DRACONIC_MONTH),
    lon0: 7 * Math.sin((2 * Math.PI * (x - 120)) / SIDEREAL_MONTH),
  });
  if (t < 120) return { lat0: 0, lon0: 0 };
  if (t < 300) return libration(t);
  if (t < 340) {
    const from = libration(300);
    const u = smoothstep((t - 300) / 40);
    return { lat0: lerp(from.lat0, -80, u), lon0: lerp(from.lon0, 20, u) };
  }
  const u = smoothstep((t - 340) / 10);
  return { lat0: lerp(-80, -88, u), lon0: lerp(20, 0, u) };
}

// §6.4: Earth turns 360.9856° per mean solar day from launch.
export function earthSpinDeg(t) {
  const days = (utcMsOfMissionT(t) - utcMsOfMissionT(0)) / 86400000;
  return (((360.9856 * days) % 360) + 360) % 360;
}

// t: mission time. live: today (true) or an archived day frozen at 18:00 Pacific (false).
// day: the day's content record, or null. dim: the viewer's dim gain (§6.2.2). aspect: the
// stage's width / height, which moves the anchors so both bodies stay in shot (scale.js).
export function buildFrame({ t, live = true, day = null, reducedMotion = false, dim = false, aspect = 16 / 9 }) {
  const dayIndex = Math.floor(t);
  const shown = live ? t : missionTAtPacificClock(dayIndex, ARCHIVE_HOUR);
  const s = state(shown);
  return {
    t: shown,
    day: dayIndex,
    hour: pacificHour(shown),
    live,
    reducedMotion,
    state: s,
    mode: s.mode,
    sun: sunVector(s),
    aspect,
    ...heroLayout(s, aspect),
    moonCamera: moonCamera(shown),
    earthSpinDeg: earthSpinDeg(shown),
    grade: clamp(Number(day?.grade) || 0, 0, 1),
    gain: clamp(Number(day?.gain) || 1, 0.6, 1.2) * (dim ? 0.62 : 1),
    visuals: Array.isArray(day?.visuals) ? day.visuals : [],
  };
}
