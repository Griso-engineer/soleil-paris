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
    label: 'Volets pliants',
    short: 'Feuilles articulées repliées dans le tableau',
    view: 'Nulle fermés, totale repliés',
    text: "Persiennes repliables : de chaque côté, deux ou trois feuilles étroites articulées entre elles se replient en zigzag dans l'épaisseur du tableau. Fermées, elles couvrent la baie comme des volets battants ; à mi-course, leurs feuilles obliques font ailettes.",
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
    // porte-fenêtre parisienne type, dans un mur de pierre épais
    W: 1.2,
    H: 2.15,
    e: 0.3,
    glazing: 'simple',
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
      // Volets pliants : chaque feuille est un rectangle vertical, comme un vantail.
      const v = { x: 0, y: H, z: 0 };
      for (const leaf of foldingLeaves(cfg)) {
        const u = { x: leaf.dir.x * leaf.L, y: 0, z: leaf.dir.z * leaf.L };
        const n = normalize(cross(u, v));
        geo.quads.push({
          o: { x: leaf.o.x, y: 0, z: leaf.o.z }, u, v, n, near: 1,
          mat: (dir) => (cfg.louvered ? louver(dir, n, PERSIENNE, PERSIENNE.beta, rhoC) : opaque(rhoC)),
        });
      }
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
    case 'custom': {
      // Obstacles libres (rectangles opaques), pour les études paramétriques et les tests
      for (const q of cfg.quads || []) {
        geo.quads.push({ ...q, n: normalize(cross(q.u, q.v)), near: 0, mat: () => opaque(rhoC) });
      }
      break;
    }
    default:
      break;
  }
  return geo;
}

/**
 * Géométrie des volets pliants, partagée par le calcul et la vue 3D.
 * De chaque côté, n feuilles de largeur L articulées entre elles. La première est
 * ferrée sur le jambage, juste derrière le nu de la façade. Fermées (deploy = 1),
 * les feuilles sont dans le plan de la baie ; en s'ouvrant elles se replient en
 * zigzag vers l'intérieur du tableau, jusqu'à se ranger perpendiculaires au mur.
 * Renvoie [{ o: {x, z}, dir: {x, z}, L, side, k }] (o : arête de départ, en pied).
 */
export function foldingLeaves(cfg) {
  const { W, e } = cfg;
  const d = Math.max(0, Math.min(1, cfg.deploy));
  const zf = Math.max(0.03, e - 0.03);
  const depth = Math.max(0.06, zf - 0.04); // place disponible devant la menuiserie
  const n = Math.min(4, Math.max(2, Math.ceil(W / 2 / Math.max(0.15, depth))));
  const L = W / 2 / n;
  // Le zigzag ne peut pas s'enfoncer plus profond que le tableau.
  const maxFold = Math.asin(Math.min(1, depth / L));
  const theta = Math.min((1 - d) * (Math.PI / 2), maxFold);
  const leaves = [];
  for (const side of [-1, 1]) {
    let x = (side * W) / 2;
    let z = zf;
    for (let k = 0; k < n; k++) {
      const dir = { x: -side * Math.cos(theta), z: (k % 2 === 0 ? -1 : 1) * Math.sin(theta) };
      leaves.push({ o: { x, z }, dir, L, side, k });
      x += dir.x * L;
      z += dir.z * L;
    }
  }
  return leaves;
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
/**
 * Porosité vue en élévation : part de la baie qui reste libre quand on la regarde
 * de face (perpendiculairement à la façade), pour la protection et sa position.
 * C'est l'ordre de grandeur de la section offerte à la ventilation naturelle.
 * Renvoie une fraction 0 → 1.
 */
export function porosity(cfg) {
  const { W, H, e } = cfg;
  const d = Math.max(0, Math.min(1, cfg.deploy));
  const gap = (slat, betaDeg) => Math.max(0, 1 - (slat.w * Math.abs(Math.sin(betaDeg * RAD))) / slat.s);
  const persienne = gap(PERSIENNE, PERSIENNE.beta);
  const leafPorosity = cfg.louvered ? persienne : 0;
  switch (cfg.type) {
    case 'roulant': return 1 - d + (cfg.ajoure && d >= 0.999 ? 0.04 : 0);
    case 'bso': return 1 - d + d * gap(BSO_SLAT, cfg.slatAngle);
    case 'screen': return 1 - d + (d * cfg.openness) / 100;
    case 'battants': {
      // Projection des vantaux sur la baie : L·cos(a) de chaque côté, nulle au-delà de 90°
      const cover = Math.max(0, Math.cos(cfg.openAngle * RAD));
      return 1 - cover * (1 - leafPorosity);
    }
    case 'accordeon': {
      // Projection des feuilles en zigzag : W·cos(θ) au total
      const leaves = foldingLeaves(cfg);
      const cover = leaves.reduce((s, l) => s + Math.abs(l.dir.x) * l.L, 0) / W;
      return 1 - Math.min(1, cover) * (1 - leafPorosity);
    }
    case 'banne': {
      // La toile et son lambrequin masquent le haut de la baie vus de face
      const P = cfg.bannePro * d;
      const drop = P * Math.sin(cfg.banneAngle * RAD) + (P > 0.02 ? 0.2 : 0) - 0.25;
      return 1 - Math.max(0, Math.min(H, drop)) / H;
    }
    default:
      void e;
      return 1;
  }
}

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

  /**
   * Masque solaire : part du vitrage atteinte par le rayonnement direct si le soleil
   * se trouvait dans la direction s (repère façade). Transmission géométrique seule,
   * sans le facteur d'incidence du verre : 1 = tout le vitrage au soleil, 0 = masqué.
   */
  function mask(s) {
    if (s.z <= 1e-3) return 0;
    const k = iam(s.z);
    if (k <= 0) return 0;
    let l = 0;
    for (const p of pts) l += trace(p, s, geo, glz).light;
    return Math.min(1, l / (pts.length * glz.tv * k));
  }

  return { cfg, geo, glz, diffuse, direct, mask };
}

/**
 * Grille du masque solaire sur la voûte céleste, en coordonnées absolues :
 * values[i][j] pour la hauteur i·step et l'azimut j·step (0 = nord, sens horaire).
 * Avec `centers`, les valeurs sont prises au centre des cases (dessin en 2D).
 */
export function maskGrid(model, step = 5, centers = false) {
  const off = centers ? step / 2 : 0;
  const nAlt = Math.round(90 / step) + (centers ? 0 : 1);
  const nAz = Math.round(360 / step) + (centers ? 0 : 1);
  const values = [];
  for (let i = 0; i < nAlt; i++) {
    const alt = Math.min(89.9, i * step + off);
    const row = [];
    for (let j = 0; j < nAz; j++) {
      row.push(model.mask(sunVectorLocal(alt, j * step + off, model.cfg.facadeAz)));
    }
    values.push(row);
  }
  return { step, centers, values };
}

// Rampe du masque, du bleu nuit (masqué) au rose (tout le vitrage au soleil),
// dans l'esprit des sphères de masque Ladybug.
const MASK_RAMP = [
  [0, [47, 54, 80]], [0.2, [111, 130, 179]], [0.4, [185, 214, 240]],
  [0.5, [255, 243, 176]], [0.65, [255, 208, 90]], [0.8, [247, 147, 76]], [1, [232, 51, 90]],
];
export function maskColor(v) {
  const x = Math.max(0, Math.min(1, v));
  for (let k = 1; k < MASK_RAMP.length; k++) {
    const [x1, c1] = MASK_RAMP[k];
    if (x <= x1) {
      const [x0, c0] = MASK_RAMP[k - 1];
      const t = (x - x0) / (x1 - x0);
      return c0.map((c, i) => Math.round(c + (c1[i] - c) * t));
    }
  }
  return MASK_RAMP[MASK_RAMP.length - 1][1];
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
