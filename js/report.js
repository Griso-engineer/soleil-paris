// Fiche PDF d'une protection solaire : deux pages A4 portrait, composées à partir de
// l'état courant du simulateur, puis imprimées par le navigateur (« Enregistrer au
// format PDF »). Aucune bibliothèque : le gabarit est en HTML/CSS d'impression.

/**
 * @param {object} ctx
 *   scene      : SolarScene (pour les vues 3D) ou null
 *   title      : nom de la protection
 *   setting    : réglage lisible (« ouverts à 55°, persiennés »)
 *   rows       : [[libellé, valeur], …] description de la configuration
 *   summary    : texte de la protection
 */
import { L, LOCALE } from './i18n.js';

export function exportReport(ctx) {
  const $ = (id) => document.getElementById(id);
  let el = $('report');
  if (!el) {
    el = document.createElement('div');
    el.id = 'report';
    document.body.appendChild(el);
  }

  const shots = ctx.scene
    ? { ext: ctx.scene.snapshot('ext', 1600, 1100), coupe: ctx.scene.snapshot('coupe', 1600, 1100) }
    : null;
  const html = (id) => ($(id) ? $(id).innerHTML : '');
  const today = new Date().toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });

  el.innerHTML = `
    <section class="rp-page">
      <header class="rp-head">
        <div class="rp-logo">tracés</div>
        <div class="rp-meta">${L('Fiche protection solaire · Paris', 'Solar shading sheet · Paris')}<br>${today}</div>
      </header>
      <div class="rp-title">
        <span>${L('Soleil &amp; protections', 'Sun &amp; shading')}</span>
        <h1>${ctx.title}</h1>
        <p>${ctx.setting}</p>
      </div>
      <div class="rp-config">
        ${ctx.rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
      </div>
      ${shots ? `
      <div class="rp-views">
        <figure><img src="${shots.ext}" alt="${L('Axonométrie extérieure', 'Exterior axonometric view')}"><figcaption>${L("<b>Axonométrie</b> depuis la rue", '<b>Axonometric view</b> from the street')}</figcaption></figure>
        <figure><img src="${shots.coupe}" alt="${L('Coupe', 'Section')}"><figcaption>${L("<b>Coupe</b> par l'axe de la baie", '<b>Section</b> through the window axis')}</figcaption></figure>
      </div>` : ''}
      <h2>${L("À l'instant simulé", 'At the simulated time')} <span>${$('kpiNowLabel')?.textContent ?? ''}</span></h2>
      <div class="kpis rp-kpis">${html('kpis')}</div>
      <h2>${L('Sur la journée', 'Over the day')} <span>${$('kpiDayLabel')?.textContent ?? ''}</span></h2>
      <div class="kpis rp-kpis">${html('kpisDay')}</div>
    </section>

    <section class="rp-page">
      <header class="rp-head">
        <div class="rp-logo">tracés</div>
        <div class="rp-meta">${ctx.title}<br>${ctx.setting}</div>
      </header>
      <h2>${L('En période de canicule', 'During a heatwave')} <span>${L('25 juillet, ciel clair', '25 July, clear sky')}</span></h2>
      <div class="kpis kpis-heat rp-kpis">${html('kpisHeat')}</div>
      <h2>${L('Chaleur solaire entrant par la fenêtre', 'Solar heat entering through the window')} <span>${$('kpiDayLabel')?.textContent ?? ''}</span></h2>
      <div class="rp-legend"><span><i class="sw sw-2"></i>${L('Sans protection', 'Without shading')}</span><span><i class="sw sw-1"></i>${L('Avec protection', 'With shading')}</span></div>
      <div class="rp-chart">${html('dayChart')}</div>
      <h2>${L("Au fil de l'année", 'Through the year')} <span>${L('énergie entrant par jour de ciel clair, le 21 de chaque mois', 'energy entering per clear-sky day, on the 21st of each month')}</span></h2>
      <div class="rp-chart rp-chart-sm">${html('monthChart')}</div>
      <h2>${L('Comparaison avec les autres protections', 'Comparison with other shading devices')} <span>${L('même fenêtre, même journée', 'same window, same day')}</span></h2>
      <div class="cmp-head"><span>${L('Protection', 'Shading')}</span><span>${L('Rayonnement arrêté', 'Radiation blocked')}</span><span>${L('Lumière', 'Daylight')}</span><span>${L('kWh/j', 'kWh/day')}</span></div>
      <div class="rp-cmp">${html('comparison')}</div>
      <div class="rp-cols">
        <div>
          <h2>${L('À retenir', 'Key takeaways')}</h2>
          <p class="rp-text">${ctx.summary}</p>
          <div class="rp-insights">${html('insights')}</div>
        </div>
        <div>
          <h2>${L('Méthode', 'Method')}</h2>
          <p class="rp-text">${L("Position du soleil NOAA, ciel clair ASHRAE (journées sans nuages : enveloppe haute des apports). Ombrage par lancer de rayons sur la géométrie de la baie et de la protection ; apports selon la NF EN ISO 52022-1. F<sub>c</sub> = g<sub>tot</sub> avec / g<sub>tot</sub> sans protection. Porosité : part de la baie libre vue de face. Surchauffe évitée : ordre de grandeur rapporté à l'inertie de la pièce. Hors modèle : masques lointains, météo réelle, ventilation. Outil de comparaison, pas de dimensionnement.",
            'NOAA sun position, ASHRAE clear sky (cloudless days: upper bound of gains). Shading by ray casting on the geometry of the opening and the device; gains per EN ISO 52022-1. F<sub>c</sub> = g<sub>tot</sub> with / g<sub>tot</sub> without shading. Porosity: share of the opening left free, seen face on. Overheating avoided: order of magnitude based on the room thermal mass. Not modelled: distant obstructions, real weather, ventilation. A comparison tool, not a sizing tool.')}</p>
        </div>
      </div>
      <footer class="rp-foot">
        <span>tracés · l.grisoni@traces.design · +33 (0)6 98 57 36 58 · 18 rue Raymond Aron, 75013 Paris</span>
        <span>griso-engineer.github.io/soleil-paris</span>
      </footer>
    </section>`;

  // Laisse le temps aux images de se décoder avant d'ouvrir l'impression
  const imgs = [...el.querySelectorAll('img')];
  Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))))
    .then(() => {
      const root = document.documentElement;
      const title = document.title;
      root.classList.add('printing');
      if (ctx.preview) return; // aperçu à l'écran, sans boîte d'impression
      const done = () => {
        root.classList.remove('printing');
        document.title = title;
        window.removeEventListener('afterprint', done);
      };
      window.addEventListener('afterprint', done);
      document.title = `Tracés - ${ctx.title} - ${L("fiche protection solaire", "solar shading sheet")}`;
      window.print();
    });
}
