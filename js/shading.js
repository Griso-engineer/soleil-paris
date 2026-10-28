// Modèle géométrique et énergétique d'une fenêtre avec protection solaire extérieure.
//
// Repère local de la façade (le même que la scène 3D) :
//   x : le long de la façade, vers la droite pour un observateur dehors face à la façade
//   y : vertical, vers le haut
//   z : normale sortante de la façade (vers l'extérieur)
// Le vitrage occupe x ∈ [-W/2, W/2], y ∈ [0, H] dans le plan z = 0 ;
// le nu extérieur de la façade est en z = e (profondeur de tableau).
//
// Pour chaque point du vitrage, on lance un rayon vers une direction (soleil ou ciel)
// et on traverse les obstacles : tableau, store banne, vantaux, protection verticale.
// Les gains suivent la méthode simplifiée de la NF EN ISO 52022-1 pour une protection
// extérieure : g_tot = τ·g + α·G/G2 + τ·(1−g)·G/G1.

import { RAD, clearSky, sunPosition, parisLocalToUTC } from './solar.js';

export const GLAZINGS = {
  simple: { label: 'Simple vitrage', g: 0.85, tv: 0.90, ug: 5.8 },
  double: { label: 'Double vitrage', g: 0.63, tv: 0.80, ug: 2.8 },
  doubleFE: { label: 'Double vitrage faiblement émissif', g: 0.55, tv: 0.78, ug: 1.1 },
  controle: { label: 'Double vitrage à contrôle solaire', g: 0.35, tv: 0.65, ug: 1.1 },
  triple: { label: 'Triple vitrage', g: 0.47, tv: 0.70, ug: 0.7 },
};

export const COLORS = {
  clair: { label: 'Claire', rho: 0.65, hex: '#e9e4d8' },
  moyen: { label: 'Moyenne', rho: 0.40, hex: '#9a958a' },
  fonce: { label: 'Foncée', rho: 0.12, hex: '#3b3a37' },
};

export const PROTECTIONS = {
  none: {
    label: 'Aucune',
    short: 'Fenêtre nue',
    view: 'Totale',
    text: "Référence : la fenêtre n'est protégée que par la profondeur de son tableau.",
  },
  battants: {
    label: 'Volets battants',
    short: 'Deux vantaux pivotant sur gonds',
    view: 'Nulle fermés, totale ouverts',
    text: "Fermés, ils bloquent presque tout. Ouverts à 90°, les vantaux jouent le rôle d'ailettes verticales et coupent le soleil rasant d'est ou d'ouest. Persiennés, ils laissent passer air et lumière diffuse.",
  },
  accordeon: {
    label: 'Volets accordéon',
    short: 'Panneaux pliants repliés en tableau',
    view: 'Réduite',
    text: "Volets repliables (souvent métalliques et persiennés) qui se replient dans le tableau. On les ferme partiellement en tirant les panneaux depuis les côtés.",
  },
  roulant: {
    label: 'Volet roulant',
    short: 'Tablier de lames descendant du haut',
    view: 'Nulle sur la partie fermée',
    text: "Très efficace sur la partie fermée, mais il faut choisir entre soleil et obscurité. Des lames ajourées laissent filtrer un peu de lumière une fois le tablier en bas.",
  },
  bso: {
    label: 'Brise-soleil orientable',
    short: 'Lames orientables (BSO, store vénitien extérieur)',
    view: 'Partielle, réglable',
    text: "Les lames s'orientent pour bloquer le rayonnement direct tout en renvoyant la lumière du jour. C'est la protection mobile la plus fine à régler.",
  },
  screen: {
    label: 'Store toile (screen)',
    short: 'Toile micro-perforée verticale',
    view: 'Conservée, voilée',
    text: "La toile filtre le rayonnement en gardant une vue vers l'extérieur. Le coefficient d'ouverture fixe le compromis entre protection et transparence.",
  },
  banne: {
    label: 'Store banne',
    short: 'Toile inclinée en surplomb',
    view: 'Totale',
    text: "Projetée au-dessus de la fenêtre, la toile arrête le soleil haut du sud mais devient inefficace face au soleil bas du matin et du soir.",
  },
};

const G1 = 5; // W/(m²·K)
const G2 = 10; // W/(m²·K)
const GROUND_ALBEDO = 0.2;

// Dimensions des lames (m)
const BSO_SLAT = { w: 0.08, s: 0.072 };
const PERSIENNE = { w: 0.05, s: 0.04, beta: 45 };

export function defaultConfig() {
  return {
    facadeAz: 180, // azimut de la normale sortante (180 = sud)
    W: 1.4,
    H: 1.6,
    e: 0.2,
    glazing: 'doubleFE',
    type: 'bso',
    deploy: 1, // fraction déployée (0 → 1)
    slatAngle: 40, // BSO, ° (0 = horizontales, 90 = fermées)
    openAngle: 0, // battants, ° (0 = fermés, 180 = rabattus contre le mur)
    louvered: true, // battants / accordéon : persiennés ou pleins
    color: 'clair',
    openness: 5, // screen, % d'ouverture
    ajoure: false, // volet roulant à lames ajourées
    bannePro: 1.2, // projection du store banne (m)
    banneAngle: 25, // inclinaison sous l'horizontale (°)
  };
}

// ---------- Vecteurs ----------

/** Direction du soleil dans le repère de la façade. */
export function sunVectorLocal(altDeg, azDeg, facadeAz) {
  const a = altDeg * RAD;
  const g = (azDeg - facadeAz) * RAD;
  return { x: -Math.cos(a) * Math.sin(g), y: Math.sin(a), z: Math.cos(a) * Math.cos(g) };
}

// Facteur d'angle d'incidence du vitrage (Martin & Ruiz, a_r = 0.16).
const IAM_NORM = 1 - Math.exp(-1 / 0.16);
function iam(cosTheta) {
  if (cosTheta <= 0) return 0;
  return (1 - Math.exp(-cosTheta / 0.16)) / IAM_NORM;
}

// ---------- Matériaux ----------

/**
 * Transmission d'un rideau de lames horizontales (dans un plan vertical de normale n),
 * pour un rayon de direction d (vers la source). beta : inclinaison des lames,
 * bord extérieur vers le bas. Renvoie { tau, rho }.
 */
function louver(d, n, slat, betaDeg, rhoC) {
  const dn = Math.abs(d.x * n.x + d.z * n.z);
  const phi = Math.atan2(d.y, dn); // angle de profil
  const beta = betaDeg * RAD;
  const cphi = Math.cos(phi);
  const f = cphi < 1e-4 ? 0 : Math.max(0, Math.min(1, 1 - (slat.w * Math.abs(Math.sin(phi + beta))) / (slat.s * cphi)));
  const og = Math.max(0, 1 - (slat.w * Math.abs(Math.sin(beta))) / slat.s);
  // Une part du flux intercepté est réfléchie entre les lames vers l'intérieur.
  const tau = f + (1 - f) * rhoC * (0.08 + 0.3 * og);
  const rho = (1 - f) * rhoC * 0.55;
  return { tau, rho };
}

function opaque(rhoC) {
  return { tau: 0, rho: rhoC };
}

function fabric(openness, rhoC) {
  const tau = openness + (1 - openness) * 0.12 * rhoC;
  return { tau, rho: (1 - openness) * rhoC * 0.85 };
}

// ---------- Construction de la géométrie ----------

/**
 * Prépare la géométrie de calcul pour une configuration :
 *  - plane : protection dans le tableau (près du vitrage), avec zone couverte
 *  - quads : obstacles éloignés ou mobiles (vantaux, store banne)
 */
export function buildGeometry(cfg) {
  const { W, H, e } = cfg;
  const rhoC = COLORS[cfg.color].rho;
  const geo = { W, H, e, plane: null, quads: [] };
  const zp = Math.max(0.02, e - 0.05);
  const d = Math.max(0, Math.min(1, cfg.deploy));

  switch (cfg.type) {
    case 'roulant': {
      const full = d >= 0.999;
      geo.plane = {
        z: zp,
        covers: (x, y) => y > H * (1 - d),
        mat: () => (cfg.ajoure && full ? { tau: 0.05, rho: rhoC * 0.95 } : opaque(rhoC)),
      };
      break;
    }
    case 'screen': {
      const m = fabric(cfg.openness / 100, rhoC);
      geo.plane = { z: zp, covers: (x, y) => y > H * (1 - d), mat: () => m };
      break;
    }
    case 'bso': {
      const n = { x: 0, y: 0, z: 1 };
      geo.plane = {
        z: zp,
        covers: (x, y) => y > H * (1 - d),
        mat: (dir) => louver(dir, n, BSO_SLAT, cfg.slatAngle, rhoC),
      };
      break;
    }
    case 'accordeon': {
      const n = { x: 0, y: 0, z: 1 };
      const half = (W / 2) * (1 - d);
      geo.plane = {
        z: zp,
        covers: (x) => Math.abs(x) > half,
        mat: (dir) => (cfg.louvered ? louver(dir, n, PERSIENNE, PERSIENNE.beta, rhoC) : opaque(rhoC)),
      };
      break;
    }
    case 'battants': {
      const a = cfg.openAngle * RAD;
      const L = W / 2;
      // Proche de la fenêtre (vantaux peu ouverts), la chaleur absorbée profite au local.
      const near = Math.max(0, 1 - cfg.openAngle / 45);
      for (const side of [-1, 1]) {
        // side = -1 : vantail gauche (gond en x = -W/2), +1 : droit (gond en x = +W/2)
        const hinge = { x: (side * W) / 2, y: 0, z: e };
        const u = { x: -side * Math.cos(a) * L, y: 0, z: Math.sin(a) * L };
        const v = { x: 0, y: H, z: 0 };
        const n = normalize(cross(u, v));
        geo.quads.push({
          o: hinge, u, v, n, near,
          mat: (dir) => (cfg.louvered ? louver(dir, n, PERSIENNE, PERSIENNE.beta, rhoC) : opaque(rhoC)),
        });
      }
      break;
    }
    case 'banne': {
      const a = cfg.banneAngle * RAD;
      const P = cfg.bannePro;
      const margin = 0.3;
      const tauFab = { clair: 0.14, moyen: 0.07, fonce: 0.03 }[cfg.color];
      const m = { tau: tauFab, rho: rhoC * 0.85 };
      const u = { x: W + 2 * margin, y: 0, z: 0 };
      const v = { x: 0, y: -Math.sin(a) * P * d, z: Math.cos(a) * P * d };
      geo.quads.push({
        o: { x: -W / 2 - margin, y: H + 0.25, z: e },
        u, v, n: normalize(cross(u, v)), near: 0,
        mat: () => m,
      });
      break;
    }
    default:
      break;
  }
  return geo;
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

// Intersection rayon (p + t·d, t > 0) / parallélogramme (o, u, v).
function hitQuad(p, d, q) {
  const n = q.n;
  const den = d.x * n.x + d.y * n.y + d.z * n.z;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((q.o.x - p.x) * n.x + (q.o.y - p.y) * n.y + (q.o.z - p.z) * n.z) / den;
  if (t <= 1e-6) return false;
  const rx = p.x + d.x * t - q.o.x;
  const ry = p.y + d.y * t - q.o.y;
  const rz = p.z + d.z * t - q.o.z;
  const uu = q.u.x * q.u.x + q.u.y * q.u.y + q.u.z * q.u.z;
  const vv = q.v.x * q.v.x + q.v.y * q.v.y + q.v.z * q.v.z;
  const uv = q.u.x * q.v.x + q.u.y * q.v.y + q.u.z * q.v.z;
  const ru = rx * q.u.x + ry * q.u.y + rz * q.u.z;
  const rv = rx * q.v.x + ry * q.v.y + rz * q.v.z;
  const det = uu * vv - uv * uv;
  if (det < 1e-12) return false;
  const s = (ru * vv - rv * uv) / det;
  const w = (rv * uu - ru * uv) / det;
  return s >= 0 && s <= 1 && w >= 0 && w <= 1;
}

/**
 * Trace un rayon depuis le point p du vitrage vers la direction d.
 * Renvoie { gain, light } : fractions (déjà multipliées par g et τv du vitrage)
 * du rayonnement arrivant dans cette direction qui entrent dans le local.
 */
function trace(p, d, geo, glz) {
  if (d.z <= 1e-4) return ZERO;
  const k = iam(d.z);
  const { W, H, e } = geo;

  // Tableau : le rayon doit sortir par l'ouverture au nu de la façade.
  if (e > 0) {
    const t = e / d.z;
    const x = p.x + d.x * t;
    const y = p.y + d.y * t;
    if (x < -W / 2 || x > W / 2 || y < 0 || y > H) return ZERO;
  }

  let tauFar = 1;
  let tauNear = 1;
  let secondary = 0;
  const Gsec = glz.Gtot;

  const addNear = (m, weight) => {
    const alpha = Math.max(0, 1 - m.tau - m.rho);
    secondary += tauNear * weight * (alpha * Gsec / G2 + m.tau * (1 - glz.g) * Gsec / G1);
    tauNear *= m.tau;
  };

  for (const q of geo.quads) {
    if (hitQuad(p, d, q)) {
      const m = q.mat(d);
      if (q.near > 0) addNear(m, q.near);
      else tauFar *= m.tau;
      if (tauFar * tauNear === 0 && secondary === 0) return ZERO;
    }
  }

  if (geo.plane) {
    const t = geo.plane.z / d.z;
    const x = p.x + d.x * t;
    const y = p.y + d.y * t;
    if (geo.plane.covers(x, y)) addNear(geo.plane.mat(d), 1);
  }

  return {
    gain: tauFar * (tauNear * glz.g * k + secondary),
    light: tauFar * tauNear * glz.tv * k,
  };
}
const ZERO = { gain: 0, light: 0 };

function glazingParams(cfg) {
  const gl = GLAZINGS[cfg.glazing];
  const Gtot = 1 / (1 / gl.ug + 1 / G1 + 1 / G2);
  return { g: gl.g, tv: gl.tv, Gtot };
}

function gridPoints(W, H, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pts.push({ x: -W / 2 + ((i + 0.5) / n) * W, y: ((j + 0.5) / n) * H, z: 0 });
    }
  }
  return pts;
}

// Directions hémisphériques (pondération cosinus) autour de la normale z, stratifiées.
const HEMI = (() => {
  const dirs = [];
  const nr = 14;
  const nphi = 28;
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nphi; j++) {
      const r = Math.sqrt((i + 0.5) / nr);
      const ph = ((j + 0.5) / nphi) * 2 * Math.PI;
      const x = r * Math.cos(ph);
      const y = r * Math.sin(ph);
      dirs.push({ x, y, z: Math.sqrt(Math.max(0, 1 - r * r)) });
    }
  }
  return dirs;
})();

/**
 * Prépare un « modèle » réutilisable pour une configuration : géométrie,
 * facteurs diffus ciel / sol précalculés, et calcul direct pour n'importe quel soleil.
 */
export function makeModel(cfg, gridN = 12) {
  const geo = buildGeometry(cfg);
  const glz = glazingParams(cfg);
  const pts = gridPoints(cfg.W, cfg.H, gridN);

  // Diffus : moyenne pondérée cosinus sur les demi-hémisphères ciel (y>0) et sol (y<0).
  const dpts = gridPoints(cfg.W, cfg.H, 7);
  let sg = 0, sl = 0, ns = 0, gg = 0, gl = 0, ng = 0;
  for (const p of dpts) {
    for (const d of HEMI) {
      const r = trace(p, d, geo, glz);
      if (d.y >= 0) { sg += r.gain; sl += r.light; ns++; }
      else { gg += r.gain; gl += r.light; ng++; }
    }
  }
  const diffuse = { skyGain: sg / ns, skyLight: sl / ns, gndGain: gg / ng, gndLight: gl / ng };

  function direct(s) {
    if (s.z <= 0 || s.y <= 0) return { gain: 0, light: 0, sunlit: 0 };
    let g = 0, l = 0, lit = 0;
    for (const p of pts) {
      const r = trace(p, s, geo, glz);
      g += r.gain;
      l += r.light;
      if (r.light > 0.3 * glz.tv) lit++;
    }
    return { gain: g / pts.length, light: l / pts.length, sunlit: lit / pts.length };
  }

  return { cfg, geo, glz, diffuse, direct };
}

/**
 * Bilan instantané pour un modèle et un soleil donnés.
 * Toutes les valeurs sont en W/m² de vitrage (ou d'ouverture), sauf mention.
 */
export function evaluate(model, sun, doy) {
  const { cfg } = model;
  const sky = clearSky(sun.altitude, doy);
  const s = sunVectorLocal(sun.altitude, sun.azimuth, cfg.facadeAz);
  const cosT = Math.max(0, s.z);
  const dirInc = sun.altitude > 0 ? sky.dni * cosT : 0;
  const skyInc = sky.dhi / 2;
  const gndInc = (GROUND_ALBEDO * sky.ghi) / 2;
  const incident = dirInc + skyInc + gndInc;

  const dir = sun.altitude > 0 ? model.direct(s) : { gain: 0, light: 0, sunlit: 0 };
  const df = model.diffuse;
  const gain = dirInc * dir.gain + skyInc * df.skyGain + gndInc * df.gndGain;
  // Lumière : on travaille sur l'éclairement énergétique pondéré par τv.
  const light = dirInc * dir.light + skyInc * df.skyLight + gndInc * df.gndLight;

  return { sky, s, cosT, dirInc, skyInc, gndInc, incident, gain, light, sunlit: dir.sunlit };
}

/** Courbe journalière (pas en minutes) : puissance transmise en W/m² de vitrage. */
export function dailyProfile(model, year, doy, stepMin = 10) {
  const out = [];
  for (let m = 0; m <= 24 * 60; m += stepMin) {
    const h = m / 60;
    const sun = sunPosition(parisLocalToUTC(year, doy, h));
    const r = evaluate(model, sun, doy);
    out.push({ h, gain: r.gain, light: r.light, incident: r.incident, alt: sun.altitude });
  }
  return out;
}

/** Intégrale (kWh/m²) d'un profil journalier. */
export function integrate(profile, key) {
  let sum = 0;
  for (let i = 1; i < profile.length; i++) {
    const dt = profile[i].h - profile[i - 1].h;
    sum += ((profile[i][key] + profile[i - 1][key]) / 2) * dt;
  }
  return sum / 1000;
}
