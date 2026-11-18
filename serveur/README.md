# Serveur du tableau de bord en direct

```
navigateur ──OTLP/HTTP──▶ serveur.js (alwaysdata) ──▶ OpenTelemetry Collector ──▶ Dash0
                                 ▲                              │
tableau-de-bord.html ◀──SSE──────┴──── métriques agrégées ◀─────┘
```

- `serveur.js` : seul processus du site alwaysdata. Il lance le Collector, relaie `/v1/traces`,
  calcule les métriques et les sert sur `/api/etat` (JSON) et `/api/direct` (Server-Sent Events).
- `otelcol.yaml` : configuration du Collector (deux pipelines : Dash0 et le compteur local).
- `mettre-a-jour.sh` : tâche planifiée qui clone/met à jour ce dépôt et télécharge le Collector officiel.

## Installation sur alwaysdata (offre gratuite, sans carte)

1. Créer un compte sur alwaysdata.com. Le nom du compte donne l'adresse : `https://[compte].alwaysdata.net`.
2. **Avancé › Tâches planifiées › Ajouter** :
   - type *Commande*, toutes les 5 minutes ;
   - commande :
     ```
     bash -c 'test -d ~/site || git clone -q https://github.com/VTNK7/victor.marti ~/site; bash ~/site/serveur/mettre-a-jour.sh'
     ```
3. **Web › Sites › Ajouter un site** :
   - adresse : `[compte].alwaysdata.net` ;
   - type : *Node.js* ;
   - commande : `node /home/[compte]/site/serveur/serveur.js` ;
   - répertoire de travail : `/home/[compte]/site/serveur` ;
   - variables d'environnement : `DASH0_TOKEN=…` (jeton Dash0 limité à l'ingestion) ;
   - dans *Avancé*, monter la *durée d'inactivité* au maximum : le site s'arrête sans requête pendant ce délai
     et redémarre à la requête suivante (les compteurs sont sauvegardés sur disque).
4. Vérifier : `https://[compte].alwaysdata.net/api/sante` répond `ok` (après le premier passage de la tâche).
5. Dans `index.html` et `tableau-de-bord.html`, renseigner :
   - `otel-endpoint` : `https://[compte].alwaysdata.net/v1/traces` ;
   - `tableau-api` : `https://[compte].alwaysdata.net` ;
   - et supprimer `otel-headers` (le jeton est désormais côté serveur).

Les mises à jour poussées sur `main` sont appliquées en 5 minutes au plus : la tâche récupère le code
et `serveur.js` redémarre de lui-même.

## Développer en local (sans backend en ligne)

```
serveur/local.sh --demo
```

- télécharge le Collector officiel pour la machine (Linux ou macOS) dans `serveur/.local/` ;
- lance le serveur et le Collector sur http://localhost:8790, et le site sur http://localhost:8000 ;
- `--demo` injecte 14 jours de visites fictives (via le Collector, comme un vrai navigateur).

Ouvrir http://localhost:8000/tableau-de-bord.html. Les pages servies depuis `localhost` envoient
automatiquement leurs traces au serveur local ; sans `DASH0_TOKEN`, le Collector utilise
`otelcol-local.yaml` (pas d'export vers Dash0). Node.js ≥ 18 et Python 3 sont nécessaires.
