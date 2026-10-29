// Onglet « Masque urbain » : la rue en coupe, l'ombre de l'immeuble d'en face,
// et ce qu'elle retire à une fenêtre selon l'étage, la saison et l'orientation.

import { sunPosition, parisLocalToUTC, sunTimes, dayOfYearToDate, isSummerTime } from './solar.js';
import {
  FLOOR, defaultStreet, windowOf, obstructionAngle, skyView, shadowHeight,
  evaluateStreet, streetDay, streetMaskGrid,
} from './street.js';
import { renderSunPath, renderMonthChart, maskLegendHTML, fmtHour, fmt, MONTHS } from './charts.js';

const YEAR = new Date().getFullYear();
const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// État (conservé dans l'URL, comme l'onglet Protections)
// ---------------------------------------------------------------------------

const state = { ...defaultStreet(), doy: 80, hour: 13 };
{
  const p = new URLSearchParams(location.search);
  for (const k of Object.keys(state)) {
    const n = parseFloat(p.get(k));
    if (p.has(k) && Number.isFinite(n)) state[k] = n;
  }
  state.doy = Math.max(1, Math.min(365, Math.round(state.doy)));
}

const ORIENTS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SO', 225], ['O', 270], ['NO', 315]];

function floorName(n) {
  if (n === 0) return 'rez-de-chaussée';
  return n === 1 ? '1er étage' : `${n}e étage`;
}
function floorShort(n) {
  if (n === 0) return 'RDC';
  return n === 1 ? '1er' : `${n}e`;
}
function maxFloor() {
  return Math.max(0, Math.floor(state.hOwn / FLOOR) - 1);
}
function orientationName(az) {
  const names = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  return names[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}
function dateLabel(doy) {
  return dayOfYearToDate(YEAR, doy).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
function durationLabel(h) {
  if (h < 0.05) return '0 h';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (hh === 0) return `${mm} min`;
  return mm ? `${hh} h ${String(mm).padStart(2, '0')}` : `${hh} h`;
}

// ---------------------------------------------------------------------------
// Contrôles
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

const sliders = {
  facadeAz: (v) => `${v}°`,
  width: (v) => `${fmt(v, 1)} m`,
  hOpp: (v) => `${fmt(v, 1)} m`,
  hOwn: (v) => `${fmt(v, 1)} m`,
  floor: (v) => floorName(v),
};
for (const id of Object.keys(sliders)) {
  $(id).addEventListener('input', (e) => set({ [id]: parseFloat(e.target.value) }));
}
$('hour').addEventListener('input', (e) => set({ hour: parseFloat(e.target.value) }));
$('doy').addEventListener('input', (e) => set({ doy: parseInt(e.target.value, 10) }));
$('presets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) set({ doy: parseInt(b.dataset.doy, 10) });
});
$('streetPresets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) set({ width: parseFloat(b.dataset.w), hOpp: parseFloat(b.dataset.h) });
});
$('maskLegend').innerHTML = maskLegendHTML().replace('Part du vitrage au soleil', 'Part de la fenêtre au soleil');

// ---------------------------------------------------------------------------
// Mise à jour
// ---------------------------------------------------------------------------

let dayData = null;
let mask = null;

function set(patch) {
  const prev = { ...state };
  Object.assign(state, patch);
  state.floor = Math.min(state.floor, maxFloor());
  const changed = (keys) => keys.some((k) => prev[k] !== state[k]);
  syncControls();
  if (changed(['facadeAz', 'width', 'hOpp', 'hOwn', 'floor'])) mask = null;
  if (changed(['facadeAz', 'width', 'hOpp', 'hOwn', 'floor', 'doy']) || !dayData) recomputeDay();
  if (changed(['facadeAz', 'width', 'hOpp', 'hOwn', 'floor'])) scheduleSlow();
  updateInstant();
  const p = new URLSearchParams();
  for (const k of Object.keys(state)) p.set(k, String(state[k]));
  history.replaceState(null, '', `?${p.toString()}${location.hash}`);
}

function syncControls() {
  $('floor').max = maxFloor();
  for (const [id, f] of Object.entries(sliders)) {
    $(id).value = state[id];
    $(`${id}Out`).textContent = f(state[id]);
  }
  $('hour').value = state.hour;
  $('hourOut').textContent = `${fmtHour(state.hour)} (${isSummerTime(YEAR, state.doy) ? 'UTC+2' : 'UTC+1'})`;
  $('doy').value = state.doy;
  $('doyOut').textContent = dateLabel(state.doy);
  for (const b of rose.querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.az === state.facadeAz));
  needle.style.transform = `rotate(${state.facadeAz - 180}deg)`;
  for (const b of $('presets').querySelectorAll('button')) b.setAttribute('aria-pressed', String(+b.dataset.doy === state.doy));
  for (const b of $('streetPresets').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(+b.dataset.w === state.width && +b.dataset.h === state.hOpp));
  }
}

function recomputeDay() {
  dayData = streetDay(state, YEAR, state.doy);
  dayData.times = sunTimes(YEAR, state.doy);
  const t = dayData.times;
  if (t.rise !== null && t.set !== null) {
    const r = (t.rise / 24) * 100;
    const s = (t.set / 24) * 100;
    $('hour').style.setProperty('--day-gradient',
      `linear-gradient(90deg, #8796b3 0%, #8796b3 ${r - 1.5}%, #ff9f1c ${r + 1}%, #ffca7d ${(r + s) / 2}%, #ff9f1c ${s - 1}%, #8796b3 ${s + 1.5}%, #8796b3 100%)`);
  }
  const { zc } = windowOf(state.floor);
  const alpha = obstructionAngle(state, zc);
  kpis($('kpisDay'), [
    { hero: true, label: 'Soleil direct sur la fenêtre', value: durationLabel(dayData.h1), note: `façade dégagée : <b>${durationLabel(dayData.h0)}</b>` },
    { label: 'Énergie solaire reçue', value: fmt(dayData.e1), unit: 'Wh/m²', note: `façade dégagée : <b>${fmt(dayData.e0)} Wh/m²</b>` },
    { label: 'Énergie retirée par le vis-à-vis', value: dayData.e0 > 1 ? fmt((1 - dayData.e1 / dayData.e0) * 100) : '—', unit: '%', meter: dayData.e0 > 1 ? 1 - dayData.e1 / dayData.e0 : 0 },
    { label: "Angle d'obstruction", value: alpha > 0 ? fmt(alpha) : '0', unit: '°', note: 'vu du milieu de la fenêtre' },
    { label: 'Ciel visible', value: fmt(skyView(state, zc) * 100), unit: '%', note: 'par rapport à une façade dégagée' },
    { label: 'Rapport H / L', value: fmt(state.hOpp / state.width, 2), note: 'hauteur en face / largeur de rue' },
  ]);
  $('kpiDayLabel').textContent = `${dateLabel(state.doy)}, ciel clair, ${floorName(state.floor)}`;
}

let slowTimer = null;
function scheduleSlow() {
  clearTimeout(slowTimer);
  slowTimer = setTimeout(recomputeSlow, 100);
}

function recomputeSlow() {
  mask = streetMaskGrid(state, 5);
  // Au fil de l'année
  const data = [];
  for (let mo = 0; mo < 12; mo++) {
    const doy = Math.round((Date.UTC(YEAR, mo, 21) - Date.UTC(YEAR, 0, 0)) / 86400e3);
    const d = streetDay(state, YEAR, doy, state.floor, 15);
    data.push({ without: d.h0, withP: d.h1, e0: d.e0, e1: d.e1 });
  }
  const curMonth = dayOfYearToDate(YEAR, state.doy).getUTCMonth();
  renderMonthChart($('monthChart'), {
    data, currentMonth: curMonth, unit: 'h', axisLabel: 'heures / jour', yMax: 16,
    labels: ['Façade dégagée', "Avec l'immeuble d'en face"],
    note: (d) => `Énergie reçue : ${fmt(d.e1)} Wh/m² (dégagée : ${fmt(d.e0)})`,
  });
  renderFloors();
  renderInsights(data);
  updateInstant(true);
}

// Étage par étage : heures de soleil le jour choisi, et ciel visible
function renderFloors() {
  const rows = [];
  for (let n = maxFloor(); n >= 0; n--) {
    const d = streetDay(state, YEAR, state.doy, n);
    rows.push({ n, h0: d.h0, h1: d.h1, sv: skyView(state, windowOf(n).zc) });
  }
  const hMax = Math.max(0.5, ...rows.map((r) => r.h0));
  $('floors').innerHTML = `<div class="floors">${rows.map((r) => `
    <button type="button" class="floor-row${r.n === state.floor ? ' is-current' : ''}" data-n="${r.n}">
      <span class="floor-name">${floorShort(r.n)}</span>
      <span class="floor-bar"><i class="fb-0" style="width:${(r.h0 / hMax) * 100}%"></i><i class="fb-1" style="width:${(r.h1 / hMax) * 100}%"></i></span>
      <span class="floor-h">${durationLabel(r.h1)}</span>
      <span class="floor-sky">${fmt(r.sv * 100)} %</span>
    </button>`).join('')}
    <div class="floor-row floor-head" aria-hidden="true"><span></span><span>Soleil direct sur la fenêtre</span><span>avec</span><span>ciel</span></div>
  </div>`;
  for (const b of $('floors').querySelectorAll('button')) b.addEventListener('click', () => set({ floor: +b.dataset.n }));
  $('floorsSub').textContent = `${dateLabel(state.doy)}, ciel clair. Barre claire : façade dégagée ; barre foncée : avec l'immeuble d'en face. Cliquer un étage pour l'observer.`;
}

function kpis(el, items) {
  el.innerHTML = items.map((k) => `
    <div class="kpi${k.hero ? ' hero' : ''}">
      <div class="k-label">${k.label}</div>
      <div class="k-value">${k.value}${k.unit ? `<small>${k.unit}</small>` : ''}</div>
      ${k.meter !== undefined ? `<div class="meter"><i style="width:${Math.max(0, Math.min(1, k.meter)) * 100}%"></i></div>` : ''}
      ${k.note ? `<div class="k-note">${k.note}</div>` : ''}
    </div>`).join('');
}

// ---------------------------------------------------------------------------
// Instant : coupe, indicateurs, diagramme
// ---------------------------------------------------------------------------

let lastPolar = 0;
function updateInstant(force = false) {
  const sun = sunPosition(parisLocalToUTC(YEAR, state.doy, state.hour));
  const r = evaluateStreet(state, sun, state.doy);
  drawStreet($('streetView'), state, sun, r);

  const hs = r.prof ? shadowHeight(state, r.prof) : null;
  let shadowNote;
  if (sun.altitude <= 0) shadowNote = 'soleil couché';
  else if (!r.prof) shadowNote = 'soleil derrière la façade';
  else if (hs <= 0) shadowNote = "pas d'ombre sur la façade";
  else shadowNote = `ombre portée jusqu'à <b>${fmt(hs, 1)} m</b>`;
  kpis($('kpisNow'), [
    { hero: true, label: 'Fenêtre au soleil', value: fmt(r.lit * 100), unit: '%', note: shadowNote },
    { label: 'Rayonnement reçu', value: fmt(r.withMask), unit: 'W/m²', note: `façade dégagée : <b>${fmt(r.without)} W/m²</b>` },
    { label: 'Angle de profil du soleil', value: r.prof ? fmt(r.prof.deg) : '—', unit: r.prof ? '°' : '', note: `à comparer à l'angle d'obstruction : <b>${fmt(Math.max(0, obstructionAngle(state, windowOf(state.floor).zc)))}°</b>` },
  ]);
  $('kpiNowLabel').textContent = `${dateLabel(state.doy)}, ${fmtHour(state.hour)}`;

  const now = performance.now();
  if (mask && (force || !playing || now - lastPolar > 200)) {
    lastPolar = now;
    renderSunPath($('sunPath'), { year: YEAR, doy: state.doy, hour: state.hour, sun, facadeAz: state.facadeAz, mask });
  }
}

/** Coupe de rue dessinée au trait, avec l'ombre et le rayon de soleil de l'instant. */
function drawStreet(container, cfg, sun, r) {
  const W = 900;
  const H = 540;
  const depth = 5; // profondeur de bâtiment dessinée (m)
  const hMax = Math.max(cfg.hOwn, cfg.hOpp, 6);
  const k = Math.min((W - 120) / (2 * depth + cfg.width), (H - 110) / (hMax * 1.18));
  const xf = (W - (2 * depth + cfg.width) * k) / 2 + depth * k; // nu de notre façade
  const yg = H - 64; // sol
  const X = (x) => xf + x * k;
  const Y = (y) => yg - y * k;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'street-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Coupe de la rue avec l\'ombre de l\'immeuble d\'en face');
  const add = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v);
    if (text !== undefined) e.textContent = text;
    svg.appendChild(e);
    return e;
  };
  svg.innerHTML = `<defs>
    <pattern id="st-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" class="st-hatch-line"/></pattern>
    <marker id="st-tick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M2 8 L8 2" class="st-tick"/></marker>
  </defs>`;

  const { zb, zt, zc } = windowOf(cfg.floor);
  const prof = r.prof;
  const hs = prof ? shadowHeight(cfg, prof) : null;

  // Sol et sous-sol hachuré
  add('rect', { x: 0, y: yg, width: W, height: 16, fill: 'url(#st-hatch)', class: 'st-ground' });
  add('line', { x1: 0, y1: yg, x2: W, y2: yg, class: 'st-line' });

  // Ombre portée sur la chaussée (de l'immeuble d'en face vers nous)
  if (prof) {
    const len = cfg.hOpp / prof.tan;
    const x0 = Math.max(0, cfg.width - len);
    if (cfg.hOpp > 0) add('rect', { x: X(x0), y: yg - 5, width: X(cfg.width) - X(x0), height: 5, class: 'st-shade' });
  }

  // Immeubles
  const building = (x0, x1, h, label) => {
    add('rect', { x: X(x0), y: Y(h), width: X(x1) - X(x0), height: Y(0) - Y(h), class: 'st-building' });
    for (let y = FLOOR; y < h - 0.01; y += FLOOR) add('line', { x1: X(x0), x2: X(x1), y1: Y(y), y2: Y(y), class: 'st-floor' });
    if (h > 2) add('text', { x: (X(x0) + X(x1)) / 2, y: Y(h) - 8, 'text-anchor': 'middle', class: 'st-label' }, label);
  };
  building(-depth, 0, cfg.hOwn, 'notre immeuble');
  if (cfg.hOpp > 0) building(cfg.width, cfg.width + depth, cfg.hOpp, 'en face');

  // Ombre portée sur notre façade
  if (prof && hs > 0) {
    const top = Math.min(hs, cfg.hOwn);
    add('rect', { x: X(0), y: Y(top), width: 0.45 * k, height: Y(0) - Y(top), class: 'st-shade' });
  }

  // Fenêtres de notre façade ; la fenêtre étudiée est remplie selon sa part au soleil
  for (let n = 0; n <= maxFloor(); n++) {
    const w = windowOf(n);
    const cur = n === cfg.floor;
    add('rect', { x: X(-0.3), y: Y(w.zt), width: 0.3 * k, height: Y(w.zb) - Y(w.zt), class: cur ? 'st-win st-win-cur' : 'st-win' });
    if (cur && r.lit > 0) {
      const litTop = w.zt;
      const litBot = w.zt - r.lit * (w.zt - w.zb);
      add('rect', { x: X(-0.3), y: Y(litTop), width: 0.3 * k, height: Y(litBot) - Y(litTop), class: 'st-win-lit' });
    }
  }
  add('text', { x: X(-depth) - 8, y: Y(zc) + 4, 'text-anchor': 'end', class: 'st-cote-text' }, floorShort(cfg.floor));
  add('line', { x1: X(-depth) - 4, x2: X(-0.3), y1: Y(zc), y2: Y(zc), class: 'st-guide' });

  // Angle d'obstruction depuis le milieu de la fenêtre
  const alpha = obstructionAngle(cfg, zc);
  if (cfg.hOpp > zc) {
    add('line', { x1: X(0), y1: Y(zc), x2: X(cfg.width), y2: Y(cfg.hOpp), class: 'st-obst' });
    add('line', { x1: X(0), y1: Y(zc), x2: X(Math.min(cfg.width, 8)), y2: Y(zc), class: 'st-guide' });
    const rad = Math.min(70, cfg.width * k * 0.45);
    const a = (alpha * Math.PI) / 180;
    add('path', { d: `M${X(0) + rad},${Y(zc)} A${rad},${rad} 0 0 0 ${X(0) + rad * Math.cos(a)},${Y(zc) - rad * Math.sin(a)}`, class: 'st-arc' });
    add('text', { x: X(0) + rad + 8, y: Y(zc) - rad * Math.sin(a / 2) + 4, class: 'st-angle' }, `α ${fmt(alpha)}°`);
  }

  // Soleil et rayon dans la coupe
  if (prof && sun.altitude > 0) {
    const c = Math.cos(Math.atan(prof.tan));
    const s = Math.sin(Math.atan(prof.tan));
    // rayon rasant le haut de l'immeuble d'en face
    const ox = cfg.width;
    const oy = cfg.hOpp;
    let hx;
    let hy;
    if (cfg.hOpp > 0 && hs > 0) { hx = 0; hy = Math.min(hs, cfg.hOwn); } else { hx = Math.max(0, cfg.width - cfg.hOpp / prof.tan); hy = 0; }
    const far = 1.6 * (cfg.width + depth);
    const sx = ox + far * c;
    const sy = oy + far * s;
    // borne le soleil dans le dessin
    const t = Math.min(1, (W - 40 - X(ox)) / Math.max(1, X(sx) - X(ox)), (Y(oy) - 30) / Math.max(1, Y(oy) - Y(sy)));
    const px = ox + (sx - ox) * t;
    const py = oy + (sy - oy) * t;
    if (cfg.hOpp > 0) add('line', { x1: X(px), y1: Y(py), x2: X(hx), y2: Y(hy), class: 'st-ray' });
    // rayon vers le milieu de la fenêtre, s'il l'atteint
    if (r.lit > 0) {
      add('line', { x1: X(0), y1: Y(zc), x2: X(0 + (py - zc) / prof.tan), y2: Y(py), class: 'st-ray st-ray-lit' });
    }
    const g = add('g', { transform: `translate(${X(px)},${Y(py)})`, class: 'st-sun' });
    g.innerHTML = `<circle r="13"/>${Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return `<line x1="${Math.cos(a) * 18}" y1="${Math.sin(a) * 18}" x2="${Math.cos(a) * 25}" y2="${Math.sin(a) * 25}"/>`;
    }).join('')}`;
    add('text', { x: X(px) - 30, y: Y(py) + 4, 'text-anchor': 'end', class: 'st-angle' }, `φ ${fmt(prof.deg)}°`);
  } else {
    add('text', { x: W - 24, y: 30, 'text-anchor': 'end', class: 'st-note' }, sun.altitude <= 0 ? 'Soleil couché' : 'Soleil derrière la façade : pas de soleil direct');
  }

  // Cotes : largeur de rue et hauteur d'en face
  const yc = yg + 34;
  add('line', { x1: X(0), x2: X(cfg.width), y1: yc, y2: yc, class: 'st-cote', 'marker-start': 'url(#st-tick)', 'marker-end': 'url(#st-tick)' });
  add('text', { x: (X(0) + X(cfg.width)) / 2, y: yc - 6, 'text-anchor': 'middle', class: 'st-cote-text' }, `L ${fmt(cfg.width, 1)} m`);
  if (cfg.hOpp > 0) {
    const xc = X(cfg.width + depth) + 22;
    add('line', { x1: xc, x2: xc, y1: Y(0), y2: Y(cfg.hOpp), class: 'st-cote', 'marker-start': 'url(#st-tick)', 'marker-end': 'url(#st-tick)' });
    add('text', { x: xc + 8, y: (Y(0) + Y(cfg.hOpp)) / 2, class: 'st-cote-text', transform: `rotate(-90 ${xc + 8} ${(Y(0) + Y(cfg.hOpp)) / 2})`, 'text-anchor': 'middle', dy: '10' }, `H ${fmt(cfg.hOpp, 1)} m`);
  }
  add('text', { x: 20, y: 28, class: 'st-note' }, `Coupe perpendiculaire à la façade ${orientationName(cfg.facadeAz)}`);

  container.innerHTML = '';
  container.appendChild(svg);
}

// ---------------------------------------------------------------------------
// À retenir
// ---------------------------------------------------------------------------

const IC = {
  street: '<path d="M4 21V8l5-3v16M15 21V3l5 3v15M9 21h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  up: '<path d="M12 20V4M6 10l6-6 6 6"/>',
};

function renderInsights() {
  const items = [];
  const { zc } = windowOf(state.floor);
  const alpha = obstructionAngle(state, zc);
  const ratio = state.hOpp / state.width;
  items.push(['street', state.hOpp <= zc
    ? `Au ${floorName(state.floor)}, la fenêtre est plus haute que l'immeuble d'en face : il ne masque plus le ciel.`
    : `Rapport H/L de ${fmt(ratio, 2)} : depuis le ${floorName(state.floor)}, le haut de l'immeuble d'en face est vu à ${fmt(alpha)}° au-dessus de l'horizontale. ${alpha > 45 ? "C'est une rue très encaissée : la fenêtre voit surtout la façade d'en face." : alpha > 25 ? "Le ciel bas est caché : le soleil d'hiver passe presque toujours derrière les toits d'en face." : 'Le masque reste modéré.'}`]);

  const winter = streetDay(state, YEAR, 355, state.floor);
  let firstLit = null;
  for (let n = 0; n <= maxFloor(); n++) {
    if (streetDay(state, YEAR, 355, n).h1 >= 1) { firstLit = n; break; }
  }
  if (winter.h0 < 0.1) {
    items.push(['cal', `Le 21 décembre, cette façade ${orientationName(state.facadeAz)} ne voit pas le soleil direct, même dégagée.`]);
  } else if (winter.h1 < 0.1) {
    items.push(['cal', `Le 21 décembre, la fenêtre ne reçoit jamais le soleil direct (${durationLabel(winter.h0)} si la façade était dégagée). ${firstLit !== null ? `Il faut monter au ${floorName(firstLit)} pour en profiter au moins une heure.` : "Aucun étage de l'immeuble n'en profite une heure entière."}`]);
  } else {
    items.push(['cal', `Le 21 décembre, la fenêtre reçoit ${durationLabel(winter.h1)} de soleil direct, contre ${durationLabel(winter.h0)} si la façade était dégagée.`]);
  }

  const summer = streetDay(state, YEAR, 202, state.floor);
  if (summer.e0 > 1) {
    const loss = 1 - summer.e1 / summer.e0;
    items.push(['sun', `Le 21 juillet, l'immeuble d'en face retire ${fmt(loss * 100)} % du rayonnement reçu par la fenêtre. ${loss > 0.3 ? "Il joue ici le rôle d'une vraie protection solaire d'été." : "En été, le soleil passe surtout au-dessus des toits d'en face : une protection reste nécessaire."}`]);
  }
  if (state.floor < maxFloor()) {
    const top = streetDay(state, YEAR, state.doy, maxFloor());
    items.push(['up', `Au dernier étage (${floorName(maxFloor())}), la même fenêtre recevrait ${durationLabel(top.h1)} de soleil direct le ${dateLabel(state.doy)}, contre ${durationLabel(dayData.h1)} ici.`]);
  }
  $('insights').innerHTML = items
    .map(([ic, t]) => `<div class="insight"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[ic]}</svg><p>${t}</p></div>`)
    .join('');
  $('insightSub').textContent = `Façade ${orientationName(state.facadeAz)}, rue de ${fmt(state.width, 1)} m, ${floorName(state.floor)}`;
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
  if (!playing) { cancelAnimationFrame(raf); updateInstant(true); return; }
  const t = dayData.times;
  if (t.set !== null && (state.hour >= t.set || state.hour < (t.rise ?? 0) - 0.5)) state.hour = Math.max(0, (t.rise ?? 5) - 0.5);
  let last = performance.now();
  const step = (now) => {
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    let h = state.hour + dt * 1.6;
    if (h > (dayData.times.set ?? 22) + 0.5) h = Math.max(0, (dayData.times.rise ?? 5) - 0.5);
    state.hour = h;
    $('hour').value = h;
    $('hourOut').textContent = `${fmtHour(h)} (${isSummerTime(YEAR, state.doy) ? 'UTC+2' : 'UTC+1'})`;
    updateInstant();
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

syncControls();
recomputeDay();
recomputeSlow();
