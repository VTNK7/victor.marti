#!/bin/bash
# Tâche planifiée alwaysdata (toutes les 5 minutes) : installe puis tient à jour le serveur du tableau de bord.
#   - clone ou met à jour le dépôt (branche main) dans ~/site ;
#   - télécharge le Collector OpenTelemetry officiel (otelcol) si sa version a changé ;
#   - signale à serveur.js qu'une nouvelle version est là (il redémarre de lui-même).
# Commande de la tâche : bash -c 'test -d ~/site || git clone -q https://github.com/VTNK7/victor.marti ~/site; bash ~/site/serveur/mettre-a-jour.sh'
set -euo pipefail

OTELCOL_VERSION=0.164.0
DEPOT=~/site
DONNEES=~/site-donnees
mkdir -p "$DONNEES"

cd "$DEPOT"
git fetch -q origin main
change=0
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ]]; then
  echo "mise à jour $(git rev-parse --short HEAD) → $(git rev-parse --short FETCH_HEAD)"
  git reset -q --hard FETCH_HEAD
  change=1
fi

if [[ "$(cat "$DONNEES/otelcol.version" 2>/dev/null)" != "$OTELCOL_VERSION" ]]; then
  echo "téléchargement d'otelcol $OTELCOL_VERSION"
  tmp=$(mktemp -d)
  curl -fsSL "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/otelcol_${OTELCOL_VERSION}_linux_amd64.tar.gz" \
    | tar -xz -C "$tmp" otelcol
  mv "$tmp/otelcol" "$DONNEES/otelcol"
  rm -rf "$tmp"
  echo "$OTELCOL_VERSION" > "$DONNEES/otelcol.version"
  change=1
fi

if ((change)); then touch "$DONNEES/redemarrer"; fi
