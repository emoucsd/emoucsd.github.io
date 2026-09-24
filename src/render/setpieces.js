// The departure and arrival choreography of system spec §7.7, as elements keyed to a mission day
// and displayed-day hours, Pacific. This is the readable spec's own schedule and carries no
// narrative. Content bundles merge these entries into their day records, and the sweep fails any
// vehicle-event element that appears anywhere else.
//
// The standing ion burn is not listed: the vehicle derives it from the physics table (thrusting
// while the cruise module is attached and duty is above zero, at 0.4 throttle before day 7).

import { T_JETTISON, T_DEORBIT, T_DEORBIT_END, T_PDI } from '../physics.js';

const hourOf = (t) => (t - Math.floor(t)) * 24;

export const VEHICLE_EVENT_OPS = ['AppendageDeploy', 'StageSeparation', 'EngineBurn', 'ExhaustTrail'];

export const SETPIECES = [
  { day: 0, op: 'ExhaustTrail', kind: 'ascent', t0: 1, t1: 3, density: 0.7 },
  { day: 0, op: 'StageSeparation', what: 'fairing', t0: 6, t1: 7 },
  { day: 0, op: 'StageSeparation', what: 'upper-stage', t0: 18, t1: 19 },
  { day: 0, op: 'ExhaustTrail', kind: 'separation', t0: 18, t1: 18.1 },
  { day: 1, op: 'AppendageDeploy', what: 'arrays', t0: 6, t1: 18 },
  { day: 2, op: 'AppendageDeploy', what: 'boom', t0: 8, t1: 16 },
  { day: 3, op: 'AppendageDeploy', what: 'dish', t0: 8, t1: 16 },
  { day: 6, op: 'EngineBurn', engine: 'ion', t0: 14, t1: 24, throttle: 0.4 },
  { day: 362, op: 'StageSeparation', what: 'cruise-module', t0: hourOf(T_JETTISON), t1: hourOf(T_JETTISON) + 1 },
  { day: 362, op: 'ExhaustTrail', kind: 'separation', t0: hourOf(T_JETTISON), t1: hourOf(T_JETTISON) + 0.1 },
  { day: 363, op: 'AppendageDeploy', what: 'legs', t0: 0, t1: 24 },
  { day: 364, op: 'EngineBurn', engine: 'attitude', t0: 0, t1: 24 },
  { day: 364, op: 'EngineBurn', engine: 'descent', t0: hourOf(T_DEORBIT), t1: hourOf(T_DEORBIT_END), flicker_hz: 12 },
  { day: 364, op: 'EngineBurn', engine: 'descent', t0: hourOf(T_PDI), t1: 24, flicker_hz: 12 },
  { day: 364, op: 'ShadowCast', body: 'moon', from: 'ship' },
  { day: 365, op: 'ExhaustTrail', kind: 'surface-dust', t0: 0, t1: 0.05 },
  { day: 365, op: 'ShadowCast', body: 'moon', from: 'ship' },
];

export const setpiecesForDay = (day) => SETPIECES.filter((e) => e.day === day).map(({ day: _, ...rest }) => rest);
