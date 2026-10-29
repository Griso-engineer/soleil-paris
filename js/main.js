import { sunPosition, parisLocalToUTC, sunTimes, dayOfYearToDate, isSummerTime } from './solar.js';
import {
  GLAZINGS, PROTECTIONS, COLORS, defaultConfig, makeModel, evaluate, dailyProfile, integrate, porosity, maskGrid,
} from './shading.js';
import { SolarScene } from './scene3d.js';
import { exportReport } from './report.js';
import { L, LANG, LOCALE, withLang } from './i18n.js';
import {
  renderSunPath, renderDayChart, renderLiveDay, maskLegendHTML, maskGradient, renderMonthChart, renderComparison, fmtHour, fmt, MONTHS,
} from './charts.js';

const YEAR = new Date().getFullYear();
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

const state = {
  ...defaultConfig(),
  facadeAz: 180,
  type: 'battants',
  openAngle: 55,
  roomArea: 20, // m², pour l'estimation de surchauffe en canicule
  doy: 202,
  hour: 14,
  view: 'ext',
};
readURL();

const ORIENTS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], [L('SO', 'SW'), 225], [L('O', 'W'), 270], [L('NO', 'NW'), 315]];

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
  roulant: L('Tablier baissé', 'Curtain lowered'),
  bso: L('Store descendu', 'Blind lowered'),
  screen: L('Toile déroulée', 'Fabric unrolled'),
  accordeon: L('Fermeture (0 % : repliés dans le tableau)', 'Closure (0 %: folded into the reveal)'),
  banne: L('Déploiement', 'Extension'),
};

let model = null;
let ref = null;
let dayData = null;
let monthData = null;
let heatData = null;
let maskData = null; // grilles du masque solaire (2D : centres de cases, 3D : sommets)

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
  b.setAttribute('aria-label', L(`Façade orientée ${label} (${az}°)`, `Façade facing ${label} (${az}°)`));
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
  roomArea: (v) => `${v} m²`,
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
  if (geom || changed(['doy', 'roomArea'])) scheduleSlow();
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
      `linear-gradient(90deg, #8796b3 0%, #8796b3 ${r - 1.5}%, #ff9f1c ${r + 1}%, #ffca7d ${(r + s) / 2}%, #ff9f1c ${s - 1}%, #8796b3 ${s + 1.5}%, #8796b3 100%)`);
  }

  const kWith = integrate(withP, 'gain') * area;
  const kWithout = integrate(without, 'gain') * area;
  const incDay = integrate(withP, 'incident') * area;
  const light0 = integrate(without, 'light');
  renderKpis($('kpisDay'), {
    heatLabel: L('Chaleur solaire entrée', 'Solar heat entered'),
    heat: fmt(kWith * 1000), heat0: fmt(kWithout * 1000), unit: 'Wh',
    reduction: kWithout > 0.01 ? 1 - kWith / kWithout : null,
    gtot: incDay > 0.01 ? kWith / incDay : null,
    light: light0 > 0.001 ? integrate(withP, 'light') / light0 : null,
  });
  $('kpiDayLabel').textContent = `${dateLabel(state.doy)}, ${L('ciel clair', 'clear sky')}`;
  const lit = sunlitHours(without);
  $('dayTotals').innerHTML = `
    <span>${L('Soleil direct sur la vitre', 'Direct sun on the glass')} <b>${lit}</b></span>
    <span>${L('Lever', 'Sunrise')} <b>${times.rise === null ? '—' : fmtHour(times.rise)}</b></span>
    <span>${L('Coucher', 'Sunset')} <b>${times.set === null ? '—' : fmtHour(times.set)}</b></span>`;
  $('daySub').textContent = L(
    `${dateLabel(state.doy)}, ciel clair. Fenêtre de ${fmt(area, 2)} m². Sans protection, c'est l'équivalent d'un radiateur de 1 000 W allumé ${durationLabel(kWithout)}.`,
    `${dateLabel(state.doy)}, clear sky. ${fmt(area, 2)} m² window. Without shading, this equals a 1,000 W heater running for ${durationLabel(kWithout)}.`
  );
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
  return h < 0.1 ? L('aucun', 'none') : durationLabel(h);
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
  { type: 'none', label: PROTECTIONS.none.label, setting: L('référence', 'reference'), patch: {} },
  { type: 'battants', label: PROTECTIONS.battants.label, setting: L('fermés, persiennés', 'closed, louvred'), patch: { openAngle: 0, louvered: true } },
  { type: 'battants', label: PROTECTIONS.battants.label, setting: L('ouverts à 90°', 'open at 90°'), patch: { openAngle: 90, louvered: false } },
  { type: 'accordeon', label: PROTECTIONS.accordeon.label, setting: L('fermés, persiennés', 'closed, louvred'), patch: { deploy: 1, louvered: true } },
  { type: 'roulant', label: PROTECTIONS.roulant.label, setting: L('baissé', 'lowered'), patch: { deploy: 1, ajoure: false } },
  { type: 'roulant', label: PROTECTIONS.roulant.label, setting: L('à mi-hauteur', 'half-way down'), patch: { deploy: 0.5 } },
  { type: 'bso', label: PROTECTIONS.bso.label, setting: L('lames à 45°', 'slats at 45°'), patch: { deploy: 1, slatAngle: 45 } },
  { type: 'screen', label: PROTECTIONS.screen.label, setting: L('toile à 5 %', '5 % fabric'), patch: { deploy: 1, openness: 5 } },
  { type: 'banne', label: PROTECTIONS.banne.label, setting: L('avancée 1,5 m', '1.5 m projection'), patch: { deploy: 1, bannePro: 1.5, banneAngle: 25 } },
];

function recomputeSlow() {
  const cfg = configOf(state);
  const area = state.W * state.H;
  const refLow = makeModel({ ...cfg, type: 'none' }, 8);
  const curLow = makeModel(cfg, 8);

  // Masque solaire de la protection choisie (grille de 10 × 10 points sur le vitrage)
  {
    const mm = makeModel(cfg, 10);
    maskData = { flat: maskGrid(mm, 5, true), dome: maskGrid(mm, 5, false) };
    if (scene) scene.setMask(maskData.dome, state.facadeAz, maskOn);
    updateInstant(true);
  }

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
  // Canicule : journée type de fin juillet, ciel clair
  {
    const a = integrate(dailyProfile(refLow, YEAR, CANICULE_DOY, 15), 'gain') * area * 1000;
    const b = integrate(dailyProfile(curLow, YEAR, CANICULE_DOY, 15), 'gain') * area * 1000;
    const avoided = Math.max(0, a - b);
    const rise = heatwaveRise(avoided, state.roomArea);
    const r1 = (v) => fmt(v, v < 10 ? 1 : 0);
    $('kpisHeat').innerHTML = `
      <div class="kpi hero">
        <div class="k-label">${L('Montée de température évitée', 'Temperature rise avoided')}</div>
        <div class="k-value">${avoided < 1 ? '0' : `${r1(rise.low)} ${L('à', 'to')} ${r1(rise.high)}`}<small>°C</small></div>
        <div class="k-note">${L(`pièce de <b>${fmt(state.roomArea)} m²</b>, sur la journée`, `<b>${fmt(state.roomArea)} m²</b> room, over the day`)}</div>
      </div>
      <div class="kpi">
        <div class="k-label">${L('Chaleur solaire évitée', 'Solar heat avoided')}</div>
        <div class="k-value">${fmt(avoided)}<small>Wh</small></div>
        <div class="k-note">${L(`sans protection : <b>${fmt(a)} Wh</b> entrent`, `without shading: <b>${fmt(a)} Wh</b> enter`)}</div>
      </div>
      <div class="kpi kpi-wide">
        <div class="k-label">${L('Hypothèses', 'Assumptions')}</div>
        <div class="k-note">${L("La chaleur évitée est rapportée à la capacité thermique de la pièce. Valeur basse : murs lourds (pierre, 260 kJ/m²K) et 40 % de la chaleur évacuée par la ventilation. Valeur haute : inertie moyenne (165 kJ/m²K) et 10 % évacuée. C'est un ordre de grandeur, pas une simulation thermique dynamique.",
          'The heat avoided is divided by the thermal capacity of the room. Low value: heavy walls (stone, 260 kJ/m²K) and 40 % of the heat removed by ventilation. High value: medium thermal mass (165 kJ/m²K) and 10 % removed. An order of magnitude, not a dynamic thermal simulation.')}</div>
      </div>`;
    heatData = { avoided, a, b, rise };
  }

  const curMonth = dayOfYearToDate(YEAR, state.doy).getUTCMonth();
  renderMonthChart($('monthChart'), { data: monthData, currentMonth: curMonth });
  $('monthTable').innerHTML = `<table><thead><tr><th>${L('Mois', 'Month')}</th><th>${L('Sans (kWh/j)', 'Without (kWh/day)')}</th><th>${L('Avec (kWh/j)', 'With (kWh/day)')}</th><th>${L('Arrêté', 'Blocked')}</th></tr></thead><tbody>${
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
      label: L('Votre réglage', 'Your setting'),
      setting: `${PROTECTIONS[state.type].label.toLowerCase()}, ${settingLabel()}`,
      reduction: eBase > 0 ? 1 - e / eBase : 0,
      light: lBase > 0 ? integrate(p, 'light') / lBase : 1,
      kwh: e * area,
      current: true,
    });
  }
  rows.sort((a, b) => b.reduction - a.reduction);
  renderComparison($('comparison'), rows);
  $('cmpSub').textContent = L(
    `Sur toute la journée du ${dateLabel(state.doy)}, pour votre fenêtre et votre orientation. Lumière : part de la lumière naturelle conservée.`,
    `Over the whole day of ${dateLabel(state.doy)}, for your window and orientation. Daylight: share of natural light kept.`
  );

  renderInsights();
}

function settingLabel() {
  switch (state.type) {
    case 'battants': return `${state.openAngle}°, ${state.louvered ? L('persiennés', 'louvred') : L('pleins', 'solid')}`;
    case 'accordeon': return L(`fermés à ${Math.round(state.deploy * 100)} %`, `${Math.round(state.deploy * 100)} % closed`);
    case 'roulant': return L(`baissé à ${Math.round(state.deploy * 100)} %`, `${Math.round(state.deploy * 100)} % lowered`);
    case 'bso': return L(`${Math.round(state.deploy * 100)} %, lames à ${state.slatAngle}°`, `${Math.round(state.deploy * 100)} %, slats at ${state.slatAngle}°`);
    case 'screen': return L(`${Math.round(state.deploy * 100)} %, toile ${state.openness} %`, `${Math.round(state.deploy * 100)} %, ${state.openness} % fabric`);
    case 'banne': return L(`avancée ${fmt(state.bannePro * state.deploy, 1)} m, ${state.banneAngle}°`, `${fmt(state.bannePro * state.deploy, 1)} m projection, ${state.banneAngle}°`);
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Valeurs instantanées
// ---------------------------------------------------------------------------

// Six indicateurs au même format, pour l'instant choisi comme pour la journée.
// Fc (facteur d'ombrage du dispositif) = gtot avec protection / gtot sans protection,
// pour la même fenêtre, le même tableau et le même soleil : 1 = sans effet, 0 = tout arrêté.
function renderKpis(el, d) {
  const gl = GLAZINGS[state.glazing];
  const pct = (v) => (v === null ? '—' : `${fmt(v * 100)}<small>%</small>`);
  const poro = porosity(configOf(state));
  el.innerHTML = `
    <div class="kpi hero">
      <div class="k-label">${d.heatLabel}</div>
      <div class="k-value">${d.heat}<small>${d.unit}</small></div>
      <div class="k-note">${L('sans protection :', 'without shading:')} <b>${d.heat0} ${d.unit}</b></div>
    </div>
    <div class="kpi">
      <div class="k-label">${L('Rayonnement arrêté', 'Radiation blocked')}</div>
      <div class="k-value">${pct(d.reduction)}</div>
      <div class="meter"><i style="width:${d.reduction === null ? 0 : Math.max(0, d.reduction * 100)}%"></i></div>
    </div>
    <div class="kpi">
      <div class="k-label">${L("Facteur d'ombrage F<sub>c</sub> du dispositif", 'Shading factor F<sub>c</sub> of the device')}</div>
      <div class="k-value">${d.reduction === null ? '—' : fmt(Math.max(0, 1 - d.reduction), 2)}</div>
      <div class="k-note">${L('g<sub>tot</sub> avec / g<sub>tot</sub> sans protection', 'g<sub>tot</sub> with / g<sub>tot</sub> without shading')}</div>
    </div>
    <div class="kpi">
      <div class="k-label">${L('Facteur solaire global g<sub>tot</sub>', 'Total solar energy transmittance g<sub>tot</sub>')}</div>
      <div class="k-value">${d.gtot === null ? '—' : fmt(d.gtot, 2)}</div>
      <div class="k-note">${L('vitrage seul :', 'glazing alone:')} <b>g = ${fmt(gl.g, 2)}</b></div>
    </div>
    <div class="kpi">
      <div class="k-label">${L('Lumière naturelle conservée', 'Daylight kept')}</div>
      <div class="k-value">${pct(d.light)}</div>
      <div class="k-note">${L('vue :', 'view:')} <b>${PROTECTIONS[state.type].view.toLowerCase()}</b></div>
    </div>
    <div class="kpi">
      <div class="k-label">${L('Porosité, vue de face', 'Porosity, seen face on')}</div>
      <div class="k-value">${pct(poro)}</div>
      <div class="k-note">${L('de la baie laissée libre pour la ventilation', 'of the opening left free for ventilation')}</div>
    </div>`;
}

// Surchauffe évitée en canicule : la chaleur solaire évitée sur une journée de canicule
// est rapportée à la capacité thermique de la pièce. Fourchette entre une hypothèse
// basse (inertie lourde, 40 % de la chaleur évacuée par ventilation et parois) et une
// hypothèse haute (inertie moyenne, 10 % évacuée). Ordre de grandeur, pas un calcul STD.
const CANICULE_DOY = 206; // 25 juillet
const INERTIA = { heavy: 260, medium: 165 }; // kJ/(m²·K) de plancher, classes NF EN ISO 13790
function heatwaveRise(avoidedWh, floor) {
  const cap = (kj) => (kj * floor) / 3.6; // Wh/K
  return {
    low: (avoidedWh * 0.6) / cap(INERTIA.heavy),
    high: (avoidedWh * 0.9) / cap(INERTIA.medium),
  };
}

// Graphes en direct sur la vue 3D (affichables / masquables, choix mémorisé)
let liveOn = true;
try { liveOn = localStorage.getItem('live3d') !== 'off'; } catch { /* stockage indisponible */ }
function applyLive() {
  $('live').hidden = !liveOn;
  $('liveToggle').setAttribute('aria-pressed', String(liveOn));
}
$('liveToggle').addEventListener('click', () => {
  liveOn = !liveOn;
  try { localStorage.setItem('live3d', liveOn ? 'on' : 'off'); } catch { /* stockage indisponible */ }
  applyLive();
  updateInstant(true);
});
applyLive();

// Sphère de masque solaire sur la vue 3D (affichable / masquable, choix mémorisé)
let maskOn = false; // toujours désactivée à l'arrivée sur la page : le dessin au trait reste lisible
function applyMaskToggle() {
  $('maskToggle').setAttribute('aria-pressed', String(maskOn));
  $('maskLegend3d').hidden = !(maskOn && state.view !== 'int');
  if (scene && maskData) scene.setMask(maskData.dome, state.facadeAz, maskOn);
}
$('maskToggle').addEventListener('click', () => {
  maskOn = !maskOn;
  applyMaskToggle();
});
applyMaskToggle();
$('maskLegend').innerHTML = maskLegendHTML();
$('maskScaleBar').style.background = maskGradient('0deg');

let lastSunPath = 0;
function updateInstant(force = false) {
  const sun = sunPosition(parisLocalToUTC(YEAR, state.doy, state.hour));
  const r = evaluate(model, sun, state.doy);
  const r0 = evaluate(ref, sun, state.doy);
  const area = state.W * state.H;
  const P = r.gain * area;
  const P0 = r0.gain * area;
  renderKpis($('kpis'), {
    heatLabel: L('Chaleur solaire entrant', 'Solar heat entering'),
    heat: fmt(P), heat0: fmt(P0), unit: 'W',
    reduction: P0 > 2 ? 1 - P / P0 : null,
    gtot: r.incident > 5 ? r.gain / r.incident : null,
    light: r0.light > 0.5 ? r.light / r0.light : null,
  });
  $('kpiNowLabel').textContent = `${dateLabel(state.doy)}, ${fmtHour(state.hour)}`;

  // Badge soleil
  const incidence = Math.acos(Math.min(1, r.cosT)) * 180 / Math.PI;
  let tag;
  if (sun.altitude <= 0) tag = `<span class="tag tag-night">${L('Soleil couché', 'Sun has set')}</span>`;
  else if (r.dirInc > 1) tag = `<span class="tag tag-sun">${L(`Soleil sur la façade · ${fmt(incidence)}° d'incidence`, `Sun on the façade · ${fmt(incidence)}° incidence`)}</span>`;
  else tag = `<span class="tag tag-shade">${L("Façade à l'ombre", 'Façade in shade')}</span>`;
  $('sunBadge').innerHTML = `
    <strong>${dateLabel(state.doy)} · ${fmtHour(state.hour)}</strong>
    ${L('Hauteur', 'Altitude')} ${fmt(Math.max(sun.altitude, -90), 1)}° · ${L('azimut', 'azimuth')} ${fmt(sun.azimuth)}°<br>
    ${L(`Façade : ${fmt(r.incident)} W/m² reçus`, `Façade: ${fmt(r.incident)} W/m² received`)}<br>${tag}`;

  if (scene) scene.setSun(sun, state.facadeAz);

  if (dayData) {
    renderDayChart($('dayChart'), {
      without: dayData.without, withP: dayData.withP, hour: state.hour, area,
      onPick: (h) => set({ hour: Math.round(h * 12) / 12 }),
    });
    if (liveOn) renderLiveDay($('liveDay'), { without: dayData.without, withP: dayData.withP, hour: state.hour, area });
  }

  const now = performance.now();
  if (force || !playing || now - lastSunPath > 200) {
    lastSunPath = now;
    renderSunPath($('sunPath'), { year: YEAR, doy: state.doy, hour: state.hour, sun, facadeAz: state.facadeAz, mask: maskData?.flat });
    if (liveOn) renderSunPath($('liveSun'), { year: YEAR, doy: state.doy, hour: state.hour, sun, facadeAz: state.facadeAz });
    const t = dayData ? dayData.times : sunTimes(YEAR, state.doy);
    $('sunFacts').innerHTML = `
      <div><span>${L('Lever', 'Sunrise')}</span><b>${t.rise === null ? '—' : fmtHour(t.rise)}</b></div>
      <div><span>${L('Midi solaire', 'Solar noon')}</span><b>${fmtHour(t.noon)}</b><span>${fmt(t.maxAlt, 1)}°</span></div>
      <div><span>${L('Coucher', 'Sunset')}</span><b>${t.set === null ? '—' : fmtHour(t.set)}</b></div>`;
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
  const names = LANG === 'en'
    ? ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
    : ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
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
const cap = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;

let lastInstant = null;
function renderInsights(instant) {
  if (instant) lastInstant = instant;
  const r = lastInstant;
  const items = [];
  const oc = orientClass(state.facadeAz);
  const on = orientationName(state.facadeAz);

  const orientText = {
    S: L(`Façade ${on} : en été le soleil de midi est haut (jusqu'à 65°) et frappe la vitre de biais ; une avancée horizontale l'arrête bien. En hiver, bas sur l'horizon, il entre profondément dans la pièce : un apport gratuit à conserver.`,
      `${cap(on)}-facing façade: in summer the noon sun is high (up to 65°) and strikes the glass at a slant; a horizontal overhang stops it well. In winter, low on the horizon, it reaches deep into the room: free gains worth keeping.`),
    O: L(`Façade ${on} : le soleil l'atteint l'après-midi, de plus en plus bas et de face, au moment où l'air est le plus chaud. C'est l'orientation la plus exposée à la surchauffe ; seule une protection verticale fermée à temps est efficace.`,
      `${cap(on)}-facing façade: the sun reaches it in the afternoon, lower and lower and head-on, when the air is hottest. It is the orientation most prone to overheating; only a vertical shading closed in time works.`),
    E: L(`Façade ${on} : le soleil la frappe le matin, bas et presque de face. Les apports arrivent tôt, quand l'air est encore frais, mais ils chargent la pièce pour la journée ; fermer avant que le soleil n'atteigne la vitre.`,
      `${cap(on)}-facing façade: the sun strikes it in the morning, low and almost head-on. Gains come early, while the air is still cool, but they load the room for the day; close before the sun reaches the glass.`),
    SE: L(`Façade ${on} : le soleil l'atteint toute la matinée et jusqu'au début d'après-midi. Il arrive d'abord bas et de face, puis haut et de biais : une protection réglable (BSO, screen) suit mieux cette course qu'une avancée fixe.`,
      `${cap(on)}-facing façade: the sun reaches it all morning and into the early afternoon, first low and head-on, then high and at a slant: an adjustable device (louvres, screen) follows this path better than a fixed overhang.`),
    SO: L(`Façade ${on} : elle reçoit le soleil de midi, haut, puis celui de l'après-midi, bas et de face, aux heures les plus chaudes. Une avancée ne suffit pas en fin de journée : il faut une protection verticale.`,
      `${cap(on)}-facing façade: it gets the high noon sun, then the low afternoon sun head-on, during the hottest hours. An overhang is not enough late in the day: vertical shading is needed.`),
    N: L(`Façade ${on} : peu de soleil direct, seulement tôt le matin ou tard le soir en été, et très rasant. L'essentiel des apports vient du ciel ; les protections servent surtout à l'occultation et à l'intimité.`,
      `${cap(on)}-facing façade: little direct sun, only early morning or late evening in summer, and very grazing. Most gains come from the sky; shading is mostly for blackout and privacy.`),
  };
  items.push(['compass', orientText[oc]]);

  if (r) {
    if (r.sky.dni <= 0) {
      items.push(['sun', L("Le soleil est couché : rouvrir les protections permet d'évacuer la chaleur accumulée (surventilation nocturne).", 'The sun has set: opening the shading again lets the stored heat out (night-time ventilation).')]);
    } else if (r.dirInc <= 1) {
      items.push(['sun', L('À cette heure, le soleil est derrière la façade : elle ne reçoit que le rayonnement diffus du ciel et celui réfléchi par le sol.', 'At this time the sun is behind the façade: it only receives diffuse radiation from the sky and light reflected by the ground.')]);
    } else {
      const inc = Math.acos(Math.min(1, r.cosT)) * 180 / Math.PI;
      const lit0 = r.sunlit > 0.02 ? fmt(evaluate(ref, sunPosition(parisLocalToUTC(YEAR, state.doy, state.hour)), state.doy).sunlit * 100) : null;
      items.push(['sun', L(
        `À cette heure, le soleil frappe la vitre sous ${fmt(inc)}° d'incidence et la façade reçoit ${fmt(r.incident)} W/m². ${lit0 ? `Sans protection, ${lit0} % du vitrage serait au soleil.` : ''}`,
        `At this time the sun strikes the glass at ${fmt(inc)}° incidence and the façade receives ${fmt(r.incident)} W/m². ${lit0 ? `Without shading, ${lit0} % of the glazing would be in sun.` : ''}`
      )]);
    }
  }

  if (monthData) {
    let im = 0;
    monthData.forEach((d, i) => { if (d.without > monthData[im].without) im = i; });
    const jun = monthData[5].without;
    const extra = oc === 'S' && monthData[im].without > jun * 1.1
      ? L(" Au sud, les apports sont plus forts au printemps et en automne qu'en juin : le soleil y est plus bas et frappe la vitre plus franchement.", ' Facing south, gains are higher in spring and autumn than in June: the sun is lower and strikes the glass more squarely.')
      : '';
    items.push(['cal', L(
      `Par ciel clair, cette fenêtre reçoit le plus d'énergie en ${MONTHS[im].replace('.', '')} (${fmt(monthData[im].without, 1)} kWh par jour sans protection).${extra}`,
      `On clear days, this window receives the most energy in ${MONTHS[im]} (${fmt(monthData[im].without, 1)} kWh per day without shading).${extra}`
    )]);
  }

  items.push(['tip', protectionTip(oc)]);

  $('insights').innerHTML = items
    .map(([ic, t]) => `<div class="insight"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[ic]}</svg><p>${t}</p></div>`)
    .join('');
  $('insightSub').textContent = L(`${PROTECTIONS[state.type].label}, façade ${on}`, `${PROTECTIONS[state.type].label}, ${on}-facing façade`);
}

function protectionTip(oc) {
  const t = state.type;
  if (t === 'none') return L(`Même sans protection, le tableau de ${Math.round(state.e * 100)} cm fait office de petit masque : il ombre le haut et les côtés du vitrage quand le soleil arrive de biais.`,
    `Even without shading, the ${Math.round(state.e * 100)} cm reveal acts as a small mask: it shades the top and sides of the glazing when the sun comes at a slant.`);
  if (t === 'banne' && (oc === 'E' || oc === 'O' || oc === 'N')) return L("Face au soleil bas de l'est ou de l'ouest, le store banne laisse passer l'essentiel du rayonnement sous la toile. Comparez avec un BSO ou un screen.",
    'Against the low eastern or western sun, the awning lets most of the radiation through under the fabric. Compare with louvres or a screen.');
  if (t === 'banne') return L("Au sud, le store banne coupe le soleil haut de midi. Plus il avance et s'incline, plus il protège tard dans la journée, au prix de la vue vers le ciel.",
    'Facing south, the awning cuts the high noon sun. The further it projects and slopes, the later in the day it protects, at the cost of the view of the sky.');
  if (t === 'battants' && state.openAngle >= 60 && state.openAngle <= 120) return L('Ouverts à angle droit, les vantaux deviennent des ailettes verticales : utiles quand le soleil arrive de biais, inutiles quand il est face à la fenêtre.',
    'Open at right angles, the leaves become vertical fins: useful when the sun comes at a slant, useless when it faces the window.');
  if (t === 'battants' && state.openAngle >= 150) return L("Rabattus contre la façade, les volets ne protègent plus rien : le résultat est celui d'une fenêtre nue.",
    'Folded back against the façade, the shutters no longer protect anything: the result is that of a bare window.');
  if (t === 'roulant' && state.deploy < 0.95) return L('Un volet roulant partiellement baissé ne protège que le haut du vitrage. Observez la tache de soleil au sol en vue intérieure : elle raccourcit mais persiste.',
    'A partly lowered roller shutter only protects the top of the glazing. Watch the sun patch on the floor in the interior view: it shrinks but remains.');
  if (t === 'roulant') return state.ajoure
    ? L('Les lames ajourées laissent filtrer un peu de lumière une fois le tablier en bas, sans laisser passer le soleil direct.', 'Perforated slats let a little light through once fully lowered, without letting direct sun in.')
    : L("Baissé, le volet roulant arrête presque tout, lumière comprise. Des lames ajourées ou un BSO préservent mieux l'éclairage naturel.", 'Lowered, the roller shutter stops almost everything, light included. Perforated slats or louvres keep daylight better.');
  if (t === 'bso' && state.slatAngle < 25) return L('Lames presque horizontales : le soleil haut est arrêté, mais le soleil bas passe entre les lames. Inclinez-les davantage quand le soleil descend.',
    'Nearly horizontal slats: the high sun is stopped, but the low sun passes between them. Tilt them further as the sun goes down.');
  if (t === 'bso') return L("Le BSO s'ajuste à la hauteur du soleil : il suffit de fermer les lames juste assez pour couper le rayonnement direct, et la lumière diffuse continue d'entrer.",
    'Louvres adapt to the sun height: closing the slats just enough to cut direct radiation keeps diffuse light coming in.');
  if (t === 'screen') return L(`Avec une toile à ${state.openness} %, on garde une vue voilée vers l'extérieur. Une toile foncée offre une meilleure vision au travers ; une toile claire renvoie plus de rayonnement.`,
    `With a ${state.openness} % fabric you keep a veiled view outside. A dark fabric gives better see-through; a light one reflects more radiation.`);
  if (t === 'accordeon' && state.deploy < 0.95) return L('Entrouverts, les volets pliants forment un zigzag dans le tableau : leurs feuilles obliques coupent une partie du soleil rasant, comme des ailettes.',
    'Half-open, folding shutters form a zigzag in the reveal: their slanted panels cut part of the grazing sun, like fins.');
  if (t === 'accordeon') return state.louvered
    ? L("Persiennés, les volets pliants bloquent le soleil direct tout en laissant passer l'air et un peu de lumière, comme des persiennes parisiennes.", 'Louvred folding shutters block direct sun while letting air and some light through, like Parisian persiennes.')
    : L('Pleins, les volets pliants occultent complètement : efficaces, mais la pièce reste dans le noir.', 'Solid folding shutters black out completely: effective, but the room stays dark.');
  if (state.color === 'fonce') return L("Une teinte foncée absorbe davantage : une petite partie de cette chaleur rejoint la vitre. À l'extérieur, l'effet reste modeste.",
    'A dark colour absorbs more: a small part of that heat reaches the glass. Outside, the effect stays modest.');
  return PROTECTIONS[t].text;
}

// ---------------------------------------------------------------------------
// Synchronisation des contrôles
// ---------------------------------------------------------------------------

function syncControls() {
  if ($('maskLegend3d')) $('maskLegend3d').hidden = !(maskOn && state.view !== 'int');
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
  $('deployLabel').textContent = DEPLOY_LABEL[state.type] || L('Déploiement', 'Extension');
  $('typeDesc').textContent = PROTECTIONS[state.type].text;
}

function dateLabel(doy) {
  return dayOfYearToDate(YEAR, doy).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Animation de la journée
// ---------------------------------------------------------------------------

let playing = false;
let raf = 0;
$('play').addEventListener('click', () => {
  playing = !playing;
  $('play').classList.toggle('is-playing', playing);
  $('play').setAttribute('aria-label', playing ? L('Mettre en pause', 'Pause') : L('Animer la journée', 'Play the day'));
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

const URL_KEYS = { ...Object.fromEntries(GEOMETRY_KEYS.map((k) => [k, k])), roomArea: 'roomArea', doy: 'doy', hour: 'hour', view: 'view' };

function writeURL() {
  const p = new URLSearchParams();
  for (const k of Object.keys(URL_KEYS)) p.set(k, String(state[k]));
  withLang(p);
  history.replaceState(null, '', `?${p.toString()}${location.hash}`);
}

function readURL() {
  const p = new URLSearchParams(location.search);
  const d = defaultConfig();
  for (const k of [...GEOMETRY_KEYS_INIT(), 'roomArea', 'doy', 'hour', 'view']) {
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
// Export PDF de la fiche protection
// ---------------------------------------------------------------------------

$('exportPdf').addEventListener('click', (evt) => exportSheet(evt.altKey));

// Alt + clic, ou l'adresse se terminant par #fiche : aperçu de la fiche à l'écran, sans imprimer
function exportSheet(preview = false) {
  // Les blocs différés (bilan mensuel, comparatif, canicule) doivent être à jour
  clearTimeout(slowTimer);
  recomputeSlow();
  const p = PROTECTIONS[state.type];
  const gl = GLAZINGS[state.glazing];
  const on = orientationName(state.facadeAz);
  exportReport({
    scene,
    preview,
    title: p.label,
    setting: state.type === 'none' ? L('fenêtre sans protection', 'window without shading') : settingLabel(),
    summary: p.text,
    rows: [
      [L('Façade', 'Façade'), L(`${cap(on)} (azimut ${state.facadeAz}°), Paris`, `${cap(on)} (azimuth ${state.facadeAz}°), Paris`)],
      [L('Fenêtre', 'Window'), L(`${fmt(state.W, 2)} × ${fmt(state.H, 2)} m, tableau de ${Math.round(state.e * 100)} cm`, `${fmt(state.W, 2)} × ${fmt(state.H, 2)} m, ${Math.round(state.e * 100)} cm reveal`)],
      [L('Vitrage', 'Glazing'), `${gl.label}, g = ${fmt(gl.g, 2)}`],
      [L('Protection', 'Shading'), state.type === 'none' ? L('aucune', 'none') : `${p.label.toLowerCase()}, ${settingLabel()}, ${L('teinte', 'colour')} ${COLORS[state.color].label.toLowerCase()}`],
      [L('Simulation', 'Simulation'), L(`${dateLabel(state.doy)} à ${fmtHour(state.hour)}, ciel clair`, `${dateLabel(state.doy)} at ${fmtHour(state.hour)}, clear sky`)],
      [L('Pièce', 'Room'), L(`${fmt(state.roomArea)} m² (estimation de surchauffe)`, `${fmt(state.roomArea)} m² (overheating estimate)`)],
    ],
  });
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
if (location.hash === '#fiche') exportSheet(true);
