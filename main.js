const DUREE_RETOUR = 1800; /* ms avant de rétablir le libellé après une copie */

/* Copie un texte puis affiche un retour temporaire sur l'élément.
   `afficher(texte)` met à jour le libellé ; il est rétabli à `initial` après DUREE_RETOUR. */
async function copierAvecRetour(el, texte, { afficher, initial, succes, echec }) {
  let ok = true;
  try { await navigator.clipboard.writeText(texte); } catch { ok = false; }
  afficher(ok ? succes : echec);
  el.classList.add('copie');
  setTimeout(() => { el.classList.remove('copie'); afficher(initial); }, DUREE_RETOUR);
  return ok;
}

/* Copier le CV : le Markdown est embarqué dans la page pour fonctionner aussi en local (file://). */
const cvMarkdown = document.getElementById('cv-md').textContent.trim() + '\n';
document.querySelectorAll('.copier-cv').forEach(bouton => {
  const initial = bouton.dataset.indice;
  bouton.addEventListener('click', () => copierAvecRetour(bouton, cvMarkdown, {
    afficher: t => { bouton.dataset.indice = t; },
    initial, succes: 'CV copié (.md)', echec: 'Copie impossible',
  }));
});

/* Clic sur l'e-mail : copie l'adresse au lieu d'ouvrir le client mail (repli sur mailto si la copie échoue).
   Sur écran tactile, on laisse le mailto ouvrir l'appli mail. */
const tactile = matchMedia('(pointer: coarse)');
document.querySelectorAll('[data-copier]').forEach(lien => {
  const indice = lien.querySelector('.indice');
  const initial = indice.textContent;
  lien.addEventListener('click', async e => {
    if (!navigator.clipboard || tactile.matches) return;
    e.preventDefault();
    const ok = await copierAvecRetour(lien, lien.dataset.copier, {
      afficher: t => { indice.textContent = t; },
      initial, succes: 'Copié', echec: initial,
    });
    if (!ok) location.href = lien.href;
  });
});

/* Prise de rendez-vous : popup Calendly, chargée seulement au premier clic (aucun cookie tiers avant).
   Repli sur un nouvel onglet si le script ne se charge pas. */
function chargerCalendly() {
  chargerCalendly.promesse ??= new Promise(resolve => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://assets.calendly.com/assets/external/widget.css' });
    const js = Object.assign(document.createElement('script'), { src: 'https://assets.calendly.com/assets/external/widget.js' });
    js.onload = js.onerror = resolve;
    document.head.append(css, js);
  });
  return chargerCalendly.promesse;
}
document.querySelectorAll('[data-rdv]').forEach(lien => {
  lien.addEventListener('click', async e => {
    e.preventDefault();
    await chargerCalendly();
    if (window.Calendly) Calendly.initPopupWidget({ url: lien.href });
    else window.open(lien.href, '_blank', 'noopener');
  });
});

/* Sommaire : souligne la section visible, et les touches 1, 2, 3 y mènent (hors champ de saisie). */
(function sommaire() {
  const liens = [...document.querySelectorAll('.sommaire a')];
  const cible = lien => document.querySelector(lien.getAttribute('href'));
  const observateur = new IntersectionObserver(entrees => {
    entrees.filter(e => e.isIntersecting).forEach(e => {
      liens.forEach(l => l.toggleAttribute('aria-current', cible(l) === e.target));
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  liens.forEach(l => observateur.observe(cible(l)));
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, [contenteditable]')) return;
    const lien = liens.find(l => l.dataset.touche === e.key);
    if (lien) cible(lien).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
})();

/* Missions : dépliables sur mobile, toujours ouvertes sur grand écran. */
(function missions() {
  const grandEcran = matchMedia('(min-width: 641px)');
  const details = [...document.querySelectorAll('.detail')];
  const maj = () => { if (grandEcran.matches) details.forEach(d => { d.open = true; }); };
  details.forEach(d => d.querySelector('summary').addEventListener('click', e => {
    if (grandEcran.matches) e.preventDefault();
  }));
  grandEcran.addEventListener('change', maj);
  maj();
})();

/* Fond ASCII : des signaux superposés qui ondulent lentement, comme des séries de métriques.
   Le texte n'a ni fond ni flou : les cases situées sous un bloc de texte restent simplement vides.
   Dessin sur canevas avec un atlas de glyphes (pas de texte réécrit à chaque image), 10 images/s,
   en pause quand l'onglet est caché ; figé sur mobile et quand l'utilisateur réduit les animations. */
(function fondAscii() {
  const cv = document.getElementById('fond');
  const ctx = cv.getContext('2d');
  const RAMPE = ' .·:-=+*#';
  const CW = 7.2, CH = 14;          /* une case = un caractère de 12 px en DM Mono */
  const COULEUR = 'rgba(66, 0, 255, .07)';
  const INTERVALLE = 100;
  const MARGE = 1;                  /* cases laissées vides autour du texte */
  const TEXTE = 'h1, h2, h3, p, dt, dd, .chiffres li, .tags span, .bouton, .date, .client, .spec li, .mail, .coordonnees a, .sommaire li, .visuel, footer span';
  const dpr = Math.min(2, devicePixelRatio || 1);
  const calme = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 640px)');
  let cols = 0, rows = 0, libre, glyphes = [];

  function atlas() {
    glyphes = [...RAMPE].map(c => {
      const g = document.createElement('canvas');
      g.width = Math.ceil(CW * dpr); g.height = Math.ceil(CH * dpr);
      const x = g.getContext('2d');
      x.scale(dpr, dpr); x.font = `400 12px 'DM Mono', ui-monospace, monospace`;
      x.textBaseline = 'middle'; x.fillStyle = COULEUR; x.fillText(c, 0, CH / 2);
      return g;
    });
  }

  function mesurer() {
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    cols = Math.ceil(innerWidth / CW); rows = Math.ceil(innerHeight / CH);
    libre = new Uint8Array(cols * rows);
  }

  /* Masque des cases couvertes par du texte visible. */
  function zones() {
    libre.fill(1);
    for (const el of document.querySelectorAll(TEXTE)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;
      const x0 = Math.max(0, Math.floor(r.left / CW) - MARGE), x1 = Math.min(cols - 1, Math.ceil(r.right / CW) + MARGE);
      const y0 = Math.max(0, Math.floor(r.top / CH) - MARGE), y1 = Math.min(rows - 1, Math.ceil(r.bottom / CH));
      for (let y = y0; y <= y1; y++) libre.fill(0, y * cols + x0, y * cols + x1 + 1);
    }
  }

  function signal(x, y, t) {
    return Math.sin(x * 0.09 + y * 0.05 - t * 0.6)
         + Math.sin(x * 0.023 - y * 0.11 + t * 0.35) * 1.2
         + Math.cos((x + y) * 0.04 + Math.sin(t * 0.2) * 1.5) * 0.8;
  }

  function dessiner(t) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!libre[y * cols + x]) continue;
      const n = (signal(x, y, t) + 3) / 6; /* normalisé dans [0, 1] */
      const k = Math.max(0, Math.min(RAMPE.length - 1, Math.floor(n * n * RAMPE.length)));
      if (k) ctx.drawImage(glyphes[k], Math.round(x * CW * dpr), Math.round(y * CH * dpr));
    }
  }

  let aJour = false, t = 0;  /* le masque est recalculé au plus une fois par image */
  const image = () => { if (!aJour) { zones(); aJour = true; } dessiner(t); };
  const anime = () => !calme.matches && !mobile.matches;

  function demarrer() {
    atlas(); mesurer(); image();
    addEventListener('resize', () => { mesurer(); aJour = false; image(); });
    addEventListener('scroll', () => { aJour = false; if (!anime()) requestAnimationFrame(image); }, { passive: true });
    document.querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => { aJour = false; if (!anime()) image(); }));
    let dernier = 0;
    requestAnimationFrame(function boucle(ms) {
      if (anime() && !document.hidden && ms - dernier >= INTERVALLE) { dernier = ms; t = ms / 1000; image(); }
      requestAnimationFrame(boucle);
    });
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(demarrer);
})();
