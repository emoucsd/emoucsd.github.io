// Selenographic catalogue for the Moon renderer (system spec §6.5).
// Coordinates and diameters are IAU / USGS Gazetteer values to reasonable accuracy.
// LOD minDeg is the §6.5 angular-diameter threshold at which the feature is added;
// the table is cumulative and never swaps assets.

import { seeded, RAD, smoothstep } from './util.js';

export const MOON_D_KM = 3474;
const DEG = 180 / Math.PI;
const KM_PER_DEG = (Math.PI * (MOON_D_KM / 2)) / 180;

export const REQUIRED_CRATER_NAMES = [
  'Tycho', 'Copernicus', 'Kepler', 'Aristarchus', 'Plato', 'Clavius',
  'Ptolemaeus', 'Alphonsus', 'Arzachel', 'Theophilus', 'Cyrillus', 'Catharina',
  'Langrenus', 'Petavius', 'Gassendi', 'Grimaldi', 'Pythagoras', 'Moretus',
  'Newton', 'Cabeus', 'Shackleton', 'de Gerlache', 'Schrödinger', 'Tsiolkovskiy',
];

// Young rayed craters: halos and ray systems, never just another grey disc.
export const YOUNG_NAMES = ['Tycho', 'Copernicus', 'Aristarchus', 'Kepler'];

export const LOD_MIN = {
  marble: 0,
  maria3: 0.45,
  nearMaria: 1.2,
  craters12: 2.5,
  craters40: 6,
  remaining: 14,
  regolith: 28,
  limb: 55,
};

export function lodBand(theta) {
  if (theta < 0.45) return 0;
  if (theta < 1.2) return 1;
  if (theta < 2.5) return 2;
  if (theta < 6) return 3;
  if (theta < 14) return 4;
  if (theta < 28) return 5;
  if (theta <= 55) return 6;
  return 7;
}

// Highest feature minDeg that belongs in this LOD band. Ground mode uses 14
// (the remaining catalogue) plus the limb extras (pocks, PSRs) separately.
export function minDegForBand(band) {
  if (band <= 0) return 0;
  if (band === 1) return LOD_MIN.maria3;
  if (band === 2) return LOD_MIN.nearMaria;
  if (band === 3) return LOD_MIN.craters12;
  if (band === 4) return LOD_MIN.craters40;
  if (band === 5) return LOD_MIN.remaining;
  if (band === 6) return LOD_MIN.regolith;
  return LOD_MIN.limb;
}

// Features fade in across a narrow angular band so a threshold never pops.
export function lodFadeWidth(minDeg) {
  return Math.max(0.2, 0.075 * minDeg);
}

export function lodOpacity(theta, minDeg) {
  if (theta < minDeg) return 0;
  return smoothstep((theta - minDeg) / lodFadeWidth(minDeg));
}

// Pixel-size cut-off by LOD: small discs keep only marks that actually read.
export function lodMinPx(theta) {
  const b = lodBand(theta);
  if (b <= 2) return 1.15;
  if (b === 3) return 0.85;
  if (b === 4) return 0.55;
  if (b === 5) return 0.4;
  return 0.3;
}

export function craterRadiusPx(dKm, R, cosc) {
  return (dKm / MOON_D_KM) * 2 * R * Math.max(0, cosc);
}

export function passesPixelGate(dKm, R, cosc) {
  return craterRadiusPx(dKm, R, cosc) >= 0.3;
}

// Maria: ellipses in longitude/latitude. dxKm/dyKm are full-axis diameters; rot is
// the major-axis position angle in degrees, east of north on the sphere.
export const MARIA = [
  { name: 'Imbrium', lat: 32.8, lon: -15.6, dxKm: 1123, dyKm: 980, rot: -12, minDeg: 0.45, dim: false },
  { name: 'Serenitatis', lat: 28.0, lon: 17.5, dxKm: 707, dyKm: 620, rot: 15, minDeg: 0.45, dim: false },
  { name: 'Procellarum', lat: 18.4, lon: -57.4, dxKm: 2200, dyKm: 1400, rot: -28, minDeg: 0.45, dim: false },
  { name: 'Tranquillitatis', lat: 8.5, lon: 31.4, dxKm: 873, dyKm: 580, rot: 25, minDeg: 1.2, dim: false },
  { name: 'Fecunditatis', lat: -7.8, lon: 51.3, dxKm: 840, dyKm: 600, rot: 8, minDeg: 1.2, dim: false },
  { name: 'Crisium', lat: 17.0, lon: 59.1, dxKm: 555, dyKm: 420, rot: 10, minDeg: 1.2, dim: false },
  { name: 'Nubium', lat: -21.3, lon: -16.6, dxKm: 715, dyKm: 520, rot: 5, minDeg: 1.2, dim: false },
  { name: 'Humorum', lat: -24.4, lon: -38.6, dxKm: 389, dyKm: 350, rot: 0, minDeg: 1.2, dim: false },
  { name: 'Nectaris', lat: -15.2, lon: 35.5, dxKm: 333, dyKm: 300, rot: 12, minDeg: 1.2, dim: false },
  { name: 'Frigoris', lat: 56.0, lon: 1.4, dxKm: 1446, dyKm: 280, rot: 8, minDeg: 1.2, dim: false },
  { name: 'South Pole–Aitken', lat: -53.0, lon: -169.0, dxKm: 1700, dyKm: 1400, rot: 20, minDeg: 1.2, dim: true },
  { name: 'Vaporum', lat: 13.3, lon: 3.6, dxKm: 245, dyKm: 180, rot: 30, minDeg: 1.2, dim: false },
  { name: 'Cognitum', lat: -10.0, lon: -23.1, dxKm: 376, dyKm: 240, rot: -15, minDeg: 1.2, dim: false },
  { name: 'Insularum', lat: 7.5, lon: -30.9, dxKm: 513, dyKm: 380, rot: 20, minDeg: 1.2, dim: false },
  { name: 'Orientale', lat: -19.4, lon: -92.8, dxKm: 327, dyKm: 300, rot: 0, minDeg: 1.2, dim: false },
];

function mareContains(m, lat, lon) {
  const rxDeg = (m.dxKm / 2) / KM_PER_DEG;
  const ryDeg = (m.dyKm / 2) / KM_PER_DEG;
  const dlat = (lat - m.lat) / ryDeg;
  const dlon = ((lon - m.lon) * Math.cos(m.lat * RAD)) / rxDeg;
  const a = -m.rot * RAD;
  const x = dlon * Math.cos(a) - dlat * Math.sin(a);
  const y = dlon * Math.sin(a) + dlat * Math.cos(a);
  return x * x + y * y <= 1;
}

export function inMare(lat, lon) {
  for (const m of MARIA) {
    if (m.dim) continue;
    if (mareContains(m, lat, lon)) return true;
  }
  return false;
}

// name, lat, lon, diameter km, minDeg. 12 at 2.5°, 28 more at 6°, remainder at 14°.
const CRATER_ROWS = [
  ['Tycho', -43.3, -11.22, 85.29, 2.5],
  ['Copernicus', 9.62, -20.08, 93.0, 2.5],
  ['Plato', 51.62, -9.38, 100.68, 2.5],
  ['Clavius', -58.42, -14.4, 225.0, 2.5],
  ['Ptolemaeus', -9.16, -1.84, 153.5, 2.5],
  ['Alphonsus', -13.39, -2.85, 110.54, 2.5],
  ['Theophilus', -11.45, 26.28, 98.59, 2.5],
  ['Langrenus', -8.86, 61.04, 132.0, 2.5],
  ['Petavius', -25.39, 60.78, 184.0, 2.5],
  ['Gassendi', -17.55, -40.11, 111.39, 2.5],
  ['Grimaldi', -5.38, -68.32, 172.47, 2.5],
  ['Pythagoras', 63.66, -62.98, 144.55, 2.5],

  ['Arzachel', -18.26, -1.93, 96.99, 6],
  ['Cyrillus', -13.29, 24.07, 98.09, 6],
  ['Catharina', -17.98, 23.55, 98.77, 6],
  ['Moretus', -70.63, -5.95, 114.93, 6],
  ['Newton', -76.7, -16.89, 78.92, 6],
  ['Cabeus', -84.9, -35.5, 100.58, 6],
  ['Schrödinger', -74.73, 132.93, 325.81, 6],
  ['Tsiolkovskiy', -20.38, 128.97, 184.39, 6],
  ['Archimedes', 29.72, -3.99, 81.04, 6],
  ['Aristoteles', 50.24, 17.32, 87.57, 6],
  ['Atlas', 46.74, 44.38, 88.12, 6],
  ['Bullialdus', -20.75, -22.18, 60.34, 6],
  ['Eratosthenes', 14.47, -11.32, 58.77, 6],
  ['Eudoxus', 44.27, 16.23, 70.24, 6],
  ['Fra Mauro', -6.06, -16.97, 96.76, 6],
  ['Hipparchus', -5.36, 4.91, 143.98, 6],
  ['Janssen', -44.96, 41.51, 199.51, 6],
  ['Longomontanus', -49.55, -21.75, 157.37, 6],
  ['Maginus', -50.2, -6.28, 194.23, 6],
  ['Maurolycus', -41.77, 13.92, 114.48, 6],
  ['Posidonius', 31.88, 17.31, 95.1, 6],
  ['Riccioli', -2.9, -74.3, 155.66, 6],
  ['Schickard', -44.32, -55.11, 212.18, 6],
  ['Vendelinus', -16.46, 61.55, 141.21, 6],
  ['Albategnius', -11.24, 4.01, 130.84, 6],
  ['Endymion', 53.61, 56.48, 122.1, 6],
  ['Bailly', -66.5, -69.1, 300.56, 6],
  ['Aristarchus', 23.73, -47.49, 40.14, 6],

  ['Kepler', 8.12, -38.01, 31.21, 14],
  ['Shackleton', -89.67, 129.78, 20.92, 14],
  ['de Gerlache', -88.48, -87.1, 32.71, 14],
  ['Haworth', -86.9, -4.0, 51.4, 14],
  ['Shoemaker', -88.14, 44.91, 51.82, 14],
  ['Faustini', -87.18, 84.31, 42.48, 14],
  ['Sverdrup', -88.5, -153.0, 35.0, 14],
  ['Malapert', -84.9, 12.9, 69.0, 14],
  ['Drygalski', -79.57, -87.18, 162.48, 14],
  ['Amundsen', -84.44, 83.07, 103.39, 14],
  ['Nobile', -85.28, 53.49, 73.0, 14],
  ['Scott', -82.1, 48.5, 107.83, 14],
  ['Triesnecker', 4.18, 3.6, 24.97, 14],
  ['Manilius', 14.45, 9.07, 38.34, 14],
  ['Menelaus', 16.26, 15.93, 27.13, 14],
  ['Bessel', 21.73, 17.92, 15.75, 14],
  ['Plinius', 15.36, 23.61, 41.31, 14],
  ['Maskelyne', 2.16, 30.04, 22.41, 14],
  ['Dionysius', 2.77, 17.32, 17.25, 14],
  ['Delambre', -1.94, 17.5, 51.49, 14],
  ['Taruntius', 5.5, 46.54, 57.32, 14],
  ['Proclus', 16.09, 46.92, 26.91, 14],
  ['Picard', 14.57, 54.72, 22.35, 14],
  ['Macrobius', 21.26, 45.97, 62.81, 14],
  ['Cleomedes', 27.7, 56.0, 125.77, 14],
  ['Condorcet', 12.1, 69.58, 74.85, 14],
  ['Neper', 8.76, 84.6, 144.32, 14],
  ['Furnerius', -36.0, 60.4, 125.18, 14],
  ['Stevinus', -32.49, 54.14, 71.54, 14],
  ['Snellius', -29.32, 55.7, 82.9, 14],
  ['Gutenberg', -8.61, 41.25, 74.31, 14],
  ['Goclenius', -10.05, 45.03, 73.04, 14],
  ['Capella', -7.52, 34.92, 49.0, 14],
  ['Kant', -10.62, 20.2, 33.05, 14],
  ['Abulfeda', -13.87, 13.91, 62.0, 14],
  ['Sacrobosco', -23.75, 16.66, 97.67, 14],
  ['Alpetragius', -16.05, -4.51, 40.02, 14],
  ['Herschel', -5.69, -2.09, 39.09, 14],
  ['Guericke', -11.57, -14.19, 63.27, 14],
  ['Bonpland', -8.38, -17.33, 59.25, 14],
  ['Parry', -7.88, -15.78, 47.28, 14],
  ['Lalande', -4.46, -8.65, 23.54, 14],
  ['Mösting', -0.7, -5.88, 24.38, 14],
  ['Flamsteed', -4.53, -44.32, 19.34, 14],
  ['Letronne', -10.8, -42.49, 116.21, 14],
  ['Billy', -13.83, -50.24, 45.57, 14],
  ['Hansteen', -11.53, -52.06, 44.99, 14],
  ['Hevelius', 2.2, -67.46, 113.88, 14],
  ['Reiner', 6.92, -54.98, 29.86, 14],
  ['Marius', 11.9, -50.84, 41.31, 14],
  ['Seleucus', 21.09, -66.66, 45.01, 14],
  ['Cardanus', 13.27, -72.5, 49.55, 14],
  ['Wargentin', -49.6, -60.44, 84.25, 14],
  ['Schiller', -51.79, -39.77, 179.36, 14],
  ['Wilhelm', -43.24, -20.81, 106.33, 14],
  ['Pitatus', -29.88, -13.53, 100.6, 14],
  ['Campanus', -28.04, -27.79, 46.41, 14],
  ['Mercator', -29.25, -26.11, 46.62, 14],
  ['Kies', -26.31, -22.63, 45.54, 14],
  ['Hippalus', -24.92, -30.42, 57.36, 14],
  ['Doppelmayer', -28.48, -41.45, 63.41, 14],
  ['Mersenius', -21.49, -49.2, 84.22, 14],
  ['Walter', -33.25, 0.7, 132.79, 14],
  ['Werner', -28.03, 3.29, 70.31, 14],
  ['Aliacensis', -30.6, 5.2, 79.65, 14],
  ['Stöfler', -41.23, 6.0, 126.38, 14],
  ['Faraday', -42.45, 8.75, 69.88, 14],
  ['Piccolomini', -29.7, 32.22, 87.55, 14],
  ['Rabbi Levi', -34.78, 23.62, 81.05, 14],
  ['Zagut', -31.94, 22.08, 84.31, 14],
  ['Hommel', -54.74, 33.16, 126.02, 14],
  ['Pitiscus', -50.61, 30.57, 82.08, 14],
  ['Lilius', -54.55, 6.16, 61.18, 14],
  ['Curtius', -68.6, 4.4, 95.61, 14],
  ['Casatus', -72.57, -29.45, 108.24, 14],
  ['Blancanus', -63.57, -21.51, 117.37, 14],
  ['Scheiner', -60.36, -27.82, 110.44, 14],
  ['Hausen', -65.11, -88.49, 167.41, 14],
  ['Aitken', -16.8, 173.4, 135.0, 14],
  ['Gagarin', -20.2, 149.2, 265.0, 14],
  ['Antoniadi', -69.7, 172.0, 143.0, 14],
  ['Zeeman', -75.2, -134.8, 190.0, 14],
  ['Reinhold', 3.3, -22.8, 42.48, 14],
  ['Lansberg', 0.31, -26.63, 38.75, 14],
  ['Hercules', 46.82, 39.13, 68.95, 14],
  ['Anaxagoras', 73.48, -10.17, 51.99, 14],
  ['Goldschmidt', 73.04, 15.1, 113.41, 14],
  ['W. Bond', 65.41, 4.47, 169.69, 14],
  ['Meton', 73.81, 18.96, 130.47, 14],
  ['Scoresby', 77.73, 14.13, 54.93, 14],
  ['Gioja', 83.35, 1.72, 41.18, 14],
  ['Byrd', 85.43, 9.93, 93.45, 14],
  ['Peary', 88.63, 33.18, 78.75, 14],
  ['Hermite', 86.17, -89.92, 104.0, 14],
  ['Rozhdestvenskiy', 85.28, -155.42, 177.0, 14],
  ['Planck', -57.9, 136.8, 314.0, 14],
  ['Poincaré', -56.7, 163.6, 319.0, 14],
  ['Korolev', -4.0, -157.4, 437.0, 14],
  ['Hertzsprung', 1.4, -128.7, 536.0, 14],
  ['Mendeleev', 5.7, 140.9, 313.0, 14],
  ['Jules Verne', -35.0, 147.0, 143.0, 14],
  ['Van de Graaff', -27.0, 172.0, 233.0, 14],
  ['Keeler', -10.2, 161.9, 160.0, 14],
  ['Pasteur', -11.9, 104.6, 224.0, 14],
  ['Humboldt', -27.02, 80.96, 199.46, 14],
  ['Phillips', -26.6, 76.0, 104.0, 14],
  ['Hainzel', -41.3, -33.5, 70.0, 14],
  ['Inghirami', -47.5, -70.2, 91.0, 14],
  ['Lagrange', -32.3, -72.8, 162.2, 14],
  ['Darwin', -19.8, -69.1, 120.0, 14],
  ['Byrgius', -24.7, -65.3, 87.0, 14],
  ['Cavalerius', 5.1, -66.8, 57.9, 14],
  ['Olbers', 7.4, -75.9, 74.9, 14],
  ['Krafft', 16.6, -72.6, 51.2, 14],
  ['Helicon', 40.4, -23.1, 23.0, 14],
  ['Le Verrier', 40.3, -20.6, 20.0, 14],
  ['Pytheas', 20.5, -20.6, 20.0, 14],
  ['Lambert', 25.8, -21.0, 30.0, 14],
  ['Euler', 23.3, -29.2, 27.5, 14],
  ['Diophantus', 27.6, -34.3, 17.6, 14],
  ['Delisle', 29.9, -34.6, 25.0, 14],
  ['Harpalus', 52.6, -43.4, 39.0, 14],
  ['Philolaus', 72.1, -32.4, 70.0, 14],
  ['Anaximenes', 72.5, -44.5, 80.0, 14],
  ['Carpenter', 69.4, -50.9, 59.0, 14],
  ['J. Herschel', 62.0, -41.8, 154.0, 14],
  ['South', 57.6, -50.8, 104.0, 14],
  ['Babbage', 59.7, -57.1, 143.0, 14],
  ['Robinson', 59.0, -45.9, 24.0, 14],
  ['Horrebow', 58.7, -40.8, 24.0, 14],
];

const YOUNG_SET = new Set(YOUNG_NAMES);

export const CRATERS = CRATER_ROWS.map(([name, lat, lon, d, minDeg]) => ({
  name,
  lat,
  lon,
  d,
  minDeg,
  young: YOUNG_SET.has(name),
}));

export const PSRS = [
  { name: 'Cabeus', lat: -84.9, lon: -35.5, d: 55 },
  { name: 'Shackleton', lat: -89.67, lon: 129.78, d: 16 },
  { name: 'de Gerlache', lat: -88.48, lon: -87.1, d: 22 },
  { name: 'Haworth', lat: -86.9, lon: -4.0, d: 32 },
  { name: 'Shoemaker', lat: -88.14, lon: 44.91, d: 34 },
];

function destPoint(lat, lon, azDeg, distKm) {
  const d = distKm / (MOON_D_KM / 2);
  const az = azDeg * RAD;
  const la1 = lat * RAD;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(az));
  const lo2 = lon * RAD + Math.atan2(
    Math.sin(az) * Math.sin(d) * Math.cos(la1),
    Math.cos(d) - Math.sin(la1) * Math.sin(la2),
  );
  return { lat: la2 * DEG, lon: ((lo2 * DEG + 540) % 360) - 180 };
}

// Straight ray strokes, 8–18 parent radii. Segments whose midpoint falls in a
// mare are dropped here so the renderer never has to test albedo per frame.
export const RAYS = [
  { parent: 'Tycho', az: 22, lenRadii: 18, width: 1.8, minDeg: 2.5 },
  { parent: 'Tycho', az: 78, lenRadii: 14, width: 1.2, minDeg: 2.5 },
  { parent: 'Tycho', az: 168, lenRadii: 15, width: 1.3, minDeg: 2.5 },
  { parent: 'Tycho', az: 228, lenRadii: 17, width: 1.6, minDeg: 2.5 },
  { parent: 'Tycho', az: 304, lenRadii: 16, width: 1.4, minDeg: 2.5 },
  { parent: 'Copernicus', az: 25, lenRadii: 13, width: 1.2, minDeg: 6 },
  { parent: 'Copernicus', az: 95, lenRadii: 10, width: 1.0, minDeg: 6 },
  { parent: 'Copernicus', az: 175, lenRadii: 12, width: 1.1, minDeg: 6 },
  { parent: 'Copernicus', az: 250, lenRadii: 9, width: 0.9, minDeg: 6 },
  { parent: 'Copernicus', az: 318, lenRadii: 12, width: 1.1, minDeg: 6 },
  { parent: 'Kepler', az: 40, lenRadii: 10, width: 0.9, minDeg: 14 },
  { parent: 'Kepler', az: 200, lenRadii: 9, width: 0.8, minDeg: 14 },
  { parent: 'Aristarchus', az: 20, lenRadii: 9, width: 0.9, minDeg: 14 },
  { parent: 'Aristarchus', az: 210, lenRadii: 10, width: 0.9, minDeg: 14 },
];

function buildRaySegments() {
  const byName = new Map(CRATERS.map((c) => [c.name, c]));
  const segs = [];
  for (const ray of RAYS) {
    const crater = byName.get(ray.parent);
    if (!crater) continue;
    const rKm = crater.d / 2;
    const startKm = rKm * 1.2;
    const lenKm = ray.lenRadii * rKm;
    const n = 2;
    for (let i = 0; i < n; i++) {
      const t0 = startKm + (lenKm - startKm) * (i / n);
      const t1 = startKm + (lenKm - startKm) * ((i + 1) / n);
      const a0 = destPoint(crater.lat, crater.lon, ray.az, t0);
      const a1 = destPoint(crater.lat, crater.lon, ray.az, t1);
      const mid = destPoint(crater.lat, crater.lon, ray.az, (t0 + t1) / 2);
      if (inMare(mid.lat, mid.lon)) continue;
      segs.push({
        parent: ray.parent,
        lat0: a0.lat,
        lon0: a0.lon,
        lat1: a1.lat,
        lon1: a1.lon,
        width: ray.width,
        minDeg: ray.minDeg,
      });
    }
  }
  return segs;
}

export const RAY_SEGMENTS = buildRaySegments();

export const RILLES = [
  {
    name: 'Rima Hyginus',
    minDeg: 14,
    points: [
      { lat: 8.6, lon: 4.0 },
      { lat: 7.8, lon: 6.3 },
      { lat: 7.4, lon: 8.0 },
      { lat: 7.1, lon: 9.8 },
    ],
  },
  {
    name: 'Rima Ariadaeus',
    minDeg: 14,
    points: [
      { lat: 6.5, lon: 8.0 },
      { lat: 6.4, lon: 12.0 },
      { lat: 6.5, lon: 16.0 },
      { lat: 6.2, lon: 17.8 },
    ],
  },
  {
    name: 'Rima Hadley',
    minDeg: 14,
    points: [
      { lat: 25.0, lon: 2.0 },
      { lat: 25.7, lon: 2.6 },
      { lat: 26.1, lon: 3.0 },
      { lat: 26.5, lon: 3.6 },
      { lat: 25.8, lon: 4.2 },
    ],
  },
  {
    name: 'Vallis Schröteri',
    minDeg: 14,
    points: [
      { lat: 26.2, lon: -50.8 },
      { lat: 26.0, lon: -51.6 },
      { lat: 25.4, lon: -52.6 },
      { lat: 24.6, lon: -53.4 },
      { lat: 23.8, lon: -54.2 },
    ],
  },
];

export function pockmarkSeed(lat, lon) {
  const i = Math.floor(lat * 20);
  const j = Math.floor(lon * 20);
  return ((i * 73856093) ^ (j * 19349663)) >>> 0;
}

export function makePockmarks() {
  const list = [];
  for (let i = 0; i < 8; i++) {
    const lat0 = -84 + i * 21;
    for (let j = 0; j < 10; j++) {
      const lon0 = -162 + j * 36;
      const rng = seeded(pockmarkSeed(lat0, lon0));
      const lat = lat0 + (rng() - 0.5) * 10;
      const lon = lon0 + (rng() - 0.5) * 16;
      list.push({
        lat,
        lon: ((lon + 540) % 360) - 180,
        d: 2.2 + rng() * 7.5,
        cell: [Math.floor(lat0 * 20), Math.floor(lon0 * 20)],
      });
    }
  }
  list.sort((a, b) => a.cell[0] - b.cell[0] || a.cell[1] - b.cell[1]);
  return list.slice(0, 80);
}

export const POCKMARKS = makePockmarks();

export const MOON_CATALOG = {
  maria: MARIA,
  craters: CRATERS,
  rays: RAYS,
  raySegments: RAY_SEGMENTS,
  psrs: PSRS,
  rilles: RILLES,
  pockmarks: POCKMARKS,
};

export function catalogFeatureCount() {
  return MARIA.length + CRATERS.length + PSRS.length + RILLES.length + RAYS.length;
}

export function cratersVisibleAt(theta) {
  return CRATERS.filter((c) => theta >= c.minDeg);
}

export function mariaVisibleAt(theta) {
  return MARIA.filter((m) => theta >= m.minDeg);
}

export function isCameraPolar(camera) {
  return Math.abs(camera.lat0) >= 60;
}

// g#moon descendant count for a band. Hidden nodes still count, so we only
// create the layers that belong to the current band (and drop them on scrub-back).
export function moonNodeBudget(band = 7, ground = false) {
  const b = ground ? 7 : Number(band);
  const cap = ground ? LOD_MIN.remaining : minDegForBand(b);
  let n = 7; // root, clip group, highland, earthshine, lit, terminator, gain veil
  if (ground) n += 1;
  const maria = MARIA.filter((m) => m.minDeg <= cap).length;
  if (maria) n += 1 + maria;
  const craters = CRATERS.filter((c) => c.minDeg <= cap).length;
  if (craters) n += 1 + craters * 3;
  if (!ground && b === 2) n += 1;
  if (!ground && b >= 5) n += 1 + YOUNG_NAMES.length;
  if (ground || b >= 7) n += 1 + POCKMARKS.length * 3;
  if (!ground && b >= 5) n += 1 + RILLES.length;
  const rays = ground ? 0 : RAY_SEGMENTS.filter((s) => s.minDeg <= cap).length;
  if (rays) n += 1 + rays;
  if (ground || b >= 6) n += 1 + PSRS.length + 1;
  return n;
}
