// Onglet « Masque urbain » : la rue en coupe, l'ombre de l'immeuble d'en face,
// et ce qu'elle retire à une fenêtre selon l'étage, la saison et l'orientation.

import { sunPosition, parisLocalToUTC, sunTimes, dayOfYearToDate, isSummerTime } from './solar.js';
import {
  FLOOR, defaultStreet, windowOf, obstructionAngle, skyView, shadowHeight, sunlitFraction,
  evaluateStreet, streetDay, streetMaskGrid, facingRanges,
} from './street.js';
import { renderSunPath, renderMonthChart, maskLegendHTML, fmtHour, fmt, MONTHS } from './charts.js';
import { sunVectorLocal } from './shading.js';

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
  dayData.ranges = facingRanges(state.facadeAz, YEAR, state.doy);
  kpis($('kpisDay'), [
    { hero: true, label: 'Soleil direct sur la fenêtre', value: durationLabel(dayData.h1), note: `sur <b>${durationLabel(dayData.h0)}</b> de soleil face à la façade` },
    { label: 'Énergie solaire reçue', value: fmt(dayData.e1), unit: 'Wh/m²', note: `façade dégagée : <b>${fmt(dayData.e0)} Wh/m²</b>` },
    { label: 'Énergie retirée par le vis-à-vis', value: dayData.e0 > 1 ? fmt((1 - dayData.e1 / dayData.e0) * 100) : '—', unit: '%', meter: dayData.e0 > 1 ? 1 - dayData.e1 / dayData.e0 : 0 },
    { label: "Angle d'obstruction", value: alpha > 0 ? fmt(alpha) : '0', unit: '°', note: 'vu du milieu de la fenêtre' },
    { label: 'Ciel visible', value: fmt(skyView(state, zc) * 100), unit: '%', note: 'par rapport à une façade dégagée' },
    { label: 'Rapport H / L', value: fmt(state.hOpp / state.width, 2), note: 'hauteur en face / largeur de rue' },
  ]);
  $('kpiDayLabel').textContent = dayData.ranges.length
    ? `${dateLabel(state.doy)}, ${rangesLabel(dayData.ranges)}, ciel clair, ${floorName(state.floor)}`
    : `${dateLabel(state.doy)} : le soleil ne passe pas devant cette façade`;
  renderRanges();
}

function rangesLabel(ranges) {
  return ranges.map(([a, b]) => `de ${fmtHour(a)} à ${fmtHour(b)}`).join(' et ');
}

// Plages horaires où le soleil fait face à chaque orientation, pour le jour choisi.
// L'orientation étudiée est en noir ; les autres en gris, pour comparer.
const RANGE_AXIS = [4, 22];
// Position du repère « maintenant » : colonnes de 40 px + 12 px à gauche, 190 px + 12 px à droite
function nowLeft(h) {
  const p = (Math.max(RANGE_AXIS[0], Math.min(RANGE_AXIS[1], h)) - RANGE_AXIS[0]) / (RANGE_AXIS[1] - RANGE_AXIS[0]);
  return `calc(52px + (100% - 254px) * ${p.toFixed(4)})`;
}
function renderRanges() {
  const [h0, h1] = RANGE_AXIS;
  const pos = (h) => ((Math.max(h0, Math.min(h1, h)) - h0) / (h1 - h0)) * 100;
  const cur = ((Math.round(state.facadeAz / 45) * 45) % 360 + 360) % 360;
  const rows = ORIENTS.map(([label, az]) => {
    const rs = facingRanges(az, YEAR, state.doy);
    const isCur = az === cur;
    const bars = rs.map(([a, b]) => `<i style="left:${pos(a)}%;width:${pos(b) - pos(a)}%"></i>`).join('');
    const txt = rs.length ? rs.map(([a, b]) => `${fmtHour(a)} → ${fmtHour(b)}`).join(' · ') : '—';
    return `<div class="rg-row${isCur ? ' is-current' : ''}">
      <span class="rg-name">${label}</span>
      <span class="rg-track">${bars}</span>
      <span class="rg-txt">${txt}</span>
    </div>`;
  }).join('');
  const ticks = [6, 9, 12, 15, 18, 21].map((h) => `<span style="left:${pos(h)}%">${h} h</span>`).join('');
  $('ranges').innerHTML = `<div class="ranges">
    ${rows}
    <div class="rg-row rg-axis"><span></span><span class="rg-track rg-ticks">${ticks}</span><span></span></div>
    <b class="rg-now" style="left:${nowLeft(state.hour)}"></b>
  </div>`;
  const exact = state.facadeAz % 45 === 0;
  $('rangesSub').textContent = `${dateLabel(state.doy)}. Barres : heures pendant lesquelles le soleil est levé et devant une façade de cette orientation. En noir, l'orientation la plus proche de la façade étudiée${exact ? '' : ` (${state.facadeAz}°)`}.`;
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
  $('kpiNowLabel').textContent = `${dateLabel(state.doy)}, ${fmtHour(state.hour)}, ${floorName(state.floor)}`;
  const now0 = document.querySelector('#ranges .rg-now');
  if (now0) now0.style.left = nowLeft(state.hour);

  const now = performance.now();
  if (mask && (force || now - lastPolar > 120)) {
    lastPolar = now;
    renderSunPath($('sunPath'), { year: YEAR, doy: state.doy, hour: state.hour, sun, facadeAz: state.facadeAz, mask });
  }
}

/**
 * Coupe de rue, dans l'esprit des schémas de « canyon urbain » : bâtiments hachurés,
 * faisceau de rayons parallèles, ombre portée grisée. Le soleil se déplace uniquement
 * dans le plan de la coupe (angle de profil) ; il est dessiné en tirets quand il n'éclaire
 * pas la façade (derrière elle ou sous l'horizon). À droite : le masque en plan.
 */
const SEC_W = 660; // largeur réservée à la coupe dans le dessin
function drawStreet(container, cfg, sun, r) {
  const W = 900;
  const H = 540;
  const depth = 5; // profondeur de bâtiment dessinée (m)
  const hMax = Math.max(cfg.hOwn, cfg.hOpp, 6);
  const k = Math.min((SEC_W - 90) / (2 * depth + cfg.width), (H - 130) / (hMax * 1.3));
  const xf = 40 + depth * k; // nu de notre façade
  const yg = H - 70; // sol
  const X = (x) => xf + x * k;
  const Y = (y) => yg - y * k;
  const { zb, zt, zc } = windowOf(cfg.floor);
  const s = r.s;
  const relevant = sun.altitude > 0 && s.z > 0;
  const prof = r.prof;
  const parts = [];
  const add = (html) => parts.push(html);
  const uid = `st${Math.random().toString(36).slice(2, 7)}`;

  // Angle du soleil dans le plan de coupe (0° : horizontal côté rue, 180° : côté arrière)
  let phi = (Math.atan2(s.y, s.z) * 180) / Math.PI;
  if (sun.altitude <= 0) phi = s.z >= 0 ? 0 : 180;
  phi = Math.max(0, Math.min(180, phi));
  const pr = (phi * Math.PI) / 180;

  // Rayons et ombre, uniquement quand le soleil éclaire la façade
  const top = hMax * 1.18;
  if (relevant && prof) {
    const t = prof.tan;
    const yLine = (x) => cfg.hOpp - (cfg.width - x) * t; // rayon rasant le toit d'en face
    const xg = cfg.width - cfg.hOpp / t; // où ce rayon touche la chaussée
    const lit = [[0, top], [cfg.width + depth, top], [cfg.width + depth, cfg.hOpp], [cfg.width, cfg.hOpp]];
    const shade = [[cfg.width, cfg.hOpp], [cfg.width, 0]];
    if (yLine(0) >= 0) {
      lit.push([0, Math.min(top, yLine(0))]);
      shade.push([0, 0], [0, Math.min(cfg.hOwn, yLine(0))]);
    } else {
      lit.push([Math.max(0, xg), 0], [0, 0]);
      shade.push([Math.max(0, xg), 0]);
    }
    const poly = (pts) => pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
    add(`<defs><pattern id="${uid}-rays" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(${(90 - phi).toFixed(1)})"><line x1="0" y1="0" x2="0" y2="9" class="st-ray-line"/></pattern></defs>`);
    add(`<polygon points="${poly(lit)}" fill="url(#${uid}-rays)" class="st-light"/>`);
    if (cfg.hOpp > 0) add(`<polygon points="${poly(shade)}" class="st-shadow"/>`);
    if (cfg.hOpp > 0) add(`<line x1="${X(cfg.width)}" y1="${Y(cfg.hOpp)}" x2="${X(Math.max(0, xg))}" y2="${Y(Math.max(0, yLine(0)))}" class="st-ray-edge"/>`);
  }

  // Sol pointillé
  add(`<rect x="0" y="${yg}" width="${SEC_W}" height="14" fill="url(#st-dots)"/>`);
  add(`<line x1="0" y1="${yg}" x2="${SEC_W}" y2="${yg}" class="st-line"/>`);

  // Immeubles hachurés
  const building = (x0, x1, h, label) => {
    add(`<rect x="${X(x0)}" y="${Y(h)}" width="${X(x1) - X(x0)}" height="${Y(0) - Y(h)}" fill="url(#st-hatch)" class="st-building"/>`);
    if (h > 2) add(`<text x="${(X(x0) + X(x1)) / 2}" y="${Y(h) - 8}" text-anchor="middle" class="st-label">${label}</text>`);
  };
  building(-depth, 0, cfg.hOwn, 'notre immeuble');
  if (cfg.hOpp > 0) building(cfg.width, cfg.width + depth, cfg.hOpp, 'en face');

  // Fenêtres de notre façade (blanches) ; celle étudiée se remplit selon sa part au soleil
  for (let n = 0; n <= maxFloor(); n++) {
    const w = windowOf(n);
    const cur = n === cfg.floor;
    add(`<rect x="${X(-0.35)}" y="${Y(w.zt)}" width="${0.35 * k}" height="${Y(w.zb) - Y(w.zt)}" class="${cur ? 'st-win st-win-cur' : 'st-win'}"/>`);
    if (cur && r.lit > 0) {
      const litBot = w.zt - r.lit * (w.zt - w.zb);
      add(`<rect x="${X(-0.35)}" y="${Y(w.zt)}" width="${0.35 * k}" height="${Y(litBot) - Y(w.zt)}" class="st-win-lit"/>`);
    }
  }
  add(`<text x="${X(-depth) - 8}" y="${Y(zc) + 4}" text-anchor="end" class="st-cote-text">${floorShort(cfg.floor)}</text>`);

  // Un passant, pour l'échelle
  {
    const px = X(cfg.width * 0.3);
    const u = k * 1.7; // 1,70 m
    add(`<g class="st-person" transform="translate(${px},${yg})"><circle cx="0" cy="${-u * 0.9}" r="${u * 0.09}"/><path d="M0 ${-u * 0.8} V${-u * 0.42} M0 ${-u * 0.42} L${-u * 0.12} 0 M0 ${-u * 0.42} L${u * 0.12} 0 M${-u * 0.16} ${-u * 0.62} L${u * 0.16} ${-u * 0.62}"/></g>`);
  }

  // Angle d'obstruction depuis le milieu de la fenêtre
  const alpha = obstructionAngle(cfg, zc);
  if (cfg.hOpp > zc) {
    add(`<line x1="${X(0)}" y1="${Y(zc)}" x2="${X(cfg.width)}" y2="${Y(cfg.hOpp)}" class="st-obst"/>`);
    add(`<line x1="${X(0)}" y1="${Y(zc)}" x2="${X(Math.min(cfg.width, 8))}" y2="${Y(zc)}" class="st-guide"/>`);
    const rad = Math.min(60, cfg.width * k * 0.45);
    const a = (alpha * Math.PI) / 180;
    add(`<path d="M${X(0) + rad},${Y(zc)} A${rad},${rad} 0 0 0 ${X(0) + rad * Math.cos(a)},${Y(zc) - rad * Math.sin(a)}" class="st-arc"/>`);
    add(`<text x="${X(0) + rad + 6}" y="${Y(zc) - rad * Math.sin(a / 2) + 4}" class="st-angle st-angle-obst">α ${fmt(alpha)}°</text>`);
  }

  // Course du soleil dans le plan de coupe : un demi-cercle centré sur la fenêtre
  // (quart d'ellipse côté rue, plus court côté arrière pour rester dans le dessin)
  const Rv = Math.max(80, Y(zc) - 26);
  const Rr = Math.max(80, SEC_W - 24 - X(0));
  const Rl = Math.max(40, X(0) - 22);
  add(`<path d="M${X(0) + Rr},${Y(zc)} A${Rr},${Rv} 0 0 0 ${X(0)},${Y(zc) - Rv} A${Rl},${Rv} 0 0 0 ${X(0) - Rl},${Y(zc)}" class="st-track"/>`);
  const sx = X(0) + (Math.cos(pr) >= 0 ? Rr : Rl) * Math.cos(pr);
  const sy = Y(zc) - Rv * Math.sin(pr);
  if (relevant && r.lit > 0) add(`<line x1="${X(0)}" y1="${Y(zc)}" x2="${sx}" y2="${sy}" class="st-ray-lit"/>`);
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return `<line x1="${Math.cos(a) * 17}" y1="${Math.sin(a) * 17}" x2="${Math.cos(a) * 24}" y2="${Math.sin(a) * 24}"/>`;
  }).join('');
  add(`<g transform="translate(${sx.toFixed(1)},${sy.toFixed(1)})" class="st-sun${relevant ? '' : ' st-sun-off'}"><circle r="12"/>${rays}</g>`);
  const sunTxt = relevant ? `φ ${fmt(phi)}°` : sun.altitude <= 0 ? "soleil couché" : "derrière la façade";
  if (phi > 90) add(`<text x="${sx}" y="${sy + 40}" text-anchor="middle" class="st-angle">${sunTxt}</text>`);
  else add(`<text x="${sx - 30}" y="${sy + 4}" text-anchor="end" class="st-angle">${sunTxt}</text>`);

  // Cotes
  const yc = yg + 36;
  add(`<line x1="${X(0)}" y1="${yc}" x2="${X(cfg.width)}" y2="${yc}" class="st-cote" marker-start="url(#st-tick)" marker-end="url(#st-tick)"/>`);
  add(`<text x="${(X(0) + X(cfg.width)) / 2}" y="${yc - 6}" text-anchor="middle" class="st-cote-text">L ${fmt(cfg.width, 1)} m</text>`);
  if (cfg.hOpp > 0) {
    const xc = X(cfg.width + depth) + 18;
    const ym = (Y(0) + Y(cfg.hOpp)) / 2;
    add(`<line x1="${xc}" y1="${Y(0)}" x2="${xc}" y2="${Y(cfg.hOpp)}" class="st-cote" marker-start="url(#st-tick)" marker-end="url(#st-tick)"/>`);
    add(`<text x="${xc + 14}" y="${ym}" class="st-cote-text" text-anchor="middle" transform="rotate(-90 ${xc + 14} ${ym})">H ${fmt(cfg.hOpp, 1)} m</text>`);
  }

  // Colonne de droite : masque en plan et plage horaire de la façade
  add(planMask(cfg, sun, 790, 168, 86));
  const ranges = dayData?.ranges ?? [];
  add(`<text x="790" y="300" text-anchor="middle" class="st-side-title">Soleil face à la façade</text>`);
  add(`<text x="790" y="322" text-anchor="middle" class="st-side-value">${ranges.length ? ranges.map(([a, b]) => `${fmtHour(a)} → ${fmtHour(b)}`).join(' · ') : 'jamais ce jour-là'}</text>`);
  add(`<text x="790" y="342" text-anchor="middle" class="st-note">${dateLabel(state.doy)}</text>`);
  add(`<g transform="translate(700,382)" class="st-legend">
    <rect width="12" height="12" class="pm-sky"/><text x="18" y="10">ciel visible</text>
    <rect y="20" width="12" height="12" class="pm-opp"/><text x="18" y="30">masqué par l'immeuble d'en face</text>
    <rect y="40" width="12" height="12" class="pm-back"/><text x="18" y="50">derrière la façade</text>
  </g>`);

  add(`<text x="20" y="${H - 14}" class="st-tag">Schéma 2D interactif</text>`);
  add(`<text x="20" y="28" class="st-note">Coupe perpendiculaire à la façade ${orientationName(cfg.facadeAz)}</text>`);

  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="street-svg" role="img" aria-label="Coupe de la rue et masque en plan">
    <defs>
      <pattern id="st-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" class="st-hatch-line"/></pattern>
      <pattern id="st-dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="0.7" class="st-dot"/><circle cx="4" cy="3.8" r="0.6" class="st-dot"/></pattern>
      <marker id="st-tick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M2 8 L8 2" class="st-tick"/></marker>
    </defs>
    ${parts.join('\n')}
  </svg>`;
}

/**
 * Masque en plan : la voûte céleste vue d'en haut, avec la rue dessinée selon son
 * orientation, le ciel masqué par l'immeuble d'en face (gris) et la course du soleil.
 */
let planCache = { key: '', cells: '' };
function planMask(cfg, sun, cx, cy, R) {
  const proj = (alt, az) => {
    const rr = (R * (90 - Math.max(alt, 0))) / 90;
    const a = (az * Math.PI) / 180;
    return [cx + rr * Math.sin(a), cy - rr * Math.cos(a)];
  };
  const key = [cfg.facadeAz, cfg.width, cfg.hOpp, cfg.floor, cx, cy, R].join('|');
  if (planCache.key !== key) {
    const step = 5;
    let cells = '';
    for (let i = 0; i < 90 / step; i++) {
      for (let j = 0; j < 360 / step; j++) {
        const alt = i * step + step / 2;
        const az = j * step + step / 2;
        const v = sunVectorLocal(alt, az, cfg.facadeAz);
        let cls = '';
        if (v.z <= 0) cls = 'pm-back';
        else if (sunlitFraction(cfg, v) < 0.5) cls = 'pm-opp';
        if (!cls) continue;
        const z0 = j * step;
        const z1 = z0 + step + 0.4;
        const a0 = i * step;
        const a1 = a0 + step;
        const p = [proj(a0, z0), proj(a0, z1), proj(a1, z1), proj(a1, z0)];
        cells += `<path d="M${p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}Z" class="${cls}"/>`;
      }
    }
    planCache = { key, cells };
  }
  // Courses du soleil : solstices et jour choisi
  const path = (doy) => {
    const pts = [];
    for (let m = 0; m <= 1440; m += 15) {
      const p = sunPosition(parisLocalToUTC(YEAR, doy, m / 60));
      if (p.altitude > 0) pts.push(proj(p.altitude, p.azimuth));
    }
    return pts.length > 1 ? `M${pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}` : '';
  };
  // La rue : deux traits parallèles à la façade, de part et d'autre du centre
  const fa = (cfg.facadeAz * Math.PI) / 180;
  const ux = Math.cos(fa);
  const uy = Math.sin(fa);
  const nx = Math.sin(fa);
  const ny = -Math.cos(fa);
  const off = 10;
  const street = [-1, 1].map((sg) => {
    const ox = cx + nx * off * sg;
    const oy = cy + ny * off * sg;
    return `<line x1="${ox - ux * R}" y1="${oy - uy * R}" x2="${ox + ux * R}" y2="${oy + uy * R}" class="pm-street"/>`;
  }).join('');
  let sunDot = '';
  if (sun.altitude > 0) {
    const [x, y] = proj(sun.altitude, sun.azimuth);
    sunDot = `<circle cx="${x}" cy="${y}" r="5" class="pm-sun"/>`;
  }
  const cards = [['N', 0], ['E', 90], ['S', 180], ['O', 270]].map(([t, az]) => {
    const a = (az * Math.PI) / 180;
    return `<text x="${cx + (R + 11) * Math.sin(a)}" y="${cy - (R + 11) * Math.cos(a) + 4}" text-anchor="middle" class="pm-card">${t}</text>`;
  }).join('');
  return `<g class="plan-mask">
    <text x="${cx}" y="${cy - R - 26}" text-anchor="middle" class="st-side-title">Masque en plan</text>
    <circle cx="${cx}" cy="${cy}" r="${R}" class="pm-disc"/>
    ${planCache.cells}
    <circle cx="${cx}" cy="${cy}" r="${R}" class="pm-ring"/>
    <circle cx="${cx}" cy="${cy}" r="${R * 2 / 3}" class="pm-grid"/><circle cx="${cx}" cy="${cy}" r="${R / 3}" class="pm-grid"/>
    ${street}
    <path d="${path(172)}" class="pm-path-ref"/><path d="${path(355)}" class="pm-path-ref"/>
    <path d="${path(state.doy)}" class="pm-path"/>
    ${sunDot}
    ${cards}
  </g>`;
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
// Démarrage
// ---------------------------------------------------------------------------

syncControls();
recomputeDay();
recomputeSlow();
