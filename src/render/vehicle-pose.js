// Vehicle pose at a Frame: every mechanical beat of spec §6.6 / §6.8.2 / §7.7, derived
// purely from SETPIECES plus the physics table. Rendering day n never depends on having
// rendered day n−1, so a viewer can arrive at any day cold.

import { SETPIECES } from './setpieces.js';
import { clamp, smoothstep, DEG } from './util.js';

function beatU(event, frame) {
  const span = event.t1 - event.t0;
  if (span === 0) return frame.hour >= event.t0 ? 1 : 0;
  return (frame.hour - event.t0) / span;
}

// AppendageDeploy: earlier days take the final value; the current day interpolates
// linearly in displayed-day hours so day-363 18:00 is legs = 0.75 = 56°.
function appendageValue(event, frame) {
  const from = event.from ?? 0;
  const to = event.to ?? 1;
  const hold = event.hold !== false;
  if (frame.day > event.day) return hold ? to : from;
  if (frame.day < event.day) return from;
  const u = beatU(event, frame);
  if (u <= 0) return from;
  if (u >= 1) return hold ? to : from;
  return from + (to - from) * clamp(u, 0, 1);
}

// StageSeparation: 'attached' before t0, { p } during the beat (p is smoothstepped),
// 'gone' after t1 and on every later day.
function separationValue(event, frame) {
  if (frame.day < event.day) return 'attached';
  if (frame.day > event.day) return 'gone';
  const u = beatU(event, frame);
  if (u < 0) return 'attached';
  if (u >= 1) return 'gone';
  return { p: smoothstep(u) };
}

function mapFairing(state) {
  if (state === 'attached') return 'on';
  if (state === 'gone') return 'off';
  return state;
}

function wrap180(deg) {
  const w = ((deg % 360) + 360) % 360;
  return w > 180 ? w - 360 : w;
}

export function vehiclePose(frame) {
  let fairing = 'on';
  let upperStage = 'attached';
  let cruiseModule = 'attached';
  let arrays = 0;
  let boom = 0;
  let dish = 0;
  let legs = 0;
  let attitudeOn = false;

  for (const event of SETPIECES) {
    if (event.day > frame.day) continue;
    if (event.op === 'AppendageDeploy') {
      const value = appendageValue(event, frame);
      if (event.what === 'arrays') arrays = value;
      else if (event.what === 'boom') boom = value;
      else if (event.what === 'dish') dish = value;
      else if (event.what === 'legs') legs = value;
    } else if (event.op === 'StageSeparation') {
      const value = separationValue(event, frame);
      if (event.what === 'fairing') fairing = mapFairing(value);
      else if (event.what === 'upper-stage') upperStage = value;
      else if (event.what === 'cruise-module') cruiseModule = value;
    } else if (event.op === 'EngineBurn' && event.engine === 'attitude' && event.day === frame.day) {
      const u = beatU(event, frame);
      if (u >= 0 && u <= 1) attitudeOn = true;
    }
  }

  const present = frame.day > 0 || (frame.day === 0 && fairing !== 'on');
  const ionOn = frame.state.duty > 0;
  const descentOn = !!frame.state.chemicalEngineOn;

  // The drawing is a side view of a rocket, so the nose is held toward the Moon in the picture
  // plane, the same live and in the archive. The residual rotation about the sun line (§6.6.2)
  // is out of this plane and is not drawn: drawn in-plane it spun the nose to any angle on a live
  // load (owner report, 2026-09-13). On the ground and in the descent camera the Moon is the
  // ground, so the craft stands upright with its engine down.
  // Launch day stands straight up, still on the launcher's upper stage; across day 1 the nose
  // eases round to the Moon so a live viewer never sees it snap at midnight (owner, 2026-09-13).
  let headingDeg = 0;
  if (frame.mode !== 'descent' && frame.mode !== 'monument' && frame.ship && frame.moon) {
    const toMoon = Math.atan2(frame.moon.cy - frame.ship.y, frame.moon.cx - frame.ship.x) * DEG;
    const turn = smoothstep(clamp(frame.t - 1, 0, 1));
    headingDeg = wrap180(toMoon + 90) * turn;
  }

  return {
    present,
    fairing,
    upperStage,
    arrays,
    boom,
    dish,
    legs,
    cruiseModule,
    ion: { on: ionOn, throttle: ionOn ? (frame.day < 7 ? 0.4 : 1) : 0 },
    descent: { on: descentOn, flickerHz: descentOn ? 12 : 0 },
    attitude: { on: attitudeOn },
    shadow: frame.day >= 364,
    headingDeg,
  };
}
