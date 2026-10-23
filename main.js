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

/* Clic sur l'e-mail : copie l'adresse au lieu d'ouvrir le client mail (repli sur mailto si la copie échoue). */
document.querySelectorAll('[data-copier]').forEach(lien => {
  const indice = lien.querySelector('.indice');
  const initial = indice.textContent;
  lien.addEventListener('click', async e => {
    if (!navigator.clipboard) return;
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

/* Fond ASCII : des signaux superposés qui ondulent lentement, comme des séries de métriques.
   La vague couvre tout l'écran ; ce sont les halos des blocs (CSS) qui dégagent le contenu. */
(function fondAscii() {
  const el = document.getElementById('ascii');
  const RAMPE = ' .·:-=+*#';
  const CHAR_L = 7.2, CHAR_H = 14; /* taille d'un caractère en px (cf. #ascii) */
  const INTERVALLE = 100;          /* 10 images/s sur tous les formats */
  let cols = 0, rows = 0;

  function mesurer() {
    cols = Math.ceil(innerWidth / CHAR_L) + 1;
    rows = Math.ceil(innerHeight / CHAR_H) + 1;
  }

  function signal(x, y, t) {
    return Math.sin(x * 0.09 + y * 0.05 - t * 0.6)
         + Math.sin(x * 0.023 - y * 0.11 + t * 0.35) * 1.2
         + Math.cos((x + y) * 0.04 + Math.sin(t * 0.2) * 1.5) * 0.8;
  }

  function dessiner(t) {
    let out = '';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const n = (signal(x, y, t) + 3) / 6; /* normalisé dans [0, 1] */
        out += RAMPE[Math.max(0, Math.min(RAMPE.length - 1, Math.floor(n * n * RAMPE.length)))];
      }
      out += '\n';
    }
    el.textContent = out;
  }

  mesurer(); dessiner(0);
  addEventListener('resize', () => { mesurer(); dessiner(performance.now() / 1000); });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let dernier = 0;
  requestAnimationFrame(function boucle(ms) {
    if (ms - dernier >= INTERVALLE) { dernier = ms; dessiner(ms / 1000); }
    requestAnimationFrame(boucle);
  });
})();
