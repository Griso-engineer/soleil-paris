// Graphiques SVG : diagramme solaire, profil journalier, bilan mensuel, comparatif.

import { sunPosition, parisLocalToUTC } from './solar.js';
import { maskColor, MASK_RAMP } from './shading.js';
import { L, LANG, LOCALE } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const MONTHS = LANG === 'en'
  ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  : ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function svgRoot(container, w, h, label) {
  container.innerHTML = '';
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label, class: 'chart-svg' });
  container.appendChild(svg);
  return svg;
}

const fmt = (v, d = 0) => v.toLocaleString(LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtHour = (h) => {
  const hh = Math.floor(h + 1e-6);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh % 24).padStart(2, '0')}${L('h', ':')}${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
};

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// Infobulle partagée
let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'status');
    document.body.appendChild(tip);
  }
  return tip;
}
function showTip(html, evt) {
  const t = tooltip();
  t.innerHTML = html;
  t.style.display = 'block';
  const pad = 14;
  const r = t.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
function hideTip() {
  if (tip) tip.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Diagramme solaire (projection polaire équidistante, nord en haut)
// ---------------------------------------------------------------------------

// Cases du masque, mises en cache par grille (le diagramme est redessiné à chaque heure)
const maskCache = new WeakMap();
function maskCells(mask, proj) {
  if (maskCache.has(mask)) return maskCache.get(mask);
  const { step, values } = mask;
  let s = '';
  values.forEach((row, i) => {
    const a0 = i * step;
    const a1 = Math.min(90, a0 + step);
    row.forEach((v, j) => {
      const z0 = j * step;
      const z1 = z0 + step + 0.4; // léger recouvrement pour éviter les liserés
      const p = [proj(a0, z0), proj(a0, z1), proj(a1, z1), proj(a1, z0)];
      const [r, g, b] = maskColor(v);
      s += `<path d="M${p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join('L')}Z" fill="rgb(${r},${g},${b})"/>`;
    });
  });
  maskCache.set(mask, s);
  return s;
}

/** Dégradé CSS du masque solaire, dans la direction donnée (90deg : de gauche à droite). */
export function maskGradient(dir = '90deg') {
  const stops = MASK_RAMP.map(([v]) => v)
    .map((v) => `rgb(${maskColor(v).join(',')}) ${v * 100}%`).join(', ');
  return `linear-gradient(${dir}, ${stops})`;
}

/** Légende du masque solaire (barre de dégradé 0 → 100 %). */
export function maskLegendHTML() {
  return `<div class="mask-legend"><span>0 %</span><i style="background:${maskGradient()}"></i><span>100 %</span></div>
    <p class="mask-caption">${L('Part du vitrage au soleil si le soleil se trouvait dans cette direction du ciel.', 'Share of the glazing in direct sun if the sun stood in this direction of the sky.')}</p>`;
}

export function renderSunPath(container, { year, doy, hour, sun, facadeAz, mask = null }) {
  const S = 340;
  const c = S / 2;
  const R = 140;
  const svg = svgRoot(container, S, S, L('Diagramme de la course du soleil à Paris', 'Sun path diagram for Paris'));
  const proj = (alt, az) => {
    const r = (R * (90 - Math.max(alt, 0))) / 90;
    const a = (az * Math.PI) / 180;
    return [c + r * Math.sin(a), c - r * Math.cos(a)];
  };

  if (mask) {
    // Masque solaire : chaque case de ciel colorée selon la part du vitrage au soleil
    const g = el('g', { class: 'sp-mask' }, svg);
    g.innerHTML = maskCells(mask, proj);
  } else {
    // Demi-ciel situé derrière la façade
    const back = [];
    for (let k = 0; k <= 36; k++) {
      const az = facadeAz + 90 + (k / 36) * 180;
      back.push(proj(0, az));
    }
    el('path', {
      d: `M${c},${c} L${back.map((p) => p.join(',')).join(' L')} Z`,
      class: 'sp-back',
    }, svg);
  }

  el('circle', { cx: c, cy: c, r: R, class: 'sp-ring sp-horizon' }, svg);
  for (const alt of [30, 60]) {
    el('circle', { cx: c, cy: c, r: (R * (90 - alt)) / 90, class: 'sp-ring' }, svg);
    el('text', { x: c + 3, y: c - (R * (90 - alt)) / 90 - 3, class: 'sp-label' }, svg).textContent = `${alt}°`;
  }
  for (let az = 0; az < 360; az += 30) {
    const [x, y] = proj(0, az);
    el('line', { x1: c, y1: c, x2: x, y2: y, class: 'sp-ray' }, svg);
  }
  for (const [t, az] of [['N', 0], ['E', 90], ['S', 180], [L('O', 'W'), 270]]) {
    const a = (az * Math.PI) / 180;
    el('text', {
      x: c + (R + 14) * Math.sin(a), y: c - (R + 14) * Math.cos(a) + 4,
      class: 'sp-cardinal', 'text-anchor': 'middle',
    }, svg).textContent = t;
  }

  // Trace de la façade et sa normale
  const fa = (facadeAz * Math.PI) / 180;
  const ux = Math.cos(fa);
  const uy = Math.sin(fa);
  el('line', { x1: c - ux * R, y1: c - uy * R, x2: c + ux * R, y2: c + uy * R, class: 'sp-facade' }, svg);
  const [nx, ny] = [c + Math.sin(fa) * 34, c - Math.cos(fa) * 34];
  el('line', { x1: c, y1: c, x2: nx, y2: ny, class: 'sp-normal', 'marker-end': 'url(#arrow)' }, svg);
  const defs = el('defs', {}, svg);
  const mk = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'sp-arrowhead' }, mk);

  const dayPath = (d) => {
    const pts = [];
    for (let m = 0; m <= 1440; m += 10) {
      const p = sunPosition(parisLocalToUTC(year, d, m / 60));
      if (p.altitude > 0) pts.push(proj(p.altitude, p.azimuth));
    }
    return pts;
  };
  const line = (pts, cls) => {
    if (pts.length > 1) el('path', { d: `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L')}`, class: cls }, svg);
  };
  line(dayPath(172), 'sp-ref');
  line(dayPath(80), 'sp-ref');
  line(dayPath(355), 'sp-ref');

  const ref = [[172, L('21 juin', '21 June')], [355, L('21 déc.', '21 Dec')]];
  for (const [d, label] of ref) {
    const p = sunPosition(parisLocalToUTC(year, d, d === 172 ? 14 : 13));
    const [x, y] = proj(p.altitude, p.azimuth);
    el('text', { x: x + 5, y: y + (d === 172 ? -6 : 14), class: 'sp-label' }, svg).textContent = label;
  }

  line(dayPath(doy), 'sp-today');

  // Repères horaires sur la course du jour
  for (let h = 4; h <= 22; h++) {
    const p = sunPosition(parisLocalToUTC(year, doy, h));
    if (p.altitude <= 0) continue;
    const [x, y] = proj(p.altitude, p.azimuth);
    el('circle', { cx: x, cy: y, r: 2.2, class: 'sp-hour' }, svg);
    if (h % 2 === 0) el('text', { x, y: y - 6, 'text-anchor': 'middle', class: 'sp-hlabel' }, svg).textContent = `${h}h`;
  }

  if (sun.altitude > 0) {
    const [x, y] = proj(sun.altitude, sun.azimuth);
    const dot = el('circle', { cx: x, cy: y, r: 8, class: 'sp-sun' }, svg);
    const hit = el('circle', { cx: x, cy: y, r: 16, fill: 'transparent' }, svg);
    const html = `<strong>${fmtHour(hour)}</strong><br>${L('Hauteur', 'Altitude')} ${fmt(sun.altitude, 1)}°<br>${L('Azimut', 'Azimuth')} ${fmt(sun.azimuth, 1)}°`;
    hit.addEventListener('mousemove', (e) => showTip(html, e));
    hit.addEventListener('mouseleave', hideTip);
    void dot;
  }
}

// ---------------------------------------------------------------------------
// Profil journalier
// ---------------------------------------------------------------------------

// Lissage d'affichage : le calcul échantillonne l'ombre sur une grille de points, ce qui
// donne de petites marches d'un pas de temps à l'autre. On les gomme par une moyenne
// gaussienne (pour l'affichage seulement : les totaux sont calculés sur les valeurs brutes).
function smoothProfile(arr, radius = 3) {
  const w = [];
  for (let k = -radius; k <= radius; k++) w.push(Math.exp(-(k * k) / (2 * (radius / 2) ** 2)));
  return arr.map((p, i) => {
    let s = 0;
    let n = 0;
    for (let k = -radius; k <= radius; k++) {
      const q = arr[i + k];
      if (!q) continue;
      s += q.gain * w[k + radius];
      n += w[k + radius];
    }
    return { ...p, gain: p.gain === 0 && s / n < 1e-3 ? 0 : s / n };
  });
}

// Tracé courbe passant par les points (Catmull-Rom converti en Bézier cubiques)
function curve(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Version compacte, posée sur la vue 3D : les deux courbes et l'heure courante. */
export function renderLiveDay(container, { without, withP, hour, area }) {
  const W = 220;
  const H = 92;
  const m = { l: 6, r: 6, t: 14, b: 14 };
  const svg = svgRoot(container, W, H, L('Chaleur solaire entrant au fil de la journée', 'Solar heat entering over the day'));
  const a = smoothProfile(without);
  const b = smoothProfile(withP);
  const ymax = niceMax(Math.max(100, ...a.map((p) => p.gain * area)) * 1.05);
  const x = (h) => m.l + (h / 24) * (W - m.l - m.r);
  const y = (v) => m.t + (H - m.t - m.b) - (v / ymax) * (H - m.t - m.b);
  const pts = (arr) => arr.map((p) => [x(p.h), y(p.gain * area)]);
  el('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), class: 'axis' }, svg);
  el('path', { d: `${curve(pts(b))} L${x(24)},${y(0)} L${x(0)},${y(0)} Z`, class: 'area-1' }, svg);
  el('path', { d: curve(pts(a)), class: 'line-2' }, svg);
  el('path', { d: curve(pts(b)), class: 'line-1' }, svg);
  for (const h of [6, 12, 18]) {
    el('text', { x: x(h), y: H - 3, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = `${h}h`;
  }
  el('text', { x: m.l, y: 10, class: 'tick' }, svg).textContent = `${fmt(ymax)} W`;
  el('line', { x1: x(hour), x2: x(hour), y1: m.t, y2: y(0), class: 'now' }, svg);
  const i = Math.max(0, Math.min(b.length - 1, Math.round((hour / 24) * (b.length - 1))));
  el('circle', { cx: x(hour), cy: y(a[i].gain * area), r: 3.5, class: 'dot-2' }, svg);
  el('circle', { cx: x(hour), cy: y(b[i].gain * area), r: 3.5, class: 'dot-1' }, svg);
  el('text', { x: Math.min(W - m.r, x(hour) + 4), y: m.t + 8, 'text-anchor': x(hour) > W - 60 ? 'end' : 'start', class: 'tick tick-strong' }, svg)
    .textContent = `${fmt(b[i].gain * area)} W`;
}

export function renderDayChart(container, { without, withP, hour, area, onPick }) {
  without = smoothProfile(without);
  withP = smoothProfile(withP);
  const W = 640;
  const H = 260;
  const m = { l: 48, r: 16, t: 16, b: 30 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const svg = svgRoot(container, W, H, L('Puissance solaire entrant par la fenêtre au fil de la journée', 'Solar power entering through the window over the day'));

  const vals = without.map((p) => p.gain * area);
  const ymax = niceMax(Math.max(100, ...vals) * 1.05);
  const x = (h) => m.l + (h / 24) * iw;
  const y = (v) => m.t + ih - (v / ymax) * ih;

  for (let k = 0; k <= 4; k++) {
    const v = (ymax * k) / 4;
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: k === 0 ? 'axis' : 'grid' }, svg);
    el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fmt(v);
  }
  el('text', { x: m.l, y: m.t - 4, class: 'tick' }, svg).textContent = 'W';
  for (let h = 0; h <= 24; h += 3) {
    el('text', { x: x(h), y: H - 10, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = `${h}h`;
  }

  const path = (arr, key) => curve(arr.map((p) => [x(p.h), y(p[key] * area)]));
  const areaPath = `${path(withP, 'gain')} L${x(24)},${y(0)} L${x(0)},${y(0)} Z`;
  el('path', { d: areaPath, class: 'area-1' }, svg);
  el('path', { d: path(without, 'gain'), class: 'line-2' }, svg);
  el('path', { d: path(withP, 'gain'), class: 'line-1' }, svg);

  // Étiquettes directes au pic de chaque courbe
  const peak = (arr) => arr.reduce((a, b) => (b.gain > a.gain ? b : a), arr[0]);
  const pw = peak(without);
  const pp = peak(withP);
  if (pw.gain * area > ymax * 0.08) {
    el('text', { x: x(pw.h), y: y(pw.gain * area) - 8, 'text-anchor': 'middle', class: 'direct-label' }, svg).textContent = L('sans protection', 'without shading');
  }
  if (pp.gain * area > ymax * 0.08 && Math.abs(y(pp.gain * area) - y(pw.gain * area)) > 18) {
    el('text', { x: x(pp.h), y: y(pp.gain * area) - 8, 'text-anchor': 'middle', class: 'direct-label' }, svg).textContent = L('avec protection', 'with shading');
  }

  // Heure courante
  el('line', { x1: x(hour), x2: x(hour), y1: m.t, y2: m.t + ih, class: 'now' }, svg);

  // Couche de survol
  const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'cross', visibility: 'hidden' }, svg);
  const d1 = el('circle', { r: 4.5, class: 'dot-1', visibility: 'hidden' }, svg);
  const d2 = el('circle', { r: 4.5, class: 'dot-2', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' }, svg);
  const pick = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W;
    const h = Math.max(0, Math.min(24, ((px - m.l) / iw) * 24));
    const i = Math.round((h / 24) * (withP.length - 1));
    return { i, h: withP[i].h };
  };
  hit.addEventListener('mousemove', (evt) => {
    const { i, h } = pick(evt);
    const a = without[i].gain * area;
    const b = withP[i].gain * area;
    for (const n of [cross, d1, d2]) n.setAttribute('visibility', 'visible');
    cross.setAttribute('x1', x(h));
    cross.setAttribute('x2', x(h));
    d1.setAttribute('cx', x(h)); d1.setAttribute('cy', y(b));
    d2.setAttribute('cx', x(h)); d2.setAttribute('cy', y(a));
    showTip(
      `<strong>${fmtHour(h)}</strong>
       <div class="tip-row"><span class="sw sw-2"></span>${L('Sans protection', 'Without shading')}<b>${fmt(a)} W</b></div>
       <div class="tip-row"><span class="sw sw-1"></span>${L('Avec protection', 'With shading')}<b>${fmt(b)} W</b></div>
       <div class="tip-note">${L('Cliquer pour se placer à cette heure', 'Click to jump to this time')}</div>`,
      evt
    );
  });
  hit.addEventListener('mouseleave', () => {
    for (const n of [cross, d1, d2]) n.setAttribute('visibility', 'hidden');
    hideTip();
  });
  hit.addEventListener('click', (evt) => onPick && onPick(pick(evt).h));
}

// ---------------------------------------------------------------------------
// Bilan mensuel (barres groupées)
// ---------------------------------------------------------------------------

export function renderMonthChart(container, {
  data, currentMonth, unit = 'kWh', axisLabel = L('kWh / jour', 'kWh / day'), labels = [L('Sans protection', 'Without shading'), L('Avec protection', 'With shading')], yMax = null,
  note = (d) => L(`Soleil au midi : ${fmt(d.noonAlt, 0)}° de hauteur`, `Noon sun: ${fmt(d.noonAlt, 0)}° high`),
}) {
  const W = 640;
  const H = 240;
  const m = { l: 44, r: 12, t: 18, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const svg = svgRoot(container, W, H, L('Énergie solaire entrant par jour de ciel clair, mois par mois', 'Solar energy entering per clear-sky day, month by month'));
  const ymax = yMax ?? niceMax(Math.max(0.5, ...data.map((d) => d.without)) * 1.05);
  const y = (v) => m.t + ih - (v / ymax) * ih;
  for (let k = 0; k <= 4; k++) {
    const v = (ymax * k) / 4;
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: k === 0 ? 'axis' : 'grid' }, svg);
    el('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fmt(v, v < 10 && ymax < 10 ? 1 : 0);
  }
  el('text', { x: m.l, y: m.t - 6, class: 'tick' }, svg).textContent = axisLabel;
  const band = iw / 12;
  const bw = Math.min(18, (band - 10) / 2);
  data.forEach((d, i) => {
    const cx = m.l + band * (i + 0.5);
    if (i === currentMonth) {
      el('rect', { x: cx - band / 2 + 1, y: m.t, width: band - 2, height: ih, class: 'month-hl' }, svg);
    }
    const bar = (v, xx, cls) => {
      const h = Math.max(0, y(0) - y(v));
      const r = Math.min(4, h, bw / 2);
      // Barre arrondie en haut, ancrée sur l'axe
      const x0 = xx;
      const x1 = xx + bw;
      const y0 = y(0);
      const y1 = y(v);
      el('path', {
        d: `M${x0},${y0} L${x0},${y1 + r} Q${x0},${y1} ${x0 + r},${y1} L${x1 - r},${y1} Q${x1},${y1} ${x1},${y1 + r} L${x1},${y0} Z`,
        class: cls,
      }, svg);
    };
    bar(d.without, cx - bw - 1, 'bar-2');
    bar(d.withP, cx + 1, 'bar-1');
    el('text', { x: cx, y: H - 9, 'text-anchor': 'middle', class: i === currentMonth ? 'tick tick-strong' : 'tick' }, svg).textContent = MONTHS[i];
    const hit = el('rect', { x: cx - band / 2, y: m.t, width: band, height: ih, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', (evt) => showTip(
      `<strong>${L(`21 ${MONTHS[i].replace(".", "")}`, `21 ${MONTHS[i]}`)}</strong>
       <div class="tip-row"><span class="sw sw-2"></span>${labels[0]}<b>${fmt(d.without, 1)} ${unit}</b></div>
       <div class="tip-row"><span class="sw sw-1"></span>${labels[1]}<b>${fmt(d.withP, 1)} ${unit}</b></div>
       <div class="tip-note">${note(d)}</div>`,
      evt
    ));
    hit.addEventListener('mouseleave', hideTip);
  });
}

// ---------------------------------------------------------------------------
// Comparatif des protections (barres horizontales : part du rayonnement arrêtée)
// ---------------------------------------------------------------------------

export function renderComparison(container, rows) {
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'cmp';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = `cmp-row${r.current ? ' is-current' : ''}`;
    const blocked = Math.max(0, Math.min(1, r.reduction));
    const light = Math.max(0, Math.min(1, r.light));
    row.innerHTML = `
      <div class="cmp-name"><span>${r.label}</span><small>${r.setting}</small></div>
      <div class="cmp-bar" title="${L("Part du rayonnement solaire arrêtée", "Share of solar radiation blocked")}">
        <div class="cmp-fill" style="width:${(blocked * 100).toFixed(1)}%"></div>
        <span class="cmp-val${blocked < 0.18 ? ' out' : ''}"${blocked < 0.18 ? ` style="left:calc(${(blocked * 100).toFixed(1)}% + 6px)"` : ''}>${fmt(blocked * 100)} %</span>
      </div>
      <div class="cmp-light" title="${L("Lumière naturelle conservée", "Daylight kept")}">${fmt(light * 100)} %</div>
      <div class="cmp-kwh">${fmt(r.kwh, 1)}</div>`;
    list.appendChild(row);
  }
  container.appendChild(list);
}

export { MONTHS, fmt };
