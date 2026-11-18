#!/bin/bash
# Lance tout en local, sans backend en ligne :
#   - le serveur du tableau de bord + le Collector OpenTelemetry sur http://localhost:8790 ;
#   - le site sur http://localhost:8000 (accueil, tableau-de-bord.html).
# Les pages servies depuis localhost envoient automatiquement leurs traces au serveur local.
# Usage : serveur/local.sh [--demo]   (--demo injecte 14 jours de données fictives)
set -euo pipefail

ICI=$(cd "$(dirname "$0")" && pwd)
RACINE=$(dirname "$ICI")
DONNEES="$ICI/.local"
OTELCOL_VERSION=0.164.0
mkdir -p "$DONNEES"

# Collector officiel pour cette machine (Linux ou macOS, amd64 ou arm64)
if [[ -z "${OTELCOL_BIN:-}" ]] && [[ ! -x "$DONNEES/otelcol" || "$(cat "$DONNEES/otelcol.version" 2>/dev/null)" != "$OTELCOL_VERSION" ]]; then
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; arm64|aarch64) arch=arm64 ;; *) echo "architecture non gérée"; exit 1 ;; esac
  echo "Téléchargement d'otelcol $OTELCOL_VERSION ($os/$arch)…"
  curl -fsSL "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${OTELCOL_VERSION}/otelcol_${OTELCOL_VERSION}_${os}_${arch}.tar.gz" \
    | tar -xz -C "$DONNEES" otelcol
  echo "$OTELCOL_VERSION" > "$DONNEES/otelcol.version"
fi

trap 'kill 0' EXIT
OTELCOL_BIN="${OTELCOL_BIN:-$DONNEES/otelcol}" DOSSIER_DONNEES="$DONNEES" PORT=8790 IP=127.0.0.1 node "$ICI/serveur.js" &
(cd "$RACINE" && python3 -m http.server 8000 --bind 127.0.0.1 >/dev/null 2>&1) &

for _ in $(seq 50); do curl -fs http://127.0.0.1:8790/api/sante >/dev/null 2>&1 && break; sleep 0.2; done
if [[ "${1:-}" == "--demo" ]]; then node "$ICI/demo.js" http://127.0.0.1:8790; fi

echo
echo "  Site            http://localhost:8000"
echo "  Tableau de bord http://localhost:8000/tableau-de-bord.html"
echo "  (Ctrl+C pour arrêter)"
wait
