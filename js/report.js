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
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  el.innerHTML = `
    <section class="rp-page">
      <header class="rp-head">
        <div class="rp-logo">tracés</div>
        <div class="rp-meta">Fiche protection solaire · Paris<br>${today}</div>
      </header>
      <div class="rp-title">
        <span>Soleil &amp; protections</span>
        <h1>${ctx.title}</h1>
        <p>${ctx.setting}</p>
      </div>
      <div class="rp-config">
        ${ctx.rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
      </div>
      ${shots ? `
      <div class="rp-views">
        <figure><img src="${shots.ext}" alt="Axonométrie extérieure"><figcaption><b>Axonométrie</b> depuis la rue</figcaption></figure>
        <figure><img src="${shots.coupe}" alt="Coupe"><figcaption><b>Coupe</b> par l'axe de la baie</figcaption></figure>
      </div>` : ''}
      <h2>À l'instant simulé <span>${$('kpiNowLabel')?.textContent ?? ''}</span></h2>
      <div class="kpis rp-kpis">${html('kpis')}</div>
      <h2>Sur la journée <span>${$('kpiDayLabel')?.textContent ?? ''}</span></h2>
      <div class="kpis rp-kpis">${html('kpisDay')}</div>
    </section>

    <section class="rp-page">
      <header class="rp-head">
        <div class="rp-logo">tracés</div>
        <div class="rp-meta">${ctx.title}<br>${ctx.setting}</div>
      </header>
      <h2>En période de canicule <span>25 juillet, ciel clair</span></h2>
      <div class="kpis kpis-heat rp-kpis">${html('kpisHeat')}</div>
      <h2>Chaleur solaire entrant par la fenêtre <span>${$('kpiDayLabel')?.textContent ?? ''}</span></h2>
      <div class="rp-legend"><span><i class="sw sw-2"></i>Sans protection</span><span><i class="sw sw-1"></i>Avec protection</span></div>
      <div class="rp-chart">${html('dayChart')}</div>
      <h2>Au fil de l'année <span>énergie entrant par jour de ciel clair, le 21 de chaque mois</span></h2>
      <div class="rp-chart rp-chart-sm">${html('monthChart')}</div>
      <h2>Comparaison avec les autres protections <span>même fenêtre, même journée</span></h2>
      <div class="cmp-head"><span>Protection</span><span>Rayonnement arrêté</span><span>Lumière</span><span>kWh/j</span></div>
      <div class="rp-cmp">${html('comparison')}</div>
      <div class="rp-cols">
        <div>
          <h2>À retenir</h2>
          <p class="rp-text">${ctx.summary}</p>
          <div class="rp-insights">${html('insights')}</div>
        </div>
        <div>
          <h2>Méthode</h2>
          <p class="rp-text">Position du soleil NOAA, ciel clair ASHRAE (journées sans nuages : enveloppe haute des apports). Ombrage par lancer de rayons sur la géométrie de la baie et de la protection ; apports selon la NF EN ISO 52022-1. F<sub>c</sub> = g<sub>tot</sub> avec / g<sub>tot</sub> sans protection. Porosité : part de la baie libre vue de face. Surchauffe évitée : ordre de grandeur rapporté à l'inertie de la pièce. Hors modèle : masques lointains, météo réelle, ventilation. Outil de comparaison, pas de dimensionnement.</p>
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
      document.title = `Tracés - ${ctx.title} - fiche protection solaire`;
      window.print();
    });
}
