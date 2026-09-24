// Small shared helpers for the renderer: maths, colour, deterministic randomness, SVG nodes.

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export function smoothstep(x) {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
}

// Numbers written into SVG attributes: two decimals, no exponent, no negative zero.
export function fmt(x) {
  const r = Math.round(x * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpHex(a, b, u) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = (x, y) => Math.round(lerp(x, y, clamp(u, 0, 1))).toString(16).padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`.toUpperCase();
}

// mulberry32: a seeded generator, so anything "random" is the same on every visit.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Create an SVG element with attributes, optionally appended to a parent. Attribute values are
// set with setAttribute only; nothing is ever parsed as markup.
export function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

export function setAttrs(node, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) node.removeAttribute(k);
    else node.setAttribute(k, String(v));
  }
  return node;
}
