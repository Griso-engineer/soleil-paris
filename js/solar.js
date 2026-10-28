// Position du soleil (algorithme NOAA) et rayonnement par ciel clair (modèle ASHRAE)
// pour Paris. Toutes les heures manipulées par l'interface sont des heures légales
// françaises (UTC+1 en hiver, UTC+2 en été).

export const PARIS = { lat: 48.8566, lon: 2.3522, name: 'Paris' };

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// Dernier dimanche d'un mois donné (mois 0-indexé), à 01:00 UTC.
function lastSundayUTC(year, month) {
  const d = new Date(Date.UTC(year, month + 1, 0, 1, 0, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

// Décalage horaire légal de Paris (en heures) pour un instant UTC donné.
export function parisOffsetHours(utcMs) {
  const year = new Date(utcMs).getUTCFullYear();
  const start = lastSundayUTC(year, 2);
  const end = lastSundayUTC(year, 9);
  return utcMs >= start && utcMs < end ? 2 : 1;
}

// Jour de l'année (1..365) + heure légale décimale → instant UTC (ms).
export function parisLocalToUTC(year, dayOfYear, localHours) {
  const base = Date.UTC(year, 0, dayOfYear, 0, 0, 0) + localHours * 3600e3;
  // On teste d'abord en heure d'hiver, puis on corrige si l'instant tombe en été.
  let utc = base - 3600e3;
  if (parisOffsetHours(utc) === 2) utc = base - 2 * 3600e3;
  return utc;
}

export function isSummerTime(year, dayOfYear) {
  return parisOffsetHours(parisLocalToUTC(year, dayOfYear, 12)) === 2;
}

export function dayOfYearToDate(year, doy) {
  return new Date(Date.UTC(year, 0, doy, 12));
}

export function dateToDayOfYear(date) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const now = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((now - start) / 86400e3);
}

/**
 * Position du soleil. Renvoie la hauteur (°, au-dessus de l'horizon, avec réfraction)
 * et l'azimut (°, depuis le nord, sens horaire : 90 = est, 180 = sud).
 */
export function sunPosition(utcMs, lat = PARIS.lat, lon = PARIS.lon) {
  const jd = utcMs / 86400e3 + 2440587.5;
  const T = (jd - 2451545) / 36525;

  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);

  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));

  const y = Math.tan((eps * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const eqTime =
    4 * DEG *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));

  const d = new Date(utcMs);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const tst = utcMin + eqTime + 4 * lon;
  const ha = (tst / 4 - 180) * RAD;
  const latR = lat * RAD;

  const cosZ = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  let alt = 90 - zenith * DEG;

  // Réfraction atmosphérique (approximation de Bennett), négligeable au-delà de 15°.
  if (alt > -1) alt += 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * RAD) / 60;

  const az =
    (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR)) * DEG +
      180 + 360) % 360;

  return { altitude: alt, azimuth: az, declination: decl * DEG, eqTime };
}

// Coefficients ASHRAE (ciel clair) au 21 de chaque mois : A [W/m²], B [-], C [-].
const ASHRAE = [
  [1230, 0.142, 0.058], [1215, 0.144, 0.060], [1186, 0.156, 0.071],
  [1136, 0.180, 0.097], [1104, 0.196, 0.121], [1088, 0.205, 0.134],
  [1085, 0.207, 0.136], [1107, 0.201, 0.122], [1151, 0.177, 0.092],
  [1192, 0.160, 0.073], [1221, 0.149, 0.063], [1233, 0.142, 0.057],
];
const ASHRAE_DOY = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355];

function ashraeCoefs(doy) {
  // Interpolation linéaire et cyclique entre les valeurs mensuelles.
  let i = ASHRAE_DOY.findIndex((d) => d > doy);
  if (i === -1) i = 12;
  const i0 = (i - 1 + 12) % 12;
  const i1 = i % 12;
  let d0 = ASHRAE_DOY[i0];
  let d1 = ASHRAE_DOY[i1];
  let x = doy;
  if (i === 0) { d0 -= 365; }
  if (i === 12) { d1 += 365; }
  const t = (x - d0) / (d1 - d0);
  return ASHRAE[i0].map((v, k) => v + (ASHRAE[i1][k] - v) * t);
}

/**
 * Rayonnement par ciel clair (W/m²) : direct normal (DNI), diffus horizontal (DHI)
 * et global horizontal (GHI). C'est l'enveloppe haute : une journée sans nuages.
 */
export function clearSky(altitudeDeg, doy) {
  if (altitudeDeg <= 0) return { dni: 0, dhi: 0, ghi: 0 };
  const [A, B, C] = ashraeCoefs(doy);
  const sinA = Math.sin(altitudeDeg * RAD);
  const dni = A * Math.exp(-B / Math.max(sinA, 0.02));
  const dhi = C * dni;
  return { dni, dhi, ghi: dni * sinA + dhi };
}

// Heures (légales) de lever et coucher, par recherche sur la journée.
export function sunTimes(year, doy) {
  let rise = null;
  let set = null;
  let noon = null;
  let maxAlt = -90;
  let prev = null;
  for (let m = 0; m <= 24 * 60; m += 2) {
    const h = m / 60;
    const p = sunPosition(parisLocalToUTC(year, doy, h));
    if (p.altitude > maxAlt) { maxAlt = p.altitude; noon = h; }
    if (prev !== null) {
      if (prev < 0 && p.altitude >= 0) rise = h;
      if (prev >= 0 && p.altitude < 0) set = h;
    }
    prev = p.altitude;
  }
  return { rise, set, noon, maxAlt };
}

export { RAD, DEG };
