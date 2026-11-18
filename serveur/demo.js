/* Données de démonstration pour le développement local : envoie au serveur (donc au vrai Collector)
   des traces OTLP JSON telles qu'un navigateur les produirait, réparties sur 14 jours.
   Usage : node serveur/demo.js [http://127.0.0.1:8790] */

'use strict';
const BASE = (process.argv[2] || 'http://127.0.0.1:8790').replace(/\/$/, '');
const JOUR = 864e5;

/* Tirage reproductible, pour des captures stables d'un lancement à l'autre. */
let graine = 7;
const alea = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
const entre = (a, b) => a + alea() * (b - a);
const id = n => Array.from({ length: n }, () => Math.floor(alea() * 16).toString(16)).join('');

const attr = (key, v) => ({ key, value: typeof v === 'number'
  ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : { stringValue: String(v) } });

function span(nom, t, attributs = {}) {
  const ns = String(BigInt(Math.round(t)) * 1000000n);
  return { traceId: id(32), spanId: id(16), name: nom, kind: 1, startTimeUnixNano: ns, endTimeUnixNano: ns,
    attributes: Object.entries(attributs).map(([k, v]) => attr(k, v)) };
}

/* Une visite : chargement de page, Web Vitals, parfois un téléchargement du CV ou un clic sur le compteur. */
function visite(t) {
  const page = { 'url.path': '/victor.marti/' };
  const spans = [span('documentLoad', t, page)];
  const lcp = entre(900, 2600) * (alea() < 0.1 ? 1.8 : 1);
  spans.push(
    span('web-vital', t + 1500, { ...page, 'web_vital.name': 'LCP', 'web_vital.value': lcp }),
    span('web-vital', t + 1200, { ...page, 'web_vital.name': 'FCP', 'web_vital.value': lcp * entre(0.55, 0.8) }),
    span('web-vital', t + 300, { ...page, 'web_vital.name': 'TTFB', 'web_vital.value': entre(40, 420) }),
    span('web-vital', t + 9e4, { ...page, 'web_vital.name': 'CLS', 'web_vital.value': alea() < 0.8 ? entre(0, 0.04) : entre(0.05, 0.16) }),
    span('web-vital', t + 9e4, { ...page, 'web_vital.name': 'INP', 'web_vital.value': entre(40, 260) }),
  );
  if (alea() < 0.12) spans.push(span('click', t + 4e4, { ...page, 'url.full': 'https://vtnk7.github.io/victor.marti/Victor_Marti_CV.pdf' }));
  if (alea() < 0.2) spans.push(span('bouton.compteur', t + 5e4, page));
  return spans;
}

(async () => {
  const maintenant = Date.now();
  let total = 0;
  for (let j = 13; j >= 0; j--) {
    const tendance = 18 + (13 - j) * 1.6;                       /* trafic en hausse sur la période */
    const n = Math.round(tendance * entre(0.6, 1.3) * ([0, 6].includes(new Date(maintenant - j * JOUR).getDay()) ? 0.5 : 1));
    const spans = [];
    for (let i = 0; i < n; i++) {
      const debut = j === 0 ? maintenant - entre(0, 3 * 3600e3) : maintenant - j * JOUR + entre(-4, 4) * 3600e3;
      spans.push(...visite(Math.min(debut, maintenant - 2e5)));
    }
    /* Comme un vrai navigateur : un lot (une ressource) par visite. */
    for (let i = 0; i < spans.length; i += 7) {
      const lot = { resourceSpans: [{ resource: { attributes: [attr('service.name', 'victor-marti-site'), attr('browser.language', 'fr-FR')] },
        scopeSpans: [{ scope: { name: 'demo' }, spans: spans.slice(i, i + 7) }] }] };
      const r = await fetch(`${BASE}/v1/traces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lot) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }
    total += n;
  }
  console.log(`Démo : ${total} visites fictives envoyées sur 14 jours.`);
})().catch(e => { console.error('Démo impossible :', e.message); process.exit(1); });
