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

/* Fond : une trame fixe de points, traversée lentement par un sillage autonome.
   Le texte n'a pas de fond : les cellules sous les blocs de texte restent vides, et le sillage
   est repoussé par ces zones (champ de distance), si bien qu'il les contourne de lui-même.
   Dessin sur canevas avec un atlas de glyphes, 10 images/s, en pause quand l'onglet est caché.
   Figé (trame seule) sur mobile et quand l'utilisateur réduit les animations. */
(function fond() {
  const cv = document.getElementById('fond');
  const ctx = cv.getContext('2d');
  const CW = 7.2, CH = 14;          /* une cellule = un caractère de 12 px en DM Mono */
  const RAMPE = '·:+';
  const COULEUR = 'rgba(66, 0, 255, .13)';
  const INTERVALLE = 100;
  const MARGE = 1;                  /* cellules laissées libres autour du texte */
  const TEXTE = 'h1, h2, h3, p, dt, dd, .chiffres li, .tags span, .bouton, .date, .client, .spec li, .mail, .coordonnees a, .sommaire li, .visuel, footer span';
  const dpr = Math.min(2, devicePixelRatio || 1);
  const calme = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 640px)');

  let cols = 0, rows = 0, libre, dist, energie, glyphes = {};
  const p = { x: 0, y: 0, vx: .5, vy: .2, cap: 0 };

  function atlas() {
    glyphes = {};
    for (const c of RAMPE) {
      const g = document.createElement('canvas');
      g.width = Math.ceil(CW * dpr); g.height = Math.ceil(CH * dpr);
      const x = g.getContext('2d');
      x.scale(dpr, dpr); x.font = `400 12px 'DM Mono', ui-monospace, monospace`;
      x.textBaseline = 'middle'; x.fillStyle = COULEUR; x.fillText(c, 0, CH / 2);
      glyphes[c] = g;
    }
  }

  function mesurer() {
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    cols = Math.ceil(innerWidth / CW); rows = Math.ceil(innerHeight / CH);
    libre = new Uint8Array(cols * rows); dist = new Float32Array(cols * rows); energie = new Float32Array(cols * rows);
    p.x = cols * .8; p.y = rows * .2;
  }

  /* Masque des zones de texte visibles, puis distance de chaque cellule libre au texte (chanfrein 2 passes). */
  function zones() {
    libre.fill(1);
    for (const el of document.querySelectorAll(TEXTE)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;
      const x0 = Math.max(0, Math.floor(r.left / CW) - MARGE), x1 = Math.min(cols - 1, Math.ceil(r.right / CW) + MARGE);
      const y0 = Math.max(0, Math.floor(r.top / CH) - MARGE), y1 = Math.min(rows - 1, Math.ceil(r.bottom / CH));
      for (let y = y0; y <= y1; y++) libre.fill(0, y * cols + x0, y * cols + x1 + 1);
    }
    const INF = 1e6;
    for (let i = 0; i < dist.length; i++) dist[i] = libre[i] ? INF : 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x; let d = dist[i];
      if (x) d = Math.min(d, dist[i - 1] + 1);
      if (y) d = Math.min(d, dist[i - cols] + 2);   /* une ligne vaut deux colonnes à l'écran */
      dist[i] = d;
    }
    for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x; let d = dist[i];
      if (x < cols - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < rows - 1) d = Math.min(d, dist[i + cols] + 2);
      dist[i] = d;
    }
  }

  const D = (x, y) => dist[Math.min(rows - 1, Math.max(0, Math.round(y))) * cols + Math.min(cols - 1, Math.max(0, Math.round(x)))];

  /* Le sillage erre lentement ; près du texte, il est poussé le long du gradient de distance. */
  function avancer(t) {
    p.cap += Math.sin(t * .37) * .05 + Math.sin(t * .11 + 2) * .03;
    let ax = Math.cos(p.cap) * .06, ay = Math.sin(p.cap) * .03;
    const d = D(p.x, p.y);
    if (d < 10) {
      const gx = D(p.x + 1, p.y) - D(p.x - 1, p.y), gy = D(p.x, p.y + 1) - D(p.x, p.y - 1);
      const n = Math.hypot(gx, gy) || 1, f = (10 - d) / 10 * .25;
      ax += gx / n * f; ay += gy / n * f * .5;
      if (d === 0) { p.x += gx / n * 2; p.y += gy / n; }  /* repoussé hors d'un bloc qui défile vers lui */
    }
    p.vx = (p.vx + ax) * .9; p.vy = (p.vy + ay) * .9;
    const v = Math.hypot(p.vx, p.vy), max = .7;
    if (v > max) { p.vx *= max / v; p.vy *= max / v; }
    p.x += p.vx; p.y += p.vy;
    if (p.x < 2 || p.x > cols - 3) { p.vx *= -1; p.cap = Math.PI - p.cap; p.x = Math.min(cols - 3, Math.max(2, p.x)); }
    if (p.y < 2 || p.y > rows - 3) { p.vy *= -1; p.cap = -p.cap; p.y = Math.min(rows - 3, Math.max(2, p.y)); }

    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x, d2 = (x - p.x) ** 2 + ((y - p.y) * 2) ** 2;
      energie[i] = energie[i] * .93 + (libre[i] ? Math.exp(-d2 / 30) * .12 : 0);
    }
  }

  function dessiner() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!libre[i]) continue;
      const e = energie[i];
      const c = e > .08 ? RAMPE[Math.min(RAMPE.length - 1, Math.floor(e * RAMPE.length))] : (x % 3 === 0 && y % 2 === 0 ? '·' : '');
      if (c) ctx.drawImage(glyphes[c], Math.round(x * CW * dpr), Math.round(y * CH * dpr));
    }
  }

  let aJour = false;  /* les zones de texte sont recalculées au plus une fois par image */
  const invalider = () => { aJour = false; };
  function image(t) {
    if (!aJour) { zones(); aJour = true; }
    if (!calme.matches && !mobile.matches) avancer(t);
    dessiner();
  }

  function demarrer() {
    atlas(); mesurer(); image(0);
    addEventListener('resize', () => { mesurer(); invalider(); image(performance.now() / 1000); });
    addEventListener('scroll', () => { invalider(); if (calme.matches || mobile.matches) requestAnimationFrame(() => image(0)); }, { passive: true });
    document.querySelectorAll('details').forEach(d => d.addEventListener('toggle', invalider));
    let dernier = 0;
    requestAnimationFrame(function boucle(ms) {
      if (!document.hidden && !calme.matches && !mobile.matches && ms - dernier >= INTERVALLE) { dernier = ms; image(ms / 1000); }
      requestAnimationFrame(boucle);
    });
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(demarrer);
})();
