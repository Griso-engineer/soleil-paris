// Masque urbain en coupe 2D : une rue rectiligne et infinie, bordée de deux immeubles
// parallèles. On regarde une fenêtre de la façade « de ce côté-ci » ; l'immeuble d'en face
// masque le soleil et une partie du ciel.
//
// Repère de la coupe (perpendiculaire à la façade) : x vers la rue, y vers le haut.
// Le soleil est vu dans ce plan sous son angle de profil φ : tan φ = tan h / cos γ,
// avec h sa hauteur et γ l'écart d'azimut avec la normale de la façade.
// L'ombre de l'immeuble d'en face (hauteur H, rue de largeur L) monte sur notre façade
// jusqu'à la hauteur  y = H − L·tan φ.

import { sunPosition, parisLocalToUTC, clearSky } from './solar.js';
import { sunVectorLocal } from './shading.js';

export const FLOOR = 3.0; // hauteur d'étage courante (m)
const GROUND_ALBEDO = 0.2;

export function defaultStreet() {
  return {
    facadeAz: 180, // la fenêtre regarde le sud, de l'autre côté de la rue
    width: 12, // largeur de rue, de façade à façade (m)
    hOpp: 18, // hauteur de l'immeuble d'en face (m)
    hOwn: 18, // hauteur de notre immeuble (m), pour le dessin et le tableau des étages
    floor: 1, // étage observé : 0 = rez-de-chaussée
  };
}

/** Fenêtre de l'étage n : porte-fenêtre de 2,20 m posée 10 cm au-dessus du plancher. */
export function windowOf(floor) {
  const zb = floor * FLOOR + 0.1;
  return { zb, zt: zb + 2.2, zc: zb + 1.1 };
}

/** Angle d'obstruction (°) vu depuis une hauteur z : le haut de l'immeuble d'en face. */
export function obstructionAngle(cfg, z) {
  return (Math.atan2(cfg.hOpp - z, cfg.width) * 180) / Math.PI;
}

/** Part du ciel visible par une fenêtre verticale, rapportée à une façade dégagée. */
export function skyView(cfg, z) {
  const a = Math.max(0, (obstructionAngle(cfg, z) * Math.PI) / 180);
  return 1 - Math.sin(a);
}

/**
 * Géométrie du soleil dans la coupe pour un vecteur soleil s (repère façade).
 * Renvoie null si le soleil est derrière la façade ou sous l'horizon.
 */
export function profile(s) {
  if (s.z <= 1e-3 || s.y <= 0) return null;
  return { tan: s.y / s.z, deg: (Math.atan2(s.y, s.z) * 180) / Math.PI };
}

/** Hauteur de l'ombre portée sur notre façade (m depuis le sol), pour un angle de profil. */
export function shadowHeight(cfg, prof) {
  return cfg.hOpp - cfg.width * prof.tan;
}

/** Part de la fenêtre au soleil (0 → 1) pour la direction s. */
export function sunlitFraction(cfg, s, floor = cfg.floor) {
  const prof = profile(s);
  if (!prof) return 0;
  const { zb, zt } = windowOf(floor);
  const hs = shadowHeight(cfg, prof);
  return Math.max(0, Math.min(1, (zt - Math.max(zb, hs)) / (zt - zb)));
}

/** Bilan instantané (W/m² de fenêtre) avec et sans l'immeuble d'en face. */
export function evaluateStreet(cfg, sun, doy, floor = cfg.floor) {
  const sky = clearSky(sun.altitude, doy);
  const s = sunVectorLocal(sun.altitude, sun.azimuth, cfg.facadeAz);
  const cosT = Math.max(0, s.z);
  const dir0 = sun.altitude > 0 ? sky.dni * cosT : 0;
  const lit = sunlitFraction(cfg, s, floor);
  const { zc } = windowOf(floor);
  const sv = skyView(cfg, zc);
  const reflected = (GROUND_ALBEDO * sky.ghi) / 2; // gardé identique : simplification
  return {
    s, lit, prof: profile(s),
    without: dir0 + sky.dhi / 2 + reflected,
    withMask: dir0 * lit + (sky.dhi / 2) * sv + reflected,
    direct0: dir0, direct: dir0 * lit,
  };
}

/**
 * Plage horaire (heures légales) pendant laquelle le soleil est levé et devant la façade
 * d'azimut facadeAz. Renvoie null si le soleil ne passe jamais devant ce jour-là.
 * Une façade nord, en été, peut avoir deux plages (matin et soir) : on renvoie la liste.
 */
export function facingRanges(facadeAz, year, doy, stepMin = 5) {
  const ranges = [];
  let start = null;
  for (let m = 0; m <= 1440; m += stepMin) {
    const sun = sunPosition(parisLocalToUTC(year, doy, m / 60));
    const s = sunVectorLocal(sun.altitude, sun.azimuth, facadeAz);
    const facing = sun.altitude > 0 && s.z > 0;
    if (facing && start === null) start = m / 60;
    if (!facing && start !== null) {
      ranges.push([start, m / 60]);
      start = null;
    }
  }
  if (start !== null) ranges.push([start, 24]);
  return ranges;
}

/**
 * Journée : énergie (Wh/m²) et heures de soleil direct sur la fenêtre, avec et sans masque.
 * L'énergie est cumulée sur la plage où le soleil fait face à la façade (e0, e1).
 */
export function streetDay(cfg, year, doy, floor = cfg.floor, stepMin = 10) {
  let e0 = 0;
  let e1 = 0;
  let h0 = 0;
  let h1 = 0;
  const profileOut = [];
  for (let m = 0; m <= 1440; m += stepMin) {
    const sun = sunPosition(parisLocalToUTC(year, doy, m / 60));
    const r = evaluateStreet(cfg, sun, doy, floor);
    const dt = stepMin / 60;
    if (m < 1440 && r.direct0 > 1) {
      e0 += r.without * dt;
      e1 += r.withMask * dt;
      h0 += dt;
      if (r.lit >= 0.5) h1 += dt;
    }
    profileOut.push({ h: m / 60, gain: r.withMask, gain0: r.without, lit: r.lit });
  }
  return { e0, e1, h0, h1, profile: profileOut };
}

/**
 * Masque urbain sur la voûte céleste, au format de maskGrid (centres de cases) :
 * part de la fenêtre au soleil pour chaque direction du ciel.
 */
export function streetMaskGrid(cfg, step = 5) {
  const values = [];
  for (let i = 0; i < 90 / step; i++) {
    const alt = i * step + step / 2;
    const row = [];
    for (let j = 0; j < 360 / step; j++) {
      row.push(sunlitFraction(cfg, sunVectorLocal(alt, j * step + step / 2, cfg.facadeAz)));
    }
    values.push(row);
  }
  return { step, centers: true, values };
}
