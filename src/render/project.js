// Projections shared by every module that places something on a body or on the screen.

import { RAD } from './util.js';
import { VIEW } from './scale.js';

// Orthographic projection of a selenographic point onto the unit disc, camera over
// (lat0, lon0), north up and screen y down (system spec §6.5). cosc <= 0 is the far side.
export function projectSphere(lat, lon, { lat0, lon0 }) {
  const la = lat * RAD;
  const dl = (lon - lon0) * RAD;
  const la0 = lat0 * RAD;
  const cosc = Math.sin(la) * Math.sin(la0) + Math.cos(la) * Math.cos(la0) * Math.cos(dl);
  const x = Math.cos(la) * Math.sin(dl);
  const y = Math.cos(la0) * Math.sin(la) - Math.sin(la0) * Math.cos(la) * Math.cos(dl);
  return { x, y: -y, cosc };
}

export const projectMoon = (lat, lon, camera) => projectSphere(lat, lon, camera);

// Earth is the same projection with the camera over the equator and longitude turning under
// it: a globe, not a spinning record (spec §6.4 as amended). EARTH_LAT0 tips the north a little
// toward the craft so the continents read.
export const EARTH_LAT0 = 12;
export function projectEarth(lat, lon, spinDeg) {
  return projectSphere(lat, lon, { lat0: EARTH_LAT0, lon0: -spinDeg });
}

// A unit-disc point on a body drawn at { cx, cy, r } in viewBox units.
export const onDisc = (p, disc) => ({ x: disc.cx + p.x * disc.r, y: disc.cy + p.y * disc.r });

// preserveAspectRatio="xMidYMid slice": the viewBox scales to cover the element, centred. The
// canvas layer uses the same mapping so particles sit exactly on the SVG they belong to.
export function sliceTransform(clientW, clientH) {
  const scale = Math.max(clientW / VIEW.w, clientH / VIEW.h);
  return { scale, dx: (clientW - VIEW.w * scale) / 2, dy: (clientH - VIEW.h * scale) / 2 };
}

export const viewToClient = (x, y, T) => ({ x: T.dx + x * T.scale, y: T.dy + y * T.scale });
