/* Tableau de bord en direct : écoute le flux SSE du compteur (serveur/compteur/serveur.js)
   et met à jour les tuiles, le graphique des visites et les Web Vitals. */

const API = document.querySelector('meta[name="tableau-api"]')?.content.trim().replace(/\/$/, '');
const statut = document.querySelector('[data-statut]');
const fmt = new Intl.NumberFormat('fr-FR');

function afficherStatut(etat, texte) {
  statut.dataset.statut = etat;
  statut.querySelector('.statut-texte').textContent = texte;
}

const lire = (objet, chemin) => chemin.split('.').reduce((o, k) => o?.[k], objet);

/* Tuiles : la valeur clignote brièvement quand elle change. */
function majValeurs(d) {
  document.querySelectorAll('[data-valeur]').forEach(el => {
    const v = lire(d, el.dataset.valeur);
    const texte = v == null ? '–' : fmt.format(v);
    if (el.textContent !== texte) {
      const premiere = el.textContent === '–';
      el.textContent = texte;
      if (!premiere) { el.classList.remove('change'); void el.offsetWidth; el.classList.add('change'); }
    }
  });
  const cvJour = d.cv.aujourdhui;
  document.querySelector('[data-valeur-libelle="cv.aujourdhui"]').textContent = cvJour ? `(${fmt.format(cvJour)} aujourd’hui)` : '';
  document.querySelector('[data-depuis]').textContent =
    `Mesures depuis le ${new Date(d.depuis).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/* ---------- Graphique : barres verticales, une série ---------- */

const jourCourt = j => new Date(j + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
const jourLong = j => new Date(j + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const plural = n => `${fmt.format(n)} visite${n > 1 ? 's' : ''}`;

function majGraphique(parJour) {
  const zone = document.querySelector('[data-graphique="visites"]');
  const L = Math.max(280, Math.round(zone.clientWidth || 640)), H = L < 500 ? 160 : 200, haut = 16, bas = 24, ecart = 2;
  const max = Math.max(1, ...parJour.map(p => p.visites));
  const pas = L / parJour.length, largeur = pas - ecart;
  const y = v => H - bas - (v / max) * (H - bas - haut);
  const r = Math.min(4, largeur / 2);
  const pasEtiquette = Math.ceil(64 / pas);      /* une date toutes les ~64 px, alignées sur aujourd’hui */

  const barres = parJour.map((p, i) => {
    const x = i * pas + ecart / 2, top = y(p.visites), h = H - bas - top;
    const forme = h <= 0 ? '' : h < r
      ? `<rect class="barre" x="${x}" y="${top}" width="${largeur}" height="${h}"/>`
      : `<path class="barre" d="M${x},${H - bas} V${top + r} Q${x},${top} ${x + r},${top} H${x + largeur - r} Q${x + largeur},${top} ${x + largeur},${top + r} V${H - bas} Z"/>`;
    const etiquette = (parJour.length - 1 - i) % pasEtiquette === 0
      ? (i === parJour.length - 1
        ? `<text class="axe-texte" x="${x + largeur}" y="${H - 6}" text-anchor="end">${jourCourt(p.jour)}</text>`
        : `<text class="axe-texte" x="${x + largeur / 2}" y="${H - 6}" text-anchor="middle">${jourCourt(p.jour)}</text>`) : '';
    return `<g class="colonne" data-i="${i}">${forme}${etiquette}
      <rect class="cible" x="${i * pas}" y="0" width="${pas}" height="${H - bas}"><title>${jourLong(p.jour)} : ${plural(p.visites)}</title></rect></g>`;
  }).join('');

  zone.innerHTML = `<svg viewBox="0 0 ${L} ${H}" role="img" aria-label="Visites par jour sur 14 jours, maximum ${plural(max)}">
    <line class="grille" x1="0" x2="${L}" y1="${haut}" y2="${haut}"/>
    <text class="axe-texte" x="0" y="${haut - 4}">${fmt.format(max)}</text>
    ${barres}
    <line class="axe" x1="0" x2="${L}" y1="${H - bas}" y2="${H - bas}"/>
  </svg><div class="infobulle" hidden></div>`;

  /* Survol (souris) et toucher : infobulle au-dessus de la colonne. */
  const bulle = zone.querySelector('.infobulle');
  const montrer = g => {
    zone.querySelectorAll('.colonne.active').forEach(c => c.classList.remove('active'));
    if (!g) { bulle.hidden = true; return; }
    g.classList.add('active');
    const p = parJour[g.dataset.i];
    bulle.innerHTML = `<span>${jourLong(p.jour)}</span><strong>${plural(p.visites)}</strong>`;
    bulle.hidden = false;
    const c = g.querySelector('.cible').getBoundingClientRect(), z = zone.getBoundingClientRect();
    const gauche = Math.min(Math.max(c.left - z.left + c.width / 2 - bulle.offsetWidth / 2, 0), z.width - bulle.offsetWidth);
    bulle.style.left = `${gauche}px`;
  };
  zone.querySelectorAll('.colonne').forEach(g => {
    g.addEventListener('pointerenter', () => montrer(g));
    g.addEventListener('click', () => montrer(g));
  });
  zone.querySelector('svg').addEventListener('pointerleave', e => e.pointerType === 'mouse' && montrer(null));

  document.querySelector('[data-table="visites"]').innerHTML =
    parJour.map(p => `<tr><td>${jourLong(p.jour)}</td><td>${fmt.format(p.visites)}</td></tr>`).join('');
}

/* ---------- Web Vitals ---------- */

const VITALS = {
  LCP: { nom: 'Largest Contentful Paint', unite: 'ms' },
  INP: { nom: 'Interaction to Next Paint', unite: 'ms' },
  CLS: { nom: 'Cumulative Layout Shift', unite: '' },
  FCP: { nom: 'First Contentful Paint', unite: 'ms' },
  TTFB: { nom: 'Time to First Byte', unite: 'ms' },
};
const NOTES = {
  good: { icone: '✓', texte: 'Bon' },
  'needs-improvement': { icone: '!', texte: 'À améliorer' },
  poor: { icone: '✕', texte: 'Mauvais' },
};
const formater = (v, unite) => unite === 'ms'
  ? (v >= 1000 ? `${(v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} s` : `${Math.round(v)} ms`)
  : v.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

function majVitals(vitals) {
  document.querySelector('[data-vitals]').innerHTML = Object.entries(VITALS).map(([cle, { nom, unite }]) => {
    const v = vitals[cle];
    const note = v.note && NOTES[v.note];
    return `<li class="vital">
      <span class="vital-nom"><strong>${cle}</strong><span class="discret">${nom}</span></span>
      <span class="vital-valeur">${v.p75 == null ? '–' : formater(v.p75, unite)}</span>
      ${note ? `<span class="note note-${v.note}"><span aria-hidden="true">${note.icone}</span> ${note.texte}</span>` : '<span class="note">Pas encore de mesure</span>'}
      <span class="legende vital-detail">${fmt.format(v.mesures)} mesure${v.mesures > 1 ? 's' : ''} · bon ≤ ${formater(v.seuils[0], unite)}</span>
    </li>`;
  }).join('');
}

let dernier = null;
function afficher(d) {
  dernier = d;
  majValeurs(d);
  majGraphique(d.visites.parJour);
  majVitals(d.vitals);
}

/* Le graphique est dessiné à la largeur réelle : texte lisible sur mobile comme sur grand écran. */
let largeurGraphique = 0;
new ResizeObserver(([e]) => {
  const l = Math.round(e.contentRect.width);
  if (dernier && Math.abs(l - largeurGraphique) > 8) majGraphique(dernier.visites.parJour);
  largeurGraphique = l;
}).observe(document.querySelector('[data-graphique="visites"]'));

/* ---------- Connexion ---------- */

if (!API) {
  afficherStatut('erreur', 'Serveur du tableau de bord non configuré');
} else if ('EventSource' in window) {
  const flux = new EventSource(`${API}/api/direct`);
  flux.onopen = () => afficherStatut('direct', 'En direct');
  flux.onmessage = e => { afficherStatut('direct', 'En direct'); afficher(JSON.parse(e.data)); };
  flux.onerror = () => afficherStatut('connexion', 'Reconnexion…');
} else {
  const charger = () => fetch(`${API}/api/etat`).then(r => r.json()).then(d => { afficherStatut('direct', 'Mis à jour toutes les 10 s'); afficher(d); })
    .catch(() => afficherStatut('erreur', 'Serveur injoignable'));
  charger(); setInterval(charger, 10e3);
}

/* Retour immédiat au clic, en attendant la valeur confirmée par le serveur. */
document.querySelectorAll('[data-compteur]').forEach(bouton => bouton.addEventListener('click', () => {
  const el = document.querySelector('[data-valeur="bouton.total"]');
  const n = Number(el.textContent.replace(/\D/g, ''));
  if (el.textContent !== '–') el.textContent = fmt.format(n + 1);
}));
