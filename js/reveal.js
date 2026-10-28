// Apparitions au défilement et texte du manifeste révélé mot à mot.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Blocs qui apparaissent en entrant dans l'écran
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    }
  }
}, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
for (const el of document.querySelectorAll('.reveal')) io.observe(el);

// Manifeste : chaque mot passe du gris au noir à mesure que le paragraphe remonte
for (const p of document.querySelectorAll('[data-scrub]')) {
  const words = p.textContent.trim().split(/\s+/);
  p.textContent = '';
  const spans = words.map((w, i) => {
    const s = document.createElement('span');
    s.className = 'w';
    s.textContent = w;
    p.appendChild(s);
    if (i < words.length - 1) p.appendChild(document.createTextNode(' '));
    return s;
  });
  if (reduce) continue;

  let ticking = false;
  const update = () => {
    ticking = false;
    const r = p.getBoundingClientRect();
    const vh = window.innerHeight;
    // 0 quand le haut du texte est aux 85 % de l'écran, 1 quand le bas atteint 45 %
    const start = vh * 0.85;
    const end = vh * 0.45;
    const progress = (start - r.top) / (start - end + r.height);
    const n = Math.round(Math.max(0, Math.min(1, progress)) * spans.length);
    spans.forEach((s, i) => s.classList.toggle('on', i < n));
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}
