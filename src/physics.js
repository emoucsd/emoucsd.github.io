// The physics table: state(t), one pure function of mission time that everything on the page
// derives from (system spec §5).
//
// This is a port of tools/propulsion_profile.py, which stays the reference model. Every
// quantity that model defines is reproduced here to floating-point agreement, and
// tests/physics.test.mjs holds the two together through a fixture the Python generates. What
// this file adds is what the page needs and the reference does not compute: the instantaneous
// range as the craft swings round each ellipse, velocity, light delay, trajectory fraction,
// and the sun and phase geometry for the displayed date.
//
// Mission time t is in days; t = 0 is 2026-08-31 00:00 Pacific. See clock.js.
//
// Retimed 2026-11-05: touchdown moved from day 365 to day 349. Days 0-303 had already been
// tuned (and partly read) against the 365-day profile, so up to T_THROTTLE_UP this file
// evaluates exactly the old curves with exactly the old arithmetic, and tests/physics.test.mjs
// proves state(t) bit-for-bit unchanged there. At day 303 the ion thruster is commanded up by
// THROTTLE (46 mN to about 63.7 mN, same Isp, so mass flow rises with it) and the Earth spiral
// runs the old day-303-to-339 curves in 26 days instead of 36. The lunar phase is re-anchored on
// the new event days, and the descent keeps its old durations, 16 days earlier.

import { utcMsOfMissionT, LAST_DAY } from './clock.js';

// Constants
export const MU_EARTH = 398600.4418;      // km^3/s^2
export const MU_MOON = 4902.800118;       // km^3/s^2
export const R_EARTH = 6378.137;          // km
export const R_MOON = 1737.4;             // km
export const MOON_DIST = 384400.0;        // km, mean Earth-Moon distance
export const C_KMS = 299792.458;          // km/s
export const G0 = 9.80665;                // m/s^2

// Vehicle
export const STACK_WET = 320.0;
export const CRUISE_DRY = 99.0;
export const XENON_LOAD = 46.0;
export const LANDER_WET = 175.0;
export const LANDER_DRY = 83.0;
export const LANDER_RESIDUAL = 2.0;
export const THRUST_N = 0.046;            // ion thruster, commanded level until T_THROTTLE_UP
export const ISP_ION = 2000.0;
export const ISP_CHEM = 319.5;
// The duty-cycle tuning: the thrust-hour total the 365-day profile reached at jettison. It fixes
// the duty scale and so every value through day 303; the retimed total is THRUST_HOURS_AT_JETTISON.
export const THRUST_HOURS_TUNED = 5044.0;

// Timeline, mission days
export const T_IGNITION = 6 + 14 / 24;
export const T_FULL = 7.0;
export const T_CROSSOVER = 259.0;          // the tuning anchor; the page reads crossoverDay()
export const T_THROTTLE_UP = 303.0;        // last day of the 365-day profile; ion thrust raised
export const T_CAPTURE = 329.0;
export const T_MOON_REFERENCE = 331.0;
export const T_LOWER = 334.0;
export const T_LOW_ORBIT = 345.0;
export const T_JETTISON = 346 + 10 / 24;
export const T_LEGS = 347.0;
export const T_CONTACT = LAST_DAY;         // 349: touchdown, 2027-08-15 00:00 Pacific
export const PDI_MIN = 14.4;
export const DEORBIT_MIN = 7.0;
export const DEORBIT_KG = 6.5;
export const PDI_KG = LANDER_WET - LANDER_DRY - LANDER_RESIDUAL - DEORBIT_KG;

// The 365-day profile's capture and jettison: the spiral curves are anchored on them, and the
// thrust after day 303 is set so the spiral reaches the old day-339 orbit on T_CAPTURE.
const TUNED_CAPTURE = 339.0;
const TUNED_JETTISON = 362 + 10 / 24;
export const THROTTLE = (TUNED_CAPTURE - T_THROTTLE_UP) / (T_CAPTURE - T_THROTTLE_UP);   // 36/26
export const THRUST_HIGH_N = THRUST_N * THROTTLE;

// Geometry anchors
export const RP_GTO = R_EARTH + 250.0;
export const RA_GTO = R_EARTH + 35786.0;
export const LOW_ORBIT_R = R_MOON + 700.0;
export const PERILUNE_R = R_MOON + 15.0;

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

function pchip(xs, ys) {
  // Monotone cubic interpolation (Fritsch-Carlson): no overshoot between anchors.
  const n = xs.length;
  const h = [];
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = [d[0], ...new Array(n - 2).fill(0), d[n - 2]];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] > 0) {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    for (let k = 0; k < n - 1; k++) if (xs[k] <= x) i = k;
    const t = (x - xs[i]) / h[i];
    return (2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] + (t ** 3 - 2 * t ** 2 + t) * h[i] * m[i]
      + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] + (t ** 3 - t ** 2) * h[i] * m[i + 1];
  };
}

function angDia(radius, distance) {
  return 2 * Math.asin(Math.min(1, radius / distance)) * DEG;
}

function distForDia(radius, degrees) {
  return radius / Math.sin((degrees / 2) * RAD);
}

// Earth spiral. The curves live in the 365-day profile's time; spiralTime maps mission time onto
// it, the identity through day 303 and THROTTLE times faster after, so the orbit grows with the
// thrust and reaches the old capture orbit on T_CAPTURE.
export const RA_CAPTURE = MOON_DIST - distForDia(R_MOON, 6.0);
const raCurve = pchip([T_FULL, T_CROSSOVER, TUNED_CAPTURE], [RA_GTO, 302106.0, RA_CAPTURE]);
const rpCurve = pchip([T_FULL, 90.0, TUNED_CAPTURE], [RP_GTO, 20000.0, 40000.0]);

function spiralTime(t) {
  if (t <= T_THROTTLE_UP) return t;
  if (t >= T_CAPTURE) return TUNED_CAPTURE;
  return T_THROTTLE_UP + (t - T_THROTTLE_UP) * THROTTLE;
}

export function apogee(t) {
  return t <= T_FULL ? RA_GTO : raCurve(Math.min(spiralTime(t), TUNED_CAPTURE));
}

export function perigee(t) {
  return t <= T_FULL ? RP_GTO : rpCurve(Math.min(spiralTime(t), TUNED_CAPTURE));
}

export function semiMajorAxis(t) {
  return (apogee(t) + perigee(t)) / 2;
}

export function eccentricity(t) {
  return (apogee(t) - perigee(t)) / (apogee(t) + perigee(t));
}

export function periodHours(t) {
  const a = semiMajorAxis(t);
  return (2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH)) / 3600;
}

export function orbitalEnergy(t) {
  return -MU_EARTH / (2 * semiMajorAxis(t));
}

// Duty cycle: the share of time the thruster fires at its commanded level. A plausible shape,
// scaled once by the 365-day thrust-hour tuning. After the throttle-up the spiral keeps its 0.62
// shape (the extra thrust is what shortens it); the lunar phase fires just long enough to spend
// the xenon the old profile spent there, so the stack arrives at jettison with the same mass.
const LUNAR_SHAPE = (0.7 * (TUNED_JETTISON - TUNED_CAPTURE)) / ((T_JETTISON - T_CAPTURE) * THROTTLE);

function dutyShape(t) {
  if (t < T_IGNITION || t >= T_JETTISON) return 0;
  if (t < T_FULL) return 0.4;
  if (t < 90) return 0.5 + (0.1 * (t - T_FULL)) / (90 - T_FULL);
  if (t < T_CAPTURE) return 0.62;
  return LUNAR_SHAPE;
}

function shapeIntegral(t, capture, jettison, lunar) {
  const span = (a, b) => (t > a ? Math.max(0, Math.min(t, b) - a) : 0);
  let total = 0.4 * span(T_IGNITION, T_FULL);
  const x = span(T_FULL, 90.0);
  total += 0.5 * x + (0.1 * x * x) / (2 * (90.0 - T_FULL));
  total += 0.62 * span(90.0, capture);
  total += lunar * span(capture, jettison);
  return total;
}

const DUTY_SCALE = THRUST_HOURS_TUNED / (24 * shapeIntegral(TUNED_JETTISON, TUNED_CAPTURE, TUNED_JETTISON, 0.7));

export function duty(t) {
  return DUTY_SCALE * dutyShape(t);
}

// Hours the thruster has fired, at whatever level it was commanded.
export function thrustHours(t) {
  return 24 * DUTY_SCALE * shapeIntegral(Math.min(Math.max(t, 0), T_CONTACT), T_CAPTURE, T_JETTISON, LUNAR_SHAPE);
}

export const THRUST_HOURS_AT_JETTISON = thrustHours(T_JETTISON);

export const MDOT_ION = THRUST_N / (ISP_ION * G0);
export const MDOT_ION_HIGH = THRUST_HIGH_N / (ISP_ION * G0);
export const VE_ION = ISP_ION * G0;
export const VE_CHEM = ISP_CHEM * G0;

const HOURS_AT_THROTTLE_UP = thrustHours(T_THROTTLE_UP);
const XENON_AT_THROTTLE_UP = MDOT_ION * HOURS_AT_THROTTLE_UP * 3600;

// Commanded ion thrust, N, and the mass flow it draws while firing, kg/s.
export function ionThrust(t) {
  return t <= T_THROTTLE_UP ? THRUST_N : THRUST_HIGH_N;
}

export function ionMassFlow(t) {
  return t <= T_THROTTLE_UP ? MDOT_ION : MDOT_ION_HIGH;
}

// Each thrust hour is charged at the mass flow of the level it was fired at.
export function xenonUsed(t) {
  if (t <= T_THROTTLE_UP) return MDOT_ION * thrustHours(t) * 3600;
  return XENON_AT_THROTTLE_UP + MDOT_ION_HIGH * (thrustHours(t) - HOURS_AT_THROTTLE_UP) * 3600;
}

export function xenonRemaining(t) {
  return XENON_LOAD - xenonUsed(Math.min(t, T_JETTISON));
}

// Lunar phase
const logMoonRange = pchip(
  [T_CAPTURE, T_LOWER, T_LOW_ORBIT, T_JETTISON],
  [Math.log(distForDia(R_MOON, 6.0)), Math.log(distForDia(R_MOON, 11.0)),
    Math.log(distForDia(R_MOON, 40.0)), Math.log(LOW_ORBIT_R)],
);
export const T_PDI = T_CONTACT - PDI_MIN / 1440;
const A_T = (LOW_ORBIT_R + PERILUNE_R) / 2;
const E_T = (LOW_ORBIT_R - PERILUNE_R) / (LOW_ORBIT_R + PERILUNE_R);
const HALF_T = (Math.PI * Math.sqrt(A_T ** 3 / MU_MOON)) / 86400;
export const T_DEORBIT_END = T_PDI - HALF_T;
export const T_DEORBIT = T_DEORBIT_END - DEORBIT_MIN / 1440;

export function moonCentreRange(t) {
  if (t <= T_JETTISON) return Math.exp(logMoonRange(Math.max(t, T_CAPTURE)));
  if (t <= T_DEORBIT_END) return LOW_ORBIT_R;
  if (t < T_PDI) {
    const mean = Math.PI + (Math.PI * (t - T_DEORBIT_END)) / HALF_T;
    let ecc = mean;
    for (let i = 0; i < 30; i++) ecc -= (ecc - E_T * Math.sin(ecc) - mean) / (1 - E_T * Math.cos(ecc));
    return A_T * (1 - E_T * Math.cos(ecc));
  }
  if (t < T_CONTACT) {
    const s = (t - T_PDI) / (T_CONTACT - T_PDI);
    return R_MOON + 15.0 * (1 - s) ** 1.5;
  }
  return R_MOON;
}

export function altitude(t) {
  return moonCentreRange(t) - R_MOON;
}

export function mass(t) {
  if (t < T_JETTISON) return STACK_WET - xenonUsed(t);
  if (t < T_DEORBIT) return LANDER_WET;
  if (t < T_DEORBIT_END) return LANDER_WET - (DEORBIT_KG * (t - T_DEORBIT)) / (T_DEORBIT_END - T_DEORBIT);
  if (t < T_PDI) return LANDER_WET - DEORBIT_KG;
  if (t < T_CONTACT) return LANDER_WET - DEORBIT_KG - (PDI_KG * (t - T_PDI)) / (T_CONTACT - T_PDI);
  return LANDER_DRY + LANDER_RESIDUAL;
}

export function deltaVRemaining(t) {
  if (t < T_JETTISON) {
    const m = mass(t);
    return VE_ION * Math.log(m / (m - xenonRemaining(t)));
  }
  return VE_CHEM * Math.log(mass(t) / (LANDER_DRY + LANDER_RESIDUAL));
}

// Osculating apogee during the spiral, the quantity the hero view frames on.
export function rangeFromEarthHero(t) {
  return t <= T_CAPTURE ? apogee(t) : MOON_DIST - moonCentreRange(t);
}

// Disc sizes for the hero view, from the osculating orbit so the bodies never pulse (system
// spec §7.1.1). The reference model's earth_angular_dia and moon_angular_dia. After capture they
// equal the true angles.
export function heroEarthAngularDia(t) {
  return angDia(R_EARTH, rangeFromEarthHero(t));
}

export function heroMoonAngularDia(t) {
  if (t <= T_CAPTURE) return angDia(R_MOON, MOON_DIST - apogee(t));
  return angDia(R_MOON, moonCentreRange(t));
}

export function referenceBody(t) {
  return t < T_MOON_REFERENCE ? 'Earth' : 'Moon';
}

// Phases, with the reference model's labels for display.
export const PHASES = [
  { id: 'transfer-checkout', label: 'transfer orbit, checkout', end: T_IGNITION },
  { id: 'first-ignition', label: 'first ignition', end: T_FULL },
  { id: 'earth-spiral', label: 'Earth spiral', end: T_CAPTURE },
  { id: 'lunar-capture', label: 'lunar capture', end: T_LOWER },
  { id: 'orbit-lowering', label: 'lunar orbit lowering', end: T_JETTISON },
  { id: 'parking-orbit', label: 'lander in parking orbit', end: T_DEORBIT },
  { id: 'deorbit', label: 'deorbit and descent orbit', end: T_PDI },
  { id: 'powered-descent', label: 'powered descent', end: T_CONTACT },
  { id: 'surface', label: 'surface', end: Infinity },
];

function phaseEntry(t) {
  return PHASES.find((p) => t < p.end);
}

export function phaseLabel(t) {
  return phaseEntry(t).label;
}

// Cumulative spiral revolutions on a 0.01-day midpoint grid, as the reference model builds it.
// Through day 303 this is the 365-day profile's grid, over that profile's spiral. After the
// throttle-up a second grid integrates the faster spiral's own periods, scaled by REV_SCALE
// (within a few percent of one) so the last apogee still falls exactly on T_CAPTURE 00:00.
const REV_STEP = 0.01;

function tunedPeriodHours(u) {
  const a = ((u <= T_FULL ? RA_GTO : raCurve(Math.min(u, TUNED_CAPTURE)))
    + (u <= T_FULL ? RP_GTO : rpCurve(Math.min(u, TUNED_CAPTURE)))) / 2;
  return (2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH)) / 3600;
}

const REV = [0];
for (let i = 0; i < Math.round(TUNED_CAPTURE / REV_STEP); i++) {
  REV.push(REV[REV.length - 1] + (REV_STEP * 24) / tunedPeriodHours((i + 0.5) * REV_STEP));
}
const REV_TUNED_END = REV[REV.length - 1];
const REV_AT_THROTTLE_UP = REV[Math.round(T_THROTTLE_UP / REV_STEP)];

const LATE_CELLS = Math.round((T_CAPTURE - T_THROTTLE_UP) / REV_STEP);
const lateCell = (i) => (REV_STEP * 24) / periodHours(T_THROTTLE_UP + (i + 0.5) * REV_STEP);
let lateKepler = 0;
for (let i = 0; i < LATE_CELLS; i++) lateKepler += lateCell(i);
const OLD_LATE = REV_TUNED_END - REV_AT_THROTTLE_UP;
export const REV_SCALE = (OLD_LATE - Math.round(OLD_LATE - lateKepler)) / lateKepler;
const REV_LATE = [REV_AT_THROTTLE_UP];
for (let i = 0; i < LATE_CELLS; i++) REV_LATE.push(REV_LATE[i] + REV_SCALE * lateCell(i));
const REV_END = REV_LATE[LATE_CELLS];

export function revolutionNumber(t) {
  if (t <= T_THROTTLE_UP) {
    const c = Math.max(t, 0);
    return Math.floor(REV[Math.min(Math.trunc(c / REV_STEP), REV.length - 1)]);
  }
  const c = Math.min(t, T_CAPTURE);
  return Math.floor(REV_LATE[Math.min(Math.trunc((c - T_THROTTLE_UP) / REV_STEP), LATE_CELLS)]);
}

// Continuous revolutions: the grid, integrated linearly within each cell.
function revolutions(t) {
  if (t <= T_THROTTLE_UP) {
    const c = Math.max(t, 0);
    const i = Math.min(Math.floor(c / REV_STEP), REV.length - 2);
    return REV[i] + ((c - i * REV_STEP) * 24) / tunedPeriodHours((i + 0.5) * REV_STEP);
  }
  if (t >= T_CAPTURE) return REV_END;
  const i = Math.min(Math.floor((t - T_THROTTLE_UP) / REV_STEP), LATE_CELLS - 1);
  const into = t - (T_THROTTLE_UP + i * REV_STEP);
  return REV_LATE[i] + (REV_SCALE * into * 24) / periodHours(T_THROTTLE_UP + (i + 0.5) * REV_STEP);
}

function eccentricAnomaly(mean, e) {
  let E = mean;
  for (let i = 0; i < 50; i++) {
    const step = (E - e * Math.sin(E) - mean) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-15) break;
  }
  return E;
}

// Position on the current spiral ellipse. The anomaly is phased backwards from capture, so the
// last spiral apogee falls exactly at T_CAPTURE 00:00 and the range hands over without a jump.
// Through day 303 the phase is the 365-day profile's; the late grid differs from it by a whole
// number of turns at the throttle-up, so the craft does not jump there either.
function spiralPosition(t) {
  const a = semiMajorAxis(t);
  const e = eccentricity(t);
  const turns = t <= T_THROTTLE_UP ? revolutions(t) - REV_TUNED_END : revolutions(t) - REV_END;
  const mean = ((((Math.PI + 2 * Math.PI * turns) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  const E = eccentricAnomaly(mean, e);
  const trueAnomaly = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return { a, e, r: a * (1 - e * Math.cos(E)), trueAnomaly: (trueAnomaly * DEG + 360) % 360 };
}

// Instantaneous distance from Earth's centre, km. During the spiral it swings between perigee
// and apogee every revolution; from capture it is the mean Earth-Moon distance less the
// distance from the Moon's centre.
export function rangeFromEarth(t) {
  const c = Math.max(t, 0);
  return c <= T_CAPTURE ? spiralPosition(c).r : MOON_DIST - moonCentreRange(c);
}

const V_PARKING = 1000 * Math.sqrt(MU_MOON / LOW_ORBIT_R);
const V_APOLUNE = 1000 * Math.sqrt(MU_MOON * (2 / LOW_ORBIT_R - 1 / A_T));
const V_PERILUNE = 1000 * Math.sqrt(MU_MOON * (2 / PERILUNE_R - 1 / A_T));

// Speed relative to the reference body, m/s. Continuous except at T_MOON_REFERENCE, where the
// reference body changes from Earth to the Moon and the readout changes frame with it.
export function velocity(t) {
  const c = Math.min(Math.max(t, 0), T_CONTACT);
  return velocityAt(c, c <= T_CAPTURE ? spiralPosition(c) : null);
}

function velocityAt(c, position) {
  if (c <= T_CAPTURE) {
    const { a, r } = position;
    return 1000 * Math.sqrt(MU_EARTH * (2 / r - 1 / a));
  }
  if (c < T_MOON_REFERENCE) {
    const r = MOON_DIST - moonCentreRange(c);
    return 1000 * Math.sqrt(MU_EARTH * (2 / r - 1 / semiMajorAxis(T_CAPTURE)));
  }
  if (c <= T_DEORBIT) return 1000 * Math.sqrt(MU_MOON / moonCentreRange(c));
  if (c < T_DEORBIT_END) return V_PARKING + ((V_APOLUNE - V_PARKING) * (c - T_DEORBIT)) / (T_DEORBIT_END - T_DEORBIT);
  if (c < T_PDI) return 1000 * Math.sqrt(MU_MOON * (2 / moonCentreRange(c) - 1 / A_T));
  if (c < T_CONTACT) return (V_PERILUNE * deltaVRemaining(c)) / deltaVRemaining(T_PDI);
  return 0;
}

// Rate of change of altitude above the Moon, m/s, positive rising: a central difference over one
// second, held inside the mission. Meaningful from capture onward, where the chrome shows altitude;
// before capture the lunar range is held at its capture value, so this is zero.
export function verticalSpeed(t) {
  if (t >= T_CONTACT) return 0;   // on the surface from the instant of contact
  const h = 1 / 86400;
  const a = Math.min(Math.max(t - h, 0), T_CONTACT);
  const b = Math.min(Math.max(t + h, 0), T_CONTACT);
  if (b <= a) return 0;
  return ((altitude(b) - altitude(a)) * 1000) / ((b - a) * 86400);
}

// Delta-v actually spent since launch, electric then chemical, m/s.
function deltaVSpent(t) {
  if (t < T_JETTISON) return VE_ION * Math.log(STACK_WET / mass(t));
  const electric = VE_ION * Math.log(STACK_WET / (STACK_WET - xenonUsed(T_JETTISON)));
  return electric + VE_CHEM * Math.log(LANDER_WET / mass(t));
}

// The spiral's share of the whole arc. The retimed profile spends the same xenon by capture and
// by jettison as the 365-day one did, so the share is taken from that profile's own arithmetic:
// trajectoryFraction through day 303 stays bit-for-bit what it was.
function tunedXenonUsed(u) {
  return MDOT_ION * (24 * DUTY_SCALE * shapeIntegral(u, TUNED_CAPTURE, TUNED_JETTISON, 0.7)) * 3600;
}
const TUNED_SPIRAL_DV = VE_ION * Math.log(STACK_WET / (STACK_WET - tunedXenonUsed(TUNED_CAPTURE)));
const TUNED_TOTAL_DV = VE_ION * Math.log(STACK_WET / (STACK_WET - tunedXenonUsed(TUNED_JETTISON)))
  + VE_CHEM * Math.log(LANDER_WET / (LANDER_DRY + LANDER_RESIDUAL));

const E_START = orbitalEnergy(0);
const E_CAPTURE = orbitalEnergy(T_CAPTURE);
const LOG_RC_CAPTURE = Math.log(moonCentreRange(T_CAPTURE));
const SPIRAL_SHARE = TUNED_SPIRAL_DV / TUNED_TOTAL_DV;

// Position along the arc, 0 at launch and 1 at contact. The spiral advances with orbital
// energy and the arrival with the logarithm of distance to the Moon's centre; the two are
// joined at capture in proportion to the delta-v each spends, so the fraction never runs
// backwards and has no jump.
export function trajectoryFraction(t) {
  const c = Math.min(Math.max(t, 0), T_CONTACT);
  if (c <= T_CAPTURE) return (SPIRAL_SHARE * (orbitalEnergy(c) - E_START)) / (E_CAPTURE - E_START);
  const arrival = (LOG_RC_CAPTURE - Math.log(moonCentreRange(c))) / (LOG_RC_CAPTURE - Math.log(R_MOON));
  return SPIRAL_SHARE + (1 - SPIRAL_SHARE) * arrival;
}

// The day Earth and the Moon subtend the same angle in the hero view, read from the model and
// never written down, so a retuned profile moves the beat with it. Bracketed on the 365-day
// spiral's span, which keeps every probe before day 303 and the answer bit-for-bit as it was.
export function crossoverDay() {
  let lo = T_FULL;
  let hi = TUNED_CAPTURE;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (heroEarthAngularDia(mid) > heroMoonAngularDia(mid)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const CROSSOVER_DAY = crossoverDay();

function wrap360(x) {
  return ((x % 360) + 360) % 360;
}

// Low-precision sun and Moon ecliptic longitudes (Astronomical Almanac series), good to a
// fraction of a degree, which is far inside what a terminator on screen can show.
export function sky(t) {
  const n = utcMsOfMissionT(t) / 86400000 + 2440587.5 - 2451545.0;
  const sunMean = 280.46 + 0.9856474 * n;
  const sunAnomaly = (357.528 + 0.9856003 * n) * RAD;
  const sunLongitude = wrap360(sunMean + 1.915 * Math.sin(sunAnomaly) + 0.02 * Math.sin(2 * sunAnomaly));
  const obliquity = (23.439 - 0.0000004 * n) * RAD;
  const sunDeclination = Math.asin(Math.sin(obliquity) * Math.sin(sunLongitude * RAD)) * DEG;
  const moonMean = 218.316 + 13.176396 * n;
  const moonAnomaly = (134.963 + 13.064993 * n) * RAD;
  const meanElongation = (moonMean - sunMean) * RAD;
  const moonLongitude = wrap360(moonMean + 6.289 * Math.sin(moonAnomaly)
    + 1.274 * Math.sin(2 * meanElongation - moonAnomaly) + 0.658 * Math.sin(2 * meanElongation)
    - 0.186 * Math.sin(sunAnomaly));
  const elongation = Math.abs(wrap360(moonLongitude - sunLongitude + 180) - 180);
  return { sunLongitude, sunDeclination, moonLongitude, elongation };
}

// Display days (system spec §7.7.3), all derived from the timeline. The hero view changes mode on
// the day after capture (330) and on the last day before contact (348); the approach anchor eases
// over APPROACH_EASE_DAYS from APPROACH_DAY. The escalation's second step (11° to 40°: telemetry
// gains thrust hours, figures every second day, faster puffs) starts the day after lowering
// begins (335). The third step is one mechanical beat a day: jettison (346), legs (347),
// descent (348), contact (349).
export const APPROACH_DAY = T_CAPTURE + 1;
export const APPROACH_EASE_DAYS = 10;
export const SECOND_STEP_DAY = T_LOWER + 1;
export const JETTISON_DAY = Math.floor(T_JETTISON);
export const LEGS_DAY = T_LEGS;
export const DESCENT_DAY = T_CONTACT - 1;
export const CONTACT_DAY = T_CONTACT;

export function mode(t) {
  if (t < 0) return 'prelaunch';
  if (t < T_FULL) return 'limb';
  if (t < APPROACH_DAY) return 'tableau';
  if (t < DESCENT_DAY) return 'approach';
  if (t < T_CONTACT) return 'descent';
  return 'monument';
}

// Mission events in order, for countdowns: the readable profile's timeline.
export const EVENTS = [
  { id: 'launch', t: 0 },
  { id: 'array-deployment', t: 1 },
  { id: 'first-ignition', t: T_IGNITION },
  { id: 'full-thrust', t: T_FULL },
  { id: 'perigee-clears-belts', t: 90 },
  { id: 'crossover', t: CROSSOVER_DAY },
  { id: 'capture', t: T_CAPTURE },
  { id: 'reference-moon', t: T_MOON_REFERENCE },
  { id: 'orbit-lowering', t: T_LOWER },
  { id: 'jettison', t: T_JETTISON },
  { id: 'legs', t: T_LEGS },
  { id: 'deorbit', t: T_DEORBIT },
  { id: 'powered-descent', t: T_PDI },
  { id: 'touchdown', t: T_CONTACT },
];

// The orbit about the Moon from capture until powered descent: circular while the range
// shrinks and in the parking orbit, then the descent ellipse.
function lunarOrbit(c) {
  if (c >= T_PDI) return null;
  const descending = c > T_DEORBIT_END;
  const a = descending ? A_T : moonCentreRange(c);
  return {
    body: 'Moon', semiMajorAxis: a, eccentricity: descending ? E_T : 0,
    periodHours: (2 * Math.PI * Math.sqrt(a ** 3 / MU_MOON)) / 3600,
  };
}

// Far enough either side that the vehicle has long since landed, near enough that the sky stays
// inside the range a Date can hold.
const T_LIMIT = 100000;

// Everything the page shows at mission time t. NaN is refused; infinite or enormous times are
// held at T_LIMIT. Telemetry fields are instantaneous and swing with each revolution; hero fields
// size the discs and never pulse. The two agree from capture onward.
export function state(time) {
  if (typeof time !== 'number' || Number.isNaN(time)) throw new RangeError(`mission time must be a number, got ${time}`);
  const t = Math.min(Math.max(time, -T_LIMIT), T_LIMIT);
  const c = Math.min(Math.max(t, 0), T_CONTACT);
  const position = c <= T_CAPTURE ? spiralPosition(c) : null;
  const rE = position ? position.r : MOON_DIST - moonCentreRange(c);
  const rM = position ? MOON_DIST - rE : moonCentreRange(c);
  const { sunLongitude, sunDeclination, moonLongitude, elongation } = sky(t);
  // The craft is drawn on the Earth-Moon line, so it sees the Moon's phase as Earth does and
  // Earth's phase as the Moon does. Terminator direction is the renderer's sun vector (§6.3.1).
  const moonPhase = (1 - Math.cos(elongation * RAD)) / 2;
  const phase = t < 0 ? { id: 'prelaunch', label: 'prelaunch' } : phaseEntry(c);
  const next = EVENTS.find((e) => e.t > t);
  const orbit = position
    ? {
      body: 'Earth', apogee: apogee(c), perigee: perigee(c), semiMajorAxis: semiMajorAxis(c),
      eccentricity: eccentricity(c), periodHours: periodHours(c), energy: orbitalEnergy(c),
      trueAnomaly: position.trueAnomaly,
    }
    : lunarOrbit(c);
  return {
    t,
    phase: phase.id,
    phaseLabel: phase.label,
    mode: mode(t),
    referenceBody: referenceBody(c),
    // rangeToMoon is measured along the Earth-Moon line, so the two ranges sum to MOON_DIST.
    rangeFromEarth: rE,
    rangeToMoon: rM,
    altitude: rM - R_MOON,
    earthAngularDia: angDia(R_EARTH, rE),
    moonAngularDia: angDia(R_MOON, rM),
    velocity: velocityAt(c, position),
    verticalSpeed: verticalSpeed(t),
    deltaVRemaining: deltaVRemaining(c),
    lightDelay: rE / C_KMS,
    heroRangeFromEarth: rangeFromEarthHero(c),
    heroEarthAngularDia: heroEarthAngularDia(c),
    heroMoonAngularDia: heroMoonAngularDia(c),
    crossoverDay: CROSSOVER_DAY,
    elongation,
    sunLongitude,
    sunDeclination,
    moonLongitude,
    earthPhase: 1 - moonPhase,
    moonPhase,
    trajectoryFraction: trajectoryFraction(c),
    orbit,
    timeToTouchdown: Math.max(0, T_CONTACT - t),
    nextEvent: next ? { id: next.id, t: next.t, inDays: next.t - t } : null,
    revolution: revolutionNumber(c),
    duty: duty(c),
    thrustHours: thrustHours(c),
    xenonUsed: xenonUsed(Math.min(c, T_JETTISON)),
    xenonRemaining: xenonRemaining(c),
    mass: mass(c),
    cruiseModuleAttached: c < T_JETTISON,
    legsDeployed: c >= T_LEGS,
    chemicalEngineOn: (c >= T_DEORBIT && c < T_DEORBIT_END) || (c >= T_PDI && c < T_CONTACT),
  };
}
