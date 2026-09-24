// Mission time and US Pacific civil time.
//
// All time enters the page through missionTFromDate, so tests can drive any instant. Mission
// time t is continuous and measured in days: t = 0 is 2026-08-31 00:00 Pacific, t = 365 is
// touchdown at 2027-08-31 00:00 Pacific. The integer part is the count of Pacific midnights
// since launch, so no day is ever skipped or repeated. The fractional part is the share of the
// current Pacific day elapsed, measured against that day's true length, so the 23- and 25-hour
// days at the daylight-saving changes still run from 0 to 1 and mission time never runs
// backwards.
//
// The daylight-saving rule is computed rather than read from Intl, which keeps the physics
// table pure: the same t gives the same instant on every machine, forever.

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

// Civil day number: whole days from 1970-01-01 to the given calendar date.
function civilDayNumber(year, month, day) {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export const LAUNCH_DAY_NUMBER = civilDayNumber(2026, 8, 31);

// UTC midnight of the nth Sunday of a month, month counted from 0.
function nthSunday(year, monthIndex, n) {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return Date.UTC(year, monthIndex, 1 + ((7 - firstWeekday) % 7) + 7 * (n - 1));
}

// US rule since 2007: daylight time from 02:00 standard on the second Sunday of March to
// 02:00 daylight on the first Sunday of November.
export function pacificOffsetMs(utcMs) {
  const year = new Date(utcMs).getUTCFullYear();
  const start = nthSunday(year, 2, 2) + 10 * HOUR_MS;
  const end = nthSunday(year, 10, 1) + 9 * HOUR_MS;
  return utcMs >= start && utcMs < end ? -7 * HOUR_MS : -8 * HOUR_MS;
}

// The UTC instant of the Pacific midnight that begins a civil day. Midnight is never within an
// hour of a daylight-saving change, so one correction from a standard-time guess is exact.
export function pacificMidnightUtc(dayNumber) {
  const wall = dayNumber * DAY_MS;
  return wall - pacificOffsetMs(wall + 8 * HOUR_MS);
}

export function missionTFromDate(date) {
  const utc = +date;
  const dayNumber = Math.floor((utc + pacificOffsetMs(utc)) / DAY_MS);
  const start = pacificMidnightUtc(dayNumber);
  const end = pacificMidnightUtc(dayNumber + 1);
  return dayNumber - LAUNCH_DAY_NUMBER + (utc - start) / (end - start);
}

export function utcMsOfMissionT(t) {
  const day = Math.floor(t);
  const start = pacificMidnightUtc(LAUNCH_DAY_NUMBER + day);
  const end = pacificMidnightUtc(LAUNCH_DAY_NUMBER + day + 1);
  return start + (t - day) * (end - start);
}

// Mission time of a Pacific wall-clock time on a mission day, such as the archive's 18:00. On
// the two daylight-saving days the fractional part of t is not hours / 24, so anything pinned
// to a clock time converts here. A time inside the skipped or repeated hour takes one of its
// instants.
export function missionTAtPacificClock(day, hour, minute = 0) {
  const wall = (LAUNCH_DAY_NUMBER + day) * DAY_MS + hour * HOUR_MS + minute * 60000;
  let utc = wall - pacificOffsetMs(wall + 8 * HOUR_MS);
  utc = wall - pacificOffsetMs(utc);
  return missionTFromDate(utc);
}

// Hours since Pacific midnight on the wall clock, 0 to 24, for beats scheduled in displayed-day
// hours. On the day the clocks fall back, the repeated hour repeats here too.
export function pacificHour(t) {
  const utc = utcMsOfMissionT(t);
  const wall = utc + pacificOffsetMs(utc);
  return (((wall % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
}

// Pacific wall-clock time of a mission time, as "YYYY-MM-DD HH:MM".
export function pacificStamp(t) {
  const utc = Math.round(utcMsOfMissionT(t));
  return new Date(utc + pacificOffsetMs(utc)).toISOString().slice(0, 16).replace('T', ' ');
}
