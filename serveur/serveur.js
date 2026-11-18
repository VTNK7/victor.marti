/* Serveur du tableau de bord en direct (hébergé sur alwaysdata, site de type « Programme utilisateur »).

   Un seul processus, lancé et relancé par alwaysdata à la demande :
   - il démarre l'OpenTelemetry Collector (binaire otelcol + otelcol.yaml) en processus enfant ;
   - il expose sur $IP:$PORT (HTTPS assuré par alwaysdata) :
       POST /v1/traces  → relayé tel quel au Collector (qui gère le CORS) ;
       GET  /api/etat   → métriques agrégées (JSON) ;
       GET  /api/direct → les mêmes, en direct (Server-Sent Events) ;
   - il reçoit en retour, sur un port local, les traces que le Collector lui exporte (OTLP/HTTP JSON)
     et en tire les compteurs : visites, Web Vitals, téléchargements du CV, bouton compteur.

   Aucune donnée individuelle n'est conservée : des compteurs et des valeurs de Web Vitals horodatées.
   Node ≥ 18, sans dépendance. */

'use strict';
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IP = process.env.IP || '127.0.0.1';
const PORT = Number(process.env.PORT || 8080);
const RACINE = process.env.DOSSIER_DONNEES || path.join(process.env.HOME || __dirname, 'site-donnees');
const OTELCOL = process.env.OTELCOL_BIN || path.join(RACINE, 'otelcol');
const FICHIER_ETAT = path.join(RACINE, 'etat.json');
const FICHIER_REDEMARRAGE = path.join(RACINE, 'redemarrer');   /* touché par mettre-a-jour.sh */
const SERVICE = 'victor-marti-site';
const FUSEAU = 'Europe/Paris';
fs.mkdirSync(RACINE, { recursive: true });

const JOURS_HISTORIQUE = 30;          /* visites par jour conservées */
const JOURS_VITALS = 7;               /* fenêtre des percentiles Web Vitals */
const MAX_VITALS = 5000;              /* valeurs gardées par métrique */
const FENETRE_DIRECT = 5 * 60e3;      /* « en ce moment » = pages vues sur 5 minutes */
const MAX_PAR_LOT = 50;               /* garde-fou : incréments retenus par lot de navigateur et par compteur */
const MAX_CLIENTS = 200;              /* connexions SSE simultanées */

/* Seuils officiels des Web Vitals (bon ≤ s[0] < à améliorer ≤ s[1] < mauvais). */
const SEUILS = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };

/* ---------- État persistant ---------- */

const etatVide = () => ({
  visites: { total: 0, parJour: {} },
  cv: { total: 0, parJour: {} },
  bouton: { total: 0 },
  vitals: Object.fromEntries(Object.keys(SEUILS).map(n => [n, []])),  /* [[horodatage ms, valeur], …] */
  depuis: Date.now(),
});

let etat = etatVide();
try {
  const lu = JSON.parse(fs.readFileSync(FICHIER_ETAT, 'utf8'));
  etat = { ...etat, ...lu, vitals: { ...etat.vitals, ...lu.vitals } };
} catch (e) {
  if (e.code !== 'ENOENT') console.error('État illisible, on repart de zéro :', e.message);
}
let pagesRecentes = [];                /* horodatages des pages vues récentes (mémoire seulement) */
let modifie = false;

function sauvegarder() {
  if (!modifie) return;
  modifie = false;
  const tmp = FICHIER_ETAT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(etat));
  fs.renameSync(tmp, FICHIER_ETAT);
}
setInterval(sauvegarder, 10e3).unref();

const jour = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE', { timeZone: FUSEAU }); /* AAAA-MM-JJ */

function incrementer(compteur, n, t) {
  if (!n) return;
  compteur.total += n;
  if (compteur.parJour) compteur.parJour[jour(t)] = (compteur.parJour[jour(t)] || 0) + n;
  modifie = true;
}

function elaguer() {
  const limite = jour(Date.now() - JOURS_HISTORIQUE * 864e5);
  for (const c of [etat.visites, etat.cv]) {
    for (const j of Object.keys(c.parJour)) if (j < limite) delete c.parJour[j];
  }
  const ancien = Date.now() - JOURS_VITALS * 864e5;
  for (const [nom, valeurs] of Object.entries(etat.vitals)) {
    etat.vitals[nom] = valeurs.filter(([t]) => t >= ancien).slice(-MAX_VITALS);
  }
  pagesRecentes = pagesRecentes.filter(t => t >= Date.now() - FENETRE_DIRECT);
}

/* ---------- Lecture OTLP JSON ---------- */

/* Valeur d'un attribut OTLP JSON : les entiers 64 bits arrivent en chaîne. */
function valeur(v = {}) {
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('boolValue' in v) return v.boolValue;
  return undefined;
}
const attributs = liste => Object.fromEntries((liste || []).map(a => [a.key, valeur(a.value)]));

function traiter(otlp) {
  let change = false;
  /* Le Collector regroupe plusieurs navigateurs dans un même envoi : le garde-fou anti-abus
     s'applique donc par ressource (= un lot d'un navigateur), pas par requête. */
  for (const rs of otlp.resourceSpans || []) {
    if (attributs(rs.resource?.attributes)['service.name'] !== SERVICE) continue;
    const n = { visites: 0, cv: 0, bouton: 0 };
    let tVisite = Date.now(), tCv = Date.now();
    for (const ss of rs.scopeSpans || []) {
      for (const span of ss.spans || []) {
        const a = attributs(span.attributes);
        const t = Math.min(Number(BigInt(span.startTimeUnixNano || 0) / 1000000n) || Date.now(), Date.now());
        switch (span.name) {
          case 'documentLoad':
            n.visites++; tVisite = t;
            if (Date.now() - t < FENETRE_DIRECT) pagesRecentes.push(t);
            break;
          case 'click':
            if (/\.pdf$/i.test(String(a['url.full'] || ''))) { n.cv++; tCv = t; }
            break;
          case 'bouton.compteur':
            n.bouton++;
            break;
          case 'web-vital': {
            const nom = a['web_vital.name'], v = Number(a['web_vital.value']);
            if (etat.vitals[nom] && Number.isFinite(v) && v >= 0) { etat.vitals[nom].push([t, v]); change = modifie = true; }
            break;
          }
        }
      }
    }
    incrementer(etat.visites, Math.min(n.visites, MAX_PAR_LOT), tVisite);
    incrementer(etat.cv, Math.min(n.cv, MAX_PAR_LOT), tCv);
    incrementer(etat.bouton, Math.min(n.bouton, MAX_PAR_LOT));
    change ||= n.visites + n.cv + n.bouton > 0;
  }
  if (change) diffuser();
}

/* ---------- Vue publique ---------- */

function p75(valeurs) {
  if (!valeurs.length) return null;
  const tri = valeurs.map(([, v]) => v).sort((a, b) => a - b);
  return tri[Math.min(tri.length - 1, Math.ceil(0.75 * tri.length) - 1)];
}
const note = (nom, v) => v == null ? null : v <= SEUILS[nom][0] ? 'good' : v <= SEUILS[nom][1] ? 'needs-improvement' : 'poor';

function vuePublique() {
  elaguer();
  const aujourdhui = jour();
  const parJour = [];
  for (let i = 13; i >= 0; i--) {
    const j = jour(Date.now() - i * 864e5);
    parJour.push({ jour: j, visites: etat.visites.parJour[j] || 0 });
  }
  return {
    maj: new Date().toISOString(),
    depuis: new Date(etat.depuis).toISOString(),
    visites: {
      total: etat.visites.total,
      aujourdhui: etat.visites.parJour[aujourdhui] || 0,
      enCeMoment: pagesRecentes.length,
      parJour,
    },
    cv: { total: etat.cv.total, aujourdhui: etat.cv.parJour[aujourdhui] || 0 },
    bouton: { total: etat.bouton.total },
    vitals: Object.fromEntries(Object.keys(SEUILS).map(nom => {
      const v = p75(etat.vitals[nom]);
      return [nom, { p75: v, note: note(nom, v), mesures: etat.vitals[nom].length, seuils: SEUILS[nom] }];
    })),
  };
}

/* ---------- Diffusion SSE ---------- */

const clients = new Set();
let diffusionPrevue = null;
function diffuser() {
  if (diffusionPrevue) return;
  diffusionPrevue = setTimeout(() => {          /* regroupe les rafales (au plus ~3 envois par seconde) */
    diffusionPrevue = null;
    const message = `data: ${JSON.stringify(vuePublique())}\n\n`;
    for (const res of clients) res.write(message);
  }, 300);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25e3).unref();
setInterval(() => {                              /* « en ce moment » décroît même sans trafic */
  const avant = pagesRecentes.length;
  pagesRecentes = pagesRecentes.filter(t => t >= Date.now() - FENETRE_DIRECT);
  if (pagesRecentes.length !== avant) diffuser();
}, 15e3).unref();

/* ---------- Serveurs HTTP ---------- */

const MAX_CORPS = 1 << 20;
const portLibre = () => new Promise((ok, ko) => {
  const srv = net.createServer().once('error', ko).listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => ok(port)); });
});

/* Réception des traces exportées par le Collector (port local choisi au démarrage). */
const ingestion = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/traces') { res.writeHead(404).end(); return; }
  if (!String(req.headers['content-type']).startsWith('application/json')) { res.writeHead(415).end(); return; }
  const morceaux = []; let taille = 0;
  req.on('data', m => { taille += m.length; if (taille > MAX_CORPS) req.destroy(); else morceaux.push(m); });
  req.on('end', () => {
    try { traiter(JSON.parse(Buffer.concat(morceaux).toString('utf8'))); }
    catch { res.writeHead(400).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });
});

let portCollector = null;

/* Relais transparent vers le Collector : méthode, en-têtes (CORS compris) et corps tels quels. */
function relayer(req, res) {
  if (!portCollector) { res.writeHead(503).end(); return; }
  const amont = http.request({ host: '127.0.0.1', port: portCollector, method: req.method, path: '/v1/traces',
    headers: { ...req.headers, host: `127.0.0.1:${portCollector}` } }, rep => {
    res.writeHead(rep.statusCode, rep.headers);
    rep.pipe(res);
  });
  amont.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(amont);
}

const public_ = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/v1/traces') { relayer(req, res); return; }

  const entetes = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  if (req.method === 'OPTIONS') { res.writeHead(204, entetes).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, entetes).end(); return; }

  if (url === '/api/etat') {
    res.writeHead(200, { ...entetes, 'Content-Type': 'application/json' }).end(JSON.stringify(vuePublique()));
  } else if (url === '/api/direct') {
    if (clients.size >= MAX_CLIENTS) { res.writeHead(503, entetes).end(); return; }
    res.writeHead(200, { ...entetes, 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 3000\ndata: ${JSON.stringify(vuePublique())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  } else if (url === '/api/sante') {
    res.writeHead(portCollector ? 200 : 503, { ...entetes, 'Content-Type': 'text/plain' }).end(portCollector ? 'ok' : 'collector absent');
  } else {
    res.writeHead(302, { Location: 'https://vtnk7.github.io/victor.marti/tableau-de-bord.html' }).end();
  }
});

/* ---------- Collector en processus enfant ---------- */

let collector = null, arret = false;
async function demarrerCollector(portCompteur) {
  if (!fs.existsSync(OTELCOL)) { console.error(`Collector introuvable (${OTELCOL}) : lancer mettre-a-jour.sh`); return; }
  const port = await portLibre();
  /* Sans jeton Dash0 (développement local), configuration réduite au seul tableau de bord. */
  const config = process.env.DASH0_TOKEN ? 'otelcol.yaml' : 'otelcol-local.yaml';
  collector = spawn(OTELCOL, ['--config', path.join(__dirname, config)], {
    env: { ...process.env, PORT_COLLECTOR: String(port), PORT_COMPTEUR: String(portCompteur) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  collector.on('exit', code => {
    portCollector = null;
    if (arret) return;
    console.error(`Collector arrêté (code ${code}), relance dans 5 s`);
    setTimeout(() => demarrerCollector(portCompteur), 5e3);
  });
  /* Prêt quand son port HTTP répond. */
  for (let i = 0; i < 50 && !portCollector && collector.exitCode == null; i++) {
    await new Promise(r => setTimeout(r, 200));
    await new Promise(r => net.connect(port, '127.0.0.1').once('connect', function () { this.end(); portCollector = port; r(); }).once('error', r));
  }
}

function quitter() {
  arret = true;
  sauvegarder();
  for (const res of clients) res.end();
  collector?.kill('SIGTERM');
  setTimeout(() => process.exit(0), 300).unref();
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, quitter);

/* Mise à jour : mettre-a-jour.sh touche ce fichier ; on quitte, alwaysdata relance à la requête suivante. */
const versionAuDemarrage = (() => { try { return fs.statSync(FICHIER_REDEMARRAGE).mtimeMs; } catch { return 0; } })();
setInterval(() => {
  let v = 0; try { v = fs.statSync(FICHIER_REDEMARRAGE).mtimeMs; } catch {}
  if (v > versionAuDemarrage) { console.log('Nouvelle version déployée : redémarrage'); quitter(); }
}, 30e3).unref();

ingestion.listen(0, '127.0.0.1', () => {
  const portCompteur = ingestion.address().port;
  public_.listen(PORT, IP, () => console.log(`Tableau de bord : http://${IP}:${PORT}, état dans ${FICHIER_ETAT}`));
  demarrerCollector(portCompteur);
});
