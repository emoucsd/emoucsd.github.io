// Hero framing: where Earth, the Moon and the ship sit in the 1600 × 900 stage, and how large the
// bodies are drawn (system spec §7.1).
//
// Owner ruling, 2026-09-12: body sizes are aesthetic. What must be true is that a body grows on
// screen as the craft closes on it and shrinks as the craft leaves. Both bodies take one size law
// from their hero angles, which only ever move in the right direction, so that holds by
// construction, and equal angles on the crossover day still draw equal discs.

import { clamp, lerp, smoothstep } from './util.js';

export const VIEW = { w: 1600, h: 900 };

// Tuned on the contact sheet, not to true angles: a steeper law left both bodies as specks from
// week three to month eleven, and the year did not read. With this one the Moon is a visible disc
// from launch (0.58°, radius 25), Earth fills a good part of the frame in month one (17.4°,
// radius 200) and is still a disc at day 90 (radius 100), both are radius 60 at the crossover,
// the Moon is 104 at capture and 335 at 40°, and Earth ends as a marble (1.91°, radius 52).
export const SIZE_K = 34.9;
export const SIZE_GAMMA = 0.613;
export const R_MAX = 2200;

export function discRadius(thetaDeg) {
  return Math.min(R_MAX, SIZE_K * Math.max(thetaDeg, 0) ** SIZE_GAMMA);
}

const unit = (x, y) => {
  const n = Math.hypot(x, y);
  return { x: x / n, y: y / n };
};

export const EARTH_ANCHOR = { x: 300, y: 700 };
export const EARTH_OUT = unit(-0.42, 0.91);
export const MOON_ANCHOR = { x: 1250, y: 250 };
export const MOON_OUT = unit(0.44, -0.9);
export const MOON_ANCHOR_APPROACH = { x: 800, y: 200 };
export const SHIP_TABLEAU = { x: 0.485, y: 0.575 };
export const SHIP_APPROACH = { x: 0.5, y: 0.68 };
export const SHIP_DESCENT = { x: 0.5, y: 0.7 };
export const LIMB_EARTH = { cx: 800, cy: 1480, r: 1100 };
export const LIMB_MOON = { x: 1180, y: 180 };
export const GROUND_MOON = { cx: 800, cy: 2400, r: 2800 };
export const SKY_EARTH = { cx: 420, cy: 160, r: 26 };
export const CONTACT_DROP_PX = 40;

// With preserveAspectRatio slice, a stage narrower than 16:9 shows only a central band of the
// viewBox, and a wider one only a central strip. Anchors are squeezed toward the centre by the
// same factor, so both limbs stay in shot at 360px portrait as well as on an ultra-wide monitor.
export function squeeze(aspect = VIEW.w / VIEW.h) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : VIEW.w / VIEW.h;
  return {
    x: clamp((VIEW.h * a) / VIEW.w, 0.3, 1),
    y: clamp(VIEW.w / (VIEW.h * a), 0.3, 1),
  };
}

// The visible part of the viewBox for a stage aspect ratio, in viewBox units.
export function visibleRect(aspect) {
  const k = squeeze(aspect);
  const w = VIEW.w * k.x;
  const h = VIEW.h * k.y;
  return { x: (VIEW.w - w) / 2, y: (VIEW.h - h) / 2, w, h };
}

// The layout for a state and a stage aspect ratio (width / height, default 16:9). Discs are
// { cx, cy, r } in viewBox units with a `visible` flag; the ship is { x, y, scale } in viewBox
// units. `ground` marks the Moon as terrain in descent.
export function heroLayout(s, aspect = VIEW.w / VIEW.h) {
  const k = squeeze(aspect);
  const sx = (x) => VIEW.w / 2 + (x - VIEW.w / 2) * k.x;
  const sy = (y) => VIEW.h / 2 + (y - VIEW.h / 2) * k.y;
  const rE = discRadius(s.heroEarthAngularDia);
  const rM = discRadius(s.heroMoonAngularDia);
  const onAnchor = (anchor, out, r) => ({ cx: sx(anchor.x) + r * out.x, cy: sy(anchor.y) + r * out.y, r });
  const ship = (p, scale = 1, drop = 0) => ({ x: sx(p.x * VIEW.w), y: sy(p.y * VIEW.h) + drop, scale });

  switch (s.mode) {
    case 'prelaunch':
    case 'limb':
      return {
        earth: { ...LIMB_EARTH, visible: true, ground: false },
        moon: { cx: sx(LIMB_MOON.x), cy: sy(LIMB_MOON.y), r: rM, visible: 2 * rM >= 6, ground: false },
        ship: ship(SHIP_TABLEAU),
      };
    case 'tableau':
      return {
        earth: { ...onAnchor(EARTH_ANCHOR, EARTH_OUT, rE), visible: true, ground: false },
        moon: { ...onAnchor(MOON_ANCHOR, MOON_OUT, rM), visible: true, ground: false },
        ship: ship(SHIP_TABLEAU),
      };
    case 'approach': {
      const u = smoothstep((s.t - 340) / 10);
      const anchor = { x: lerp(MOON_ANCHOR.x, MOON_ANCHOR_APPROACH.x, u), y: lerp(MOON_ANCHOR.y, MOON_ANCHOR_APPROACH.y, u) };
      const rail = { x: lerp(SHIP_TABLEAU.x, SHIP_APPROACH.x, u), y: lerp(SHIP_TABLEAU.y, SHIP_APPROACH.y, u) };
      return {
        earth: { ...onAnchor(EARTH_ANCHOR, EARTH_OUT, rE), visible: true, ground: false },
        moon: { ...onAnchor(anchor, MOON_OUT, rM), visible: true, ground: false },
        ship: ship(rail),
      };
    }
    default: {
      // Descent and monument: the Moon is ground and Earth a marble in the sky. The ship drops
      // 40px over the last 50 m of altitude, and that translation is the cut.
      const drop = s.mode === 'monument' ? CONTACT_DROP_PX : CONTACT_DROP_PX * smoothstep(1 - clamp(s.altitude / 0.05, 0, 1));
      return {
        earth: { cx: sx(SKY_EARTH.cx), cy: sy(SKY_EARTH.cy), r: SKY_EARTH.r, visible: true, ground: false },
        moon: { ...GROUND_MOON, visible: true, ground: true },
        ship: ship(SHIP_DESCENT, 1.4, drop),
      };
    }
  }
}
