import { sunPosition, parisLocalToUTC, sunTimes, dayOfYearToDate, isSummerTime } from './solar.js';
import {
  GLAZINGS, PROTECTIONS, defaultConfig, makeModel, evaluate, dailyProfile, integrate,
} from './shading.js';
import { SolarScene } from './scene3d.js';
import {
  renderSunPath, renderDayChart, renderMonthChart, renderComparison, fmtHour, fmt, MONTHS,
} from './charts.js';

const YEAR = new Date().getFullYear();
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

const state = {
  ...defaultConfig(),
  facadeAz: 225,
  doy: 202,
  hour: 16,
  view: 'ext',
};
readURL();

const ORIENTS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SO', 225], ['O', 270], ['NO', 315]];

const ICONS = {
  none: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M12 3v18M5 12h14"/>',
  battants: '<rect x="7" y="3" width="10" height="18" rx="1"/><path d="M7 3L2 5v14l5 2M17 3l5 2v14l-5 2"/>',
  accordeon: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M5 3l3 2v14l-3 2M8 5l3-2v18l-3-2M19 3l-3 2v14l3 2M16 5l-3-2v18l3-2"/>',
  roulant: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M5 6h14M5 9h14M5 12h14M5 15h14"/><rect x="4" y="1.5" width="16" height="2.5" rx="1"/>',
  bso: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M5 6l14-1.5M5 9.5l14-1.5M5 13l14-1.5M5 16.5l14-1.5"/>',
  screen: '<rect x="5" y="3" width="14" height="18" rx="1"/><rect x="5" y="3" width="14" height="12" fill="currentColor" fill-opacity=".18" stroke="none"/><path d="M5 15h14"/>',
  banne: '<rect x="6" y="8" width="12" height="13" rx="1"/><path d="M3 6h18l-3 6H6z"/>',
};

const DEPLOY_LABEL = {
  roulant: 'Tablier baissé',
  bso: 'Store descendu',
  screen: 'Toile déroulée',
  accordeon: 'Fermeture',
  banne: 'Déploiement',
};

let model = null;
let ref = null;
let dayData = null;
let monthData = null;

// ---------------------------------------------------------------------------
// Construction des contrôles
// ---------------------------------------------------------------------------

const rose = $('rose');
const needle = document.createElement('div');
needle.className = 'needle';
rose.appendChild(needle);
for (const [label, az] of ORIENTS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.az = az;
  b.setAttribute('aria-label', `Façade orientée ${label} (${az}°)`);
  const a = (az * Math.PI) / 180;
  b.style.left = `${58 + 42 * Math.sin(a)}px`;
  b.style.top = `${58 - 42 * Math.cos(a)}px`;
  b.addEventListener('click', () => set({ facadeAz: az }));
  rose.appendChild(b);
}

const glz = $('glazing');
for (const [k, v] of Object.entries(GLAZINGS)) {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = `${v.label} (g = ${fmt(v.g, 2)})`;
  glz.appendChild(o);
}
glz.addEventListener('change', () => set({ glazing: glz.value }));

const types = $('types');
for (const [k, v] of Object.entries(PROTECTIONS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.v = k;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span>${v.label}</span>`;
  b.addEventListener('click', () => set({ type: k }));
  types.appendChild(b);
}

const sliders = {
  facadeAz: (v) => `${v}°`,
  W: (v) => `${fmt(v, 2)} m`,
  H: (v) => `${fmt(v, 2)} m`,
  e: (v) => `${Math.round(v * 100)} cm`,
  deploy: (v) => `${Math.round(v * 100)} %`,
  slatAngle: (v) => `${v}°`,
  openAngle: (v) => `${v}°`,
  bannePro: (v) => `${fmt(v, 1)} m`,
  banneAngle: (v) => `${v}°`,
};
for (const id of Object.keys(sliders)) {
  $(id).addEventListener('input', (e) => set({ [id]: parseFloat(e.target.value) }));
}
$('hour').addEventListener('input', (e) => set({ hour: parseFloat(e.target.value) }));
$('doy').addEventListener('input', (e) => set({ doy: parseInt(e.target.value, 10) }));
$('ajoure').addEventListener('change', (e) => set({ ajoure: e.target.checked }));

const segs = {
  louvered: (v) => v === 'true',
  openness: (v) => parseFloat(v),
  color: (v) => v,
  view: (v) => v,
};
for (const [id, parse] of Object.entries(segs)) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) set({ [id]: parse(b.dataset.v) });
  });
}
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) set({ doy: parseInt(b.dataset.doy, 10) });
});

// ---------------------------------------------------------------------------
// Scène 3D
// ---------------------------------------------------------------------------

let scene = null;
try {
  scene = new SolarScene($('viewer'));
} catch (err) {
  $('viewer').insertAdjacentHTML('beforeend', '<p class="viewer-hint">La vue 3D nécessite WebGL.</p>');
  console.error(err);
}

// ---------------------------------------------------------------------------
// Mise à jour
// ---------------------------------------------------------------------------

const GEOMETRY_KEYS = ['facadeAz', 'W', 'H', 'e', 'glazing', 'type', 'deploy', 'slatAngle', 'openAngle', 'louvered', 'color', 'openness', 'ajoure', 'bannePro', 'banneAngle'];

function set(patch) {
  const prev = { ...state };
  Object.assign(state, patch);
  const changed = (keys) => keys.some((k) => prev[k] !== state[k]);
  const geom = changed(GEOMETRY_KEYS);
  const day = changed(['doy']);

  syncControls();
  if (geom) recomputeModels();
  if (geom || day) recomputeDay();
  if (geom || changed(['doy'])) scheduleSlow();
  if (changed(['view']) && scene) scene.setView(state.view);
  updateInstant();
  writeURL();
}

function configOf(s) {
  const c = {};
  for (const k of GEOMETRY_KEYS) c[k] = s[k];
  return c;
}

function recomputeModels() {
  const cfg = configOf(state);
  model = makeModel(cfg);
  ref = makeModel({ ...cfg, type: 'none' });
  if (scene) {
    scene.setBuilding(cfg);
    scene.setProtection(cfg);
  }
}

function recomputeDay() {
  const area = state.W * state.H;
  const withP = dailyProfile(model, YEAR, state.doy, 10);
  const without = dailyProfile(ref, YEAR, state.doy, 10);
  const times = sunTimes(YEAR, state.doy);
  dayData = { withP, without, area, times };

  if (scene) {
    const pts = (d) => {
      const out = [];
      for (let m = 0; m <= 1440; m += 10) out.push(sunPosition(parisLocalToUTC(YEAR, d, m / 60)));
      return out;
    };
    scene.setPaths([
      { points: pts(state.doy), color: 0xffc23d },
      { points: pts(172), color: 0xffffff, dashed: true },
      { points: pts(355), color: 0xffffff, dashed: true },
    ], state.facadeAz);
  }

  // Dégradé jour / nuit sous le curseur horaire
  if (times.rise !== null && times.set !== null) {
    const r = (times.rise / 24) * 100;
    const s = (times.set / 24) * 100;
    $('hour').style.setProperty('--day-gradient',
      `linear-gradient(90deg, #111110 0%, #111110 ${r - 1.5}%, #ff9f1c ${r + 1}%, #ffca7d ${(r + s) / 2}%, #ff9f1c ${s - 1}%, #111110 ${s + 1.5}%, #111110 100%)`);
  }

  const kWith = integrate(withP, 'gain') * area;
  const kWithout = integrate(without, 'gain') * area;
  const red = kWithout > 0.01 ? 1 - kWith / kWithout : 0;
  const lit = sunlitHours(without);
  $('dayTotals').innerHTML = `
    <span>Sans protection <b>${fmt(kWithout, 1)} kWh</b></span>
    <span>Avec protection <b>${fmt(kWith, 1)} kWh</b></span>
    <span>Rayonnement arrêté sur la journée <b>${fmt(red * 100)} %</b></span>
    <span>Soleil direct sur la vitre <b>${lit}</b></span>`;
  $('daySub').textContent = `${dateLabel(state.doy)}, ciel clair. Fenêtre de ${fmt(area, 2)} m². Sans protection, c'est l'équivalent d'un radiateur de 1 000 W allumé ${durationLabel(kWithout)}.`;
}

function sunlitHours(profile) {
  // Durée pendant laquelle le rayonnement direct atteint la vitre nue
  let n = 0;
  for (const p of profile) {
    const sun = sunPosition(parisLocalToUTC(YEAR, state.doy, p.h));
    if (sun.altitude <= 0) continue;
    const r = evaluate(ref, sun, state.doy);
    if (r.dirInc > 5 && r.sunlit > 0.05) n++;
  }
  const h = (n * 10) / 60;
  return h < 0.1 ? 'aucun' : durationLabel(h);
}

function durationLabel(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (hh === 0) return `${mm} min`;
  return mm ? `${hh} h ${String(mm).padStart(2, '0')}` : `${hh} h`;
}

let slowTimer = null;
function scheduleSlow() {
  clearTimeout(slowTimer);
  slowTimer = setTimeout(recomputeSlow, 120);
}

const COMPARE = [
  { type: 'none', label: 'Aucune', setting: 'référence', patch: {} },
  { type: 'battants', label: 'Volets battants', setting: 'fermés, persiennés', patch: { openAngle: 0, louvered: true } },
  { type: 'battants', label: 'Volets battants', setting: 'ouverts à 90°', patch: { openAngle: 90, louvered: false } },
  { type: 'accordeon', label: 'Volets accordéon', setting: 'fermés, persiennés', patch: { deploy: 1, louvered: true } },
  { type: 'roulant', label: 'Volet roulant', setting: 'baissé', patch: { deploy: 1, ajoure: false } },
  { type: 'roulant', label: 'Volet roulant', setting: 'à mi-hauteur', patch: { deploy: 0.5 } },
  { type: 'bso', label: 'Brise-soleil orientable', setting: 'lames à 45°', patch: { deploy: 1, slatAngle: 45 } },
  { type: 'screen', label: 'Store toile (screen)', setting: 'toile à 5 %', patch: { deploy: 1, openness: 5 } },
  { type: 'banne', label: 'Store banne', setting: 'avancée 1,5 m', patch: { deploy: 1, bannePro: 1.5, banneAngle: 25 } },
];

function recomputeSlow() {
  const cfg = configOf(state);
  const area = state.W * state.H;
  const refLow = makeModel({ ...cfg, type: 'none' }, 8);
  const curLow = makeModel(cfg, 8);

  // Bilan mensuel
  monthData = [];
  for (let mo = 0; mo < 12; mo++) {
    const doy = Math.round((Date.UTC(YEAR, mo, 21) - Date.UTC(YEAR, 0, 0)) / 86400e3);
    const a = dailyProfile(refLow, YEAR, doy, 15);
    const b = dailyProfile(curLow, YEAR, doy, 15);
    monthData.push({
      without: integrate(a, 'gain') * area,
      withP: integrate(b, 'gain') * area,
      noonAlt: Math.max(...a.map((p) => p.alt)),
    });
  }
  const curMonth = dayOfYearToDate(YEAR, state.doy).getUTCMonth();
  renderMonthChart($('monthChart'), { data: monthData, currentMonth: curMonth });
  $('monthTable').innerHTML = `<table><thead><tr><th>Mois</th><th>Sans (kWh/j)</th><th>Avec (kWh/j)</th><th>Arrêté</th></tr></thead><tbody>${
    monthData.map((d, i) => `<tr><td>${MONTHS[i]}</td><td>${fmt(d.without, 1)}</td><td>${fmt(d.withP, 1)}</td><td>${d.without > 0.01 ? fmt((1 - d.withP / d.without) * 100) : '—'} %</td></tr>`).join('')
  }</tbody></table>`;

  // Comparatif sur la journée choisie
  const base = dailyProfile(refLow, YEAR, state.doy, 15);
  const eBase = integrate(base, 'gain');
  const lBase = integrate(base, 'light');
  const rows = COMPARE.map((c) => {
    const m = c.type === 'none' ? refLow : makeModel({ ...cfg, type: c.type, ...c.patch }, 8);
    const p = c.type === 'none' ? base : dailyProfile(m, YEAR, state.doy, 15);
    const e = integrate(p, 'gain');
    return {
      label: c.label,
      setting: c.setting,
      reduction: eBase > 0 ? 1 - e / eBase : 0,
      light: lBase > 0 ? integrate(p, 'light') / lBase : 1,
      kwh: e * area,
    };
  });
  if (state.type !== 'none') {
    const p = dailyProfile(curLow, YEAR, state.doy, 15);
    const e = integrate(p, 'gain');
    rows.push({
      label: 'Votre réglage',
      setting: `${PROTECTIONS[state.type].label.toLowerCase()}, ${settingLabel()}`,
      reduction: eBase > 0 ? 1 - e / eBase : 0,
      light: lBase > 0 ? integrate(p, 'light') / lBase : 1,
      kwh: e * area,
      current: true,
    });
  }
  rows.sort((a, b) => b.reduction - a.reduction);
  renderComparison($('comparison'), rows);
  $('cmpSub').textContent = `Sur toute la journée du ${dateLabel(state.doy)}, pour votre fenêtre et votre orientation. Lumière : part de la lumière naturelle conservée.`;

  renderInsights();
}

function settingLabel() {
  switch (state.type) {
    case 'battants': return `${state.openAngle}°, ${state.louvered ? 'persiennés' : 'pleins'}`;
    case 'accordeon': return `fermé à ${Math.round(state.deploy * 100)} %`;
    case 'roulant': return `baissé à ${Math.round(state.deploy * 100)} %`;
    case 'bso': return `${Math.round(state.deploy * 100)} %, lames à ${state.slatAngle}°`;
    case 'screen': return `${Math.round(state.deploy * 100)} %, toile ${state.openness} %`;
    case 'banne': return `avancée ${fmt(state.bannePro * state.deploy, 1)} m, ${state.banneAngle}°`;
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Valeurs instantanées
// ---------------------------------------------------------------------------

let lastSunPath = 0;
function updateInstant(force = false) {
  const sun = sunPosition(parisLocalToUTC(YEAR, state.doy, state.hour));
  const r = evaluate(model, sun, state.doy);
  const r0 = evaluate(ref, sun, state.doy);
  const area = state.W * state.H;
  const P = r.gain * area;
  const P0 = r0.gain * area;
  const reduction = P0 > 2 ? 1 - P / P0 : null;
  const gtot = r.incident > 5 ? r.gain / r.incident : null;
  const light = r0.light > 0.5 ? r.light / r0.light : null;
  const gl = GLAZINGS[state.glazing];

  $('kpis').innerHTML = `
    <div class="kpi hero">
      <div class="k-label">Chaleur solaire entrant maintenant</div>
      <div class="k-value">${fmt(P)}<small>W</small></div>
      <div class="k-note">sans protection : <b>${fmt(P0)} W</b></div>
    </div>
    <div class="kpi">
      <div class="k-label">Rayonnement arrêté</div>
      <div class="k-value">${reduction === null ? '—' : `${fmt(reduction * 100)}<small>%</small>`}</div>
      <div class="meter"><i style="width:${reduction === null ? 0 : Math.max(0, reduction * 100)}%"></i></div>
    </div>
    <div class="kpi">
      <div class="k-label">Facteur solaire global g<sub>tot</sub></div>
      <div class="k-value">${gtot === null ? '—' : fmt(gtot, 2)}</div>
      <div class="k-note">vitrage seul : <b>g = ${fmt(gl.g, 2)}</b></div>
    </div>
    <div class="kpi">
      <div class="k-label">Lumière naturelle conservée</div>
      <div class="k-value">${light === null ? '—' : `${fmt(light * 100)}<small>%</small>`}</div>
      <div class="k-note">vue : <b>${PROTECTIONS[state.type].view.toLowerCase()}</b></div>
    </div>`;

  // Badge soleil
  const incidence = Math.acos(Math.min(1, r.cosT)) * 180 / Math.PI;
  let tag;
  if (sun.altitude <= 0) tag = '<span class="tag tag-night">Soleil couché</span>';
  else if (r.dirInc > 1) tag = `<span class="tag tag-sun">Soleil sur la façade · ${fmt(incidence)}° d'incidence</span>`;
  else tag = '<span class="tag tag-shade">Façade à l\'ombre</span>';
  $('sunBadge').innerHTML = `
    <strong>${dateLabel(state.doy)} · ${fmtHour(state.hour)}</strong>
    Hauteur ${fmt(Math.max(sun.altitude, -90), 1)}° · azimut ${fmt(sun.azimuth)}°<br>
    Façade : ${fmt(r.incident)} W/m² reçus<br>${tag}`;

  if (scene) scene.setSun(sun, state.facadeAz);

  if (dayData) {
    renderDayChart($('dayChart'), {
      without: dayData.without, withP: dayData.withP, hour: state.hour, area,
      onPick: (h) => set({ hour: Math.round(h * 12) / 12 }),
    });
  }

  const now = performance.now();
  if (force || !playing || now - lastSunPath > 200) {
    lastSunPath = now;
    renderSunPath($('sunPath'), { year: YEAR, doy: state.doy, hour: state.hour, sun, facadeAz: state.facadeAz });
    const t = dayData ? dayData.times : sunTimes(YEAR, state.doy);
    $('sunFacts').innerHTML = `
      <div><span>Lever</span><b>${t.rise === null ? '—' : fmtHour(t.rise)}</b></div>
      <div><span>Midi solaire</span><b>${fmtHour(t.noon)}</b><span>${fmt(t.maxAlt, 1)}°</span></div>
      <div><span>Coucher</span><b>${t.set === null ? '—' : fmtHour(t.set)}</b></div>`;
  }
  if (!playing) renderInsights(r);
}

// ---------------------------------------------------------------------------
// Messages pédagogiques
// ---------------------------------------------------------------------------

const IC = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
};

function orientationName(az) {
  const names = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  return names[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}
function orientClass(az) {
  const a = ((az % 360) + 360) % 360;
  if (a >= 157.5 && a <= 202.5) return 'S';
  if (a > 202.5 && a < 247.5) return 'SO';
  if (a >= 247.5 && a < 315) return 'O';
  if (a > 112.5 && a < 157.5) return 'SE';
  if (a > 45 && a <= 112.5) return 'E';
  return 'N';
}

let lastInstant = null;
function renderInsights(instant) {
  if (instant) lastInstant = instant;
  const r = lastInstant;
  const items = [];
  const oc = orientClass(state.facadeAz);
  const on = orientationName(state.facadeAz);

  const orientText = {
    S: `Façade ${on} : en été le soleil de midi est haut (jusqu'à 65°) et frappe la vitre de biais ; une avancée horizontale l'arrête bien. En hiver, bas sur l'horizon, il entre profondément dans la pièce : un apport gratuit à conserver.`,
    O: `Façade ${on} : le soleil l'atteint l'après-midi, de plus en plus bas et de face, au moment où l'air est le plus chaud. C'est l'orientation la plus exposée à la surchauffe ; seule une protection verticale fermée à temps est efficace.`,
    E: `Façade ${on} : le soleil la frappe le matin, bas et presque de face. Les apports arrivent tôt, quand l'air est encore frais, mais ils chargent la pièce pour la journée ; fermer avant que le soleil n'atteigne la vitre.`,
    SE: `Façade ${on} : le soleil l'atteint toute la matinée et jusqu'au début d'après-midi. Il arrive d'abord bas et de face, puis haut et de biais : une protection réglable (BSO, screen) suit mieux cette course qu'une avancée fixe.`,
    SO: `Façade ${on} : elle reçoit le soleil de midi, haut, puis celui de l'après-midi, bas et de face, aux heures les plus chaudes. Une avancée ne suffit pas en fin de journée : il faut une protection verticale.`,
    N: `Façade ${on} : peu de soleil direct, seulement tôt le matin ou tard le soir en été, et très rasant. L'essentiel des apports vient du ciel ; les protections servent surtout à l'occultation et à l'intimité.`,
  };
  items.push(['compass', orientText[oc]]);

  if (r) {
    if (r.sky.dni <= 0) {
      items.push(['sun', 'Le soleil est couché : rouvrir les protections permet d\'évacuer la chaleur accumulée (surventilation nocturne).']);
    } else if (r.dirInc <= 1) {
      items.push(['sun', 'À cette heure, le soleil est derrière la façade : elle ne reçoit que le rayonnement diffus du ciel et celui réfléchi par le sol.']);
    } else {
      const inc = Math.acos(Math.min(1, r.cosT)) * 180 / Math.PI;
      items.push(['sun', `À cette heure, le soleil frappe la vitre sous ${fmt(inc)}° d'incidence et la façade reçoit ${fmt(r.incident)} W/m². ${r.sunlit > 0.02 ? `Sans protection, ${fmt(evaluate(ref, sunPosition(parisLocalToUTC(YEAR, state.doy, state.hour)), state.doy).sunlit * 100)} % du vitrage serait au soleil.` : ''}`]);
    }
  }

  if (monthData) {
    let im = 0;
    monthData.forEach((d, i) => { if (d.without > monthData[im].without) im = i; });
    const jun = monthData[5].without;
    const extra = oc === 'S' && monthData[im].without > jun * 1.1
      ? ' Au sud, les apports sont plus forts au printemps et en automne qu\'en juin : le soleil y est plus bas et frappe la vitre plus franchement.'
      : '';
    items.push(['cal', `Par ciel clair, cette fenêtre reçoit le plus d'énergie en ${MONTHS[im].replace('.', '')} (${fmt(monthData[im].without, 1)} kWh par jour sans protection).${extra}`]);
  }

  items.push(['tip', protectionTip(oc)]);

  $('insights').innerHTML = items
    .map(([ic, t]) => `<div class="insight"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[ic]}</svg><p>${t}</p></div>`)
    .join('');
  $('insightSub').textContent = `${PROTECTIONS[state.type].label}, façade ${on}`;
}

function protectionTip(oc) {
  const t = state.type;
  if (t === 'none') return `Même sans protection, le tableau de ${Math.round(state.e * 100)} cm fait office de petit masque : il ombre le haut et les côtés du vitrage quand le soleil arrive de biais.`;
  if (t === 'banne' && (oc === 'E' || oc === 'O' || oc === 'N')) return "Face au soleil bas de l'est ou de l'ouest, le store banne laisse passer l'essentiel du rayonnement sous la toile. Comparez avec un BSO ou un screen.";
  if (t === 'banne') return 'Au sud, le store banne coupe le soleil haut de midi. Plus il avance et s\'incline, plus il protège tard dans la journée, au prix de la vue vers le ciel.';
  if (t === 'battants' && state.openAngle >= 60 && state.openAngle <= 120) return 'Ouverts à angle droit, les vantaux deviennent des ailettes verticales : utiles quand le soleil arrive de biais, inutiles quand il est face à la fenêtre.';
  if (t === 'battants' && state.openAngle >= 150) return 'Rabattus contre la façade, les volets ne protègent plus rien : le résultat est celui d\'une fenêtre nue.';
  if (t === 'roulant' && state.deploy < 0.95) return 'Un volet roulant partiellement baissé ne protège que le haut du vitrage. Observez la tache de soleil au sol en vue intérieure : elle raccourcit mais persiste.';
  if (t === 'roulant') return state.ajoure ? 'Les lames ajourées laissent filtrer un peu de lumière une fois le tablier en bas, sans laisser passer le soleil direct.' : 'Baissé, le volet roulant arrête presque tout, lumière comprise. Des lames ajourées ou un BSO préservent mieux l\'éclairage naturel.';
  if (t === 'bso' && state.slatAngle < 25) return 'Lames presque horizontales : le soleil haut est arrêté, mais le soleil bas passe entre les lames. Inclinez-les davantage quand le soleil descend.';
  if (t === 'bso') return 'Le BSO s\'ajuste à la hauteur du soleil : il suffit de fermer les lames juste assez pour couper le rayonnement direct, et la lumière diffuse continue d\'entrer.';
  if (t === 'screen') return `Avec une toile à ${state.openness} %, on garde une vue voilée vers l'extérieur. Une toile foncée offre une meilleure vision au travers ; une toile claire renvoie plus de rayonnement.`;
  if (t === 'accordeon') return state.louvered ? 'Persiennées, les volets accordéon bloquent le soleil direct tout en laissant passer l\'air et un peu de lumière, comme des persiennes parisiennes.' : 'Pleins, les volets accordéon occultent complètement : efficaces, mais la pièce reste dans le noir.';
  if (state.color === 'fonce') return 'Une teinte foncée absorbe davantage : une petite partie de cette chaleur rejoint la vitre. À l\'extérieur, l\'effet reste modeste.';
  return PROTECTIONS[t].text;
}

// ---------------------------------------------------------------------------
// Synchronisation des contrôles
// ---------------------------------------------------------------------------

function syncControls() {
  for (const [id, f] of Object.entries(sliders)) {
    $(id).value = state[id];
    $(`${id}Out`).textContent = f(state[id]);
  }
  $('hour').value = state.hour;
  $('hourOut').textContent = `${fmtHour(state.hour)} (${isSummerTime(YEAR, state.doy) ? 'UTC+2' : 'UTC+1'})`;
  $('doy').value = state.doy;
  $('doyOut').textContent = dateLabel(state.doy);
  $('glazing').value = state.glazing;
  $('ajoure').checked = state.ajoure;
  for (const b of rose.querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.az === state.facadeAz));
  needle.style.transform = `rotate(${state.facadeAz - 180}deg)`;
  for (const b of types.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === state.type));
  for (const [id] of Object.entries(segs)) {
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(state[id])));
  }
  for (const b of $('presets').querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.doy === state.doy));
  for (const f of document.querySelectorAll('.params [data-for]')) {
    f.hidden = !f.dataset.for.split(' ').includes(state.type);
  }
  $('deployLabel').textContent = DEPLOY_LABEL[state.type] || 'Déploiement';
  $('typeDesc').textContent = PROTECTIONS[state.type].text;
}

function dateLabel(doy) {
  return dayOfYearToDate(YEAR, doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Animation de la journée
// ---------------------------------------------------------------------------

let playing = false;
let raf = 0;
$('play').addEventListener('click', () => {
  playing = !playing;
  $('play').classList.toggle('is-playing', playing);
  $('play').setAttribute('aria-label', playing ? 'Mettre en pause' : 'Animer la journée');
  if (playing) {
    const t = dayData.times;
    if (t.set !== null && (state.hour >= t.set || state.hour < (t.rise ?? 0) - 0.5)) state.hour = Math.max(0, (t.rise ?? 5) - 0.5);
    let last = performance.now();
    const step = (now) => {
      if (!playing) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let h = state.hour + dt * 1.6; // ~15 s pour une journée de soleil
      const end = (dayData.times.set ?? 22) + 0.5;
      if (h > end) h = Math.max(0, (dayData.times.rise ?? 5) - 0.5);
      state.hour = h;
      $('hour').value = h;
      $('hourOut').textContent = `${fmtHour(h)} (${isSummerTime(YEAR, state.doy) ? 'UTC+2' : 'UTC+1'})`;
      updateInstant();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  } else {
    cancelAnimationFrame(raf);
    state.hour = Math.round(state.hour * 12) / 12;
    updateInstant(true);
    writeURL();
  }
});

// ---------------------------------------------------------------------------
// Lien partageable : l'état est conservé dans l'URL
// ---------------------------------------------------------------------------

const URL_KEYS = { ...Object.fromEntries(GEOMETRY_KEYS.map((k) => [k, k])), doy: 'doy', hour: 'hour', view: 'view' };

function writeURL() {
  const p = new URLSearchParams();
  for (const k of Object.keys(URL_KEYS)) p.set(k, String(state[k]));
  history.replaceState(null, '', `?${p.toString()}${location.hash}`);
}

function readURL() {
  const p = new URLSearchParams(location.search);
  const d = defaultConfig();
  for (const k of [...GEOMETRY_KEYS_INIT(), 'doy', 'hour', 'view']) {
    if (!p.has(k)) continue;
    const v = p.get(k);
    const sample = k in d ? d[k] : state[k];
    if (typeof sample === 'number') {
      const n = parseFloat(v);
      if (Number.isFinite(n)) state[k] = n;
    } else if (typeof sample === 'boolean') state[k] = v === 'true';
    else state[k] = v;
  }
  if (!GLAZINGS[state.glazing]) state.glazing = d.glazing;
  if (!PROTECTIONS[state.type]) state.type = d.type;
  if (!['clair', 'moyen', 'fonce'].includes(state.color)) state.color = d.color;
  if (!['ext', 'int', 'coupe'].includes(state.view)) state.view = 'ext';
  state.doy = Math.max(1, Math.min(365, Math.round(state.doy)));
  state.hour = Math.max(0, Math.min(24, state.hour));
}
function GEOMETRY_KEYS_INIT() {
  return Object.keys(defaultConfig());
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

syncControls();
recomputeModels();
recomputeDay();
if (scene) scene.setView(state.view);
updateInstant(true);
recomputeSlow();
