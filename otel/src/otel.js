/* Instrumentation OpenTelemetry du site (navigateur uniquement).

   Configuration dans le <head> de chaque page :
     <meta name="otel-endpoint" content="https://…/v1/traces">   URL OTLP/HTTP complète des traces
     <meta name="otel-headers"  content="clé=valeur,clé2=valeur2"> optionnel ; visible de tous, n'y mettre
                                                                   qu'un jeton limité à l'ingestion

   Sans endpoint, rien ne s'initialise. Respect de la vie privée :
   - aucun cookie, aucun stockage local, aucun identifiant de visiteur ou de session persistant ;
   - désactivé si le navigateur envoie Global Privacy Control ou Do Not Track, et pour les robots (webdriver) ;
   - les URL sont envoyées sans query string ni fragment.

   Signaux produits (traces uniquement) :
   - chargement de la page (instrumentation document-load : DNS, TTFB, ressources…) ;
   - Web Vitals (LCP, INP, CLS, FCP, TTFB), un span « web-vital » par mesure ;
   - clics sur les liens et boutons, un span « click » ;
   - erreurs JavaScript non gérées, un span « exception ».

   Construire : cd otel && npm ci && npm run build   → génère ../otel.js */

import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { TracerProvider, BatchSpanProcessor, StackContextManager } from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';

const SERVICE = 'victor-marti-site';
const meta = nom => document.querySelector(`meta[name="${nom}"]`)?.content.trim() ?? '';

/* URL sans query string ni fragment (peuvent contenir des données personnelles). */
const sansRequete = url => {
  try { const u = new URL(url, location.href); return u.protocol.startsWith('http') ? u.origin + u.pathname : u.protocol; }
  catch { return ''; }
};

const refus = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || navigator.webdriver;
const endpoint = meta('otel-endpoint');

if (endpoint && !refus) {
  const headers = Object.fromEntries(meta('otel-headers').split(',')
    .map(paire => { const i = paire.indexOf('='); return [paire.slice(0, i).trim(), paire.slice(i + 1).trim()]; })
    .filter(([k, v]) => k && v));

  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      'service.name': SERVICE,
      'deployment.environment.name': /^(localhost|127\.|\[::1\])/.test(location.hostname) ? 'dev' : 'prod',
      'browser.language': navigator.language,
      'browser.mobile': matchMedia('(pointer: coarse)').matches,
      'user_agent.original': navigator.userAgent,
    }),
    spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: endpoint, headers }) })],
  });
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new StackContextManager().enable());

  registerInstrumentations({
    instrumentations: [new DocumentLoadInstrumentation({
      applyCustomAttributesOnSpan: {
        documentLoad: span => span.setAttribute('url.full', sansRequete(location.href)),
        documentFetch: span => span.setAttribute('url.full', sansRequete(location.href)),
        resourceFetch: (span, ressource) => span.setAttribute('url.full', sansRequete(ressource.name)),
      },
    })],
  });

  const tracer = trace.getTracer(SERVICE);
  const page = { 'url.path': location.pathname, 'document.title': document.title };

  /* Web Vitals : une mesure = un span, valeur et note en attributs. */
  const vital = m => tracer.startSpan('web-vital', { attributes: {
    ...page,
    'web_vital.name': m.name,
    'web_vital.value': m.value,
    'web_vital.rating': m.rating,
    'web_vital.navigation_type': m.navigationType,
  } }).end();
  [onCLS, onFCP, onINP, onLCP, onTTFB].forEach(on => on(vital));

  /* Clics sur les éléments interactifs (phase de capture : vu avant tout preventDefault). */
  document.addEventListener('click', e => {
    const el = e.target instanceof Element && e.target.closest('a, button, summary, [role="button"]');
    if (!el) return;
    const libelle = (el.getAttribute('aria-label') || el.dataset.indice || el.textContent)
      .replace(/\s+/g, ' ').trim().slice(0, 80);
    const attributs = { ...page, 'ui.element.tag': el.tagName.toLowerCase(), 'ui.element.label': libelle };
    if (el.id) attributs['ui.element.id'] = el.id;
    const href = el.getAttribute('href');
    if (href) attributs['url.full'] = sansRequete(href);
    tracer.startSpan('click', { attributes: attributs }).end();
  }, { capture: true, passive: true });

  /* Erreurs non gérées. */
  const exception = (erreur, message) => {
    const span = tracer.startSpan('exception', { attributes: page });
    span.recordException(erreur instanceof Error ? erreur : { name: 'Error', message: String(message ?? erreur) });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(erreur?.message ?? message ?? erreur).slice(0, 200) });
    span.end();
  };
  addEventListener('error', e => exception(e.error, e.message));
  addEventListener('unhandledrejection', e => exception(e.reason));

  /* Le BatchSpanProcessor vide déjà sa file quand la page passe en arrière-plan ;
     pagehide couvre en plus la fermeture d'onglet. */
  addEventListener('pagehide', () => provider.forceFlush());
}
