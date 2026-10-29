// Langue de l'interface : français par défaut, anglais sur demande.
// Le choix vient de l'adresse (?lang=en) puis du dernier choix mémorisé.
//
// Dans le code, les textes sont écrits en double : L('texte français', 'English text').
// Dans les pages, un élément traduit porte son texte anglais dans data-en (contenu HTML),
// et éventuellement data-en-aria / data-en-title pour ses attributs.

const params = new URLSearchParams(location.search);
let stored = null;
try { stored = localStorage.getItem('lang'); } catch { /* stockage indisponible */ }

export const LANG = (params.get('lang') || stored) === 'en' ? 'en' : 'fr';
export const LOCALE = LANG === 'en' ? 'en-GB' : 'fr-FR';
export const L = (fr, en) => (LANG === 'en' ? en : fr);

function applyStatic() {
  document.documentElement.lang = LANG;
  if (LANG === 'en') {
    for (const el of document.querySelectorAll('[data-en]')) el.innerHTML = el.dataset.en;
    for (const el of document.querySelectorAll('[data-en-aria]')) el.setAttribute('aria-label', el.dataset.enAria);
    for (const el of document.querySelectorAll('[data-en-title]')) {
      if (el.tagName === 'TITLE') el.textContent = el.dataset.enTitle;
      else el.setAttribute('title', el.dataset.enTitle);
    }
    const meta = document.querySelector('meta[name="description"]');
    if (meta?.dataset.en) meta.setAttribute('content', meta.dataset.en);
    // Les onglets gardent la langue, même sans stockage local
    for (const a of document.querySelectorAll('.tabs a')) a.href = `${a.getAttribute('href')}?lang=en`;
  }
  // Sélecteur de langue : mémorise le choix et recharge en gardant l'état de l'outil
  for (const a of document.querySelectorAll('.lang-switch [data-lang]')) {
    a.setAttribute('aria-current', String(a.dataset.lang === LANG));
    a.addEventListener('click', (e) => {
      e.preventDefault();
      try { localStorage.setItem('lang', a.dataset.lang); } catch { /* stockage indisponible */ }
      const p = new URLSearchParams(location.search);
      if (a.dataset.lang === 'en') p.set('lang', 'en'); else p.delete('lang');
      const q = p.toString();
      location.href = `${location.pathname}${q ? `?${q}` : ''}${location.hash}`;
    });
  }
}
applyStatic();

/** Garde la langue dans les liens partagés (paramètre lang=en). */
export function withLang(params) {
  if (LANG === 'en') params.set('lang', 'en');
  return params;
}
