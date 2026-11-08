#!/bin/bash
# Installation des agents Maison de l'Événement sur Mac.
# Usage (dans le Terminal) :
#   bash <(curl -fsSL https://raw.githubusercontent.com/sabbou-glitch/prospectpro-server/claude/maison-evenement-ai-agents-ai395k/installer-mac.sh)
# Le script peut être relancé sans risque : il ne supprime rien et ne remplace pas un .env existant.
set -u
BRANCHE="claude/maison-evenement-ai-agents-ai395k"
DEPOT="https://github.com/sabbou-glitch/prospectpro-server.git"
DOSSIER="$HOME/MaisonEvenement/agents"

ok()   { printf "\033[32m✔ %s\033[0m\n" "$1"; }
info() { printf "\033[36m→ %s\033[0m\n" "$1"; }
stop() { printf "\033[31m✘ %s\033[0m\n" "$1"; exit 1; }

echo "=============================================="
echo "  Maison de l'Événement — installation agents"
echo "=============================================="

# 1. Diagnostic (copié dans diagnostic.txt pour l'envoyer à Claude)
mkdir -p "$HOME/MaisonEvenement"
DIAG="$HOME/MaisonEvenement/diagnostic.txt"
{
  echo "=== MAC ==="; sw_vers; uname -m
  system_profiler SPHardwareDataType 2>/dev/null | grep -E "Model Name|Model Identifier|Chip|Processor Name|Memory"
  echo "=== DISQUE ==="; df -h "$HOME" | tail -1
  echo "=== OUTILS ==="
  for t in docker git; do printf "%-8s" "$t"; command -v $t >/dev/null && ($t --version 2>/dev/null | head -1) || echo "absent"; done
  echo "=== VEILLE ==="; pmset -g | grep -E " sleep|displaysleep|standby"
} > "$DIAG" 2>&1
ok "Diagnostic enregistré dans $DIAG"

# 2. Prérequis
command -v git >/dev/null || { info "Git manquant : macOS va proposer les « outils de ligne de commande ». Acceptez puis relancez ce script."; xcode-select --install 2>/dev/null; exit 1; }
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
  if [ -d /Applications/Docker.app ]; then
    info "Démarrage de Docker Desktop…"; open -a Docker
    for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
    docker info >/dev/null 2>&1 || stop "Docker ne répond pas. Ouvrez Docker Desktop, attendez qu'il soit prêt, puis relancez ce script."
  else
    ARCH=$(uname -m)
    [ "$ARCH" = "arm64" ] && LIEN="https://desktop.docker.com/mac/main/arm64/Docker.dmg" || LIEN="https://desktop.docker.com/mac/main/amd64/Docker.dmg"
    info "Docker Desktop n'est pas installé. Téléchargement : $LIEN"
    open "$LIEN"
    stop "Installez Docker (glisser l'icône dans Applications), ouvrez-le une fois, puis relancez ce script."
  fi
fi
ok "Docker prêt ($(docker --version | head -1))"

# 3. Code
if [ -d "$DOSSIER/.git" ]; then
  info "Mise à jour du code…"; git -C "$DOSSIER" fetch -q origin "$BRANCHE" && git -C "$DOSSIER" checkout -q "$BRANCHE" && git -C "$DOSSIER" pull -q --ff-only origin "$BRANCHE"
else
  info "Téléchargement du code…"; git clone -q -b "$BRANCHE" "$DEPOT" "$DOSSIER" || stop "Téléchargement impossible."
fi
cd "$DOSSIER" || stop "Dossier introuvable."
ok "Code dans $DOSSIER"

# 4. Configuration (.env) — les clés restent sur ce Mac
setvar() { # setvar NOM valeur  (remplace la ligne NOM=… dans .env)
  local nom="$1" val="$2" tmp; tmp=$(mktemp)
  awk -v n="$nom" -v v="$val" 'BEGIN{d=0} $0 ~ "^"n"=" {print n"="v; d=1; next} {print} END{if(!d) print n"="v}' .env > "$tmp" && mv "$tmp" .env
}
getvar() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
ask() { # ask NOM "question" [secret]
  local cur; cur=$(getvar "$1")
  [ -n "$cur" ] && return
  local v
  if [ "${3:-}" = "secret" ]; then read -r -s -p "$2 (laisser vide pour plus tard) : " v; echo; else read -r -p "$2 (laisser vide pour plus tard) : " v; fi
  [ -n "$v" ] && setvar "$1" "$v"
}
if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; ok "Fichier .env créé"; fi
[ -z "$(getvar SERVER_API_TOKEN)" ] && setvar SERVER_API_TOKEN "$(openssl rand -hex 32)"
[ -z "$(getvar N8N_ENCRYPTION_KEY)" ] && setvar N8N_ENCRYPTION_KEY "$(openssl rand -hex 32)"
[ -z "$(getvar SENDER_EMAIL)" ] && setvar SENDER_EMAIL "maisonevenementidf@gmail.com"
[ -z "$(getvar REPORT_TO)" ] && setvar REPORT_TO "maisonevenementidf@gmail.com"
[ -z "$(getvar SENDER_WEBSITE)" ] && setvar SENDER_WEBSITE "maisonevenement.eu"
ask SENDER_NAME "Prénom et nom pour la signature des emails"
ask SENDER_PHONE "Téléphone pour la signature"
ask VENDEUR_ADRESSE "Adresse postale de l'entreprise (devis)"
ask GOOGLE_SHEET_ID "Identifiant du Google Sheets (dans l'adresse : /d/XXXXXXXX/edit)"
ask ANTHROPIC_API_KEY "Clé API Claude (sk-ant-…)" secret
ask GOOGLE_PLACES_API_KEY "Clé Google Places (AIza…)" secret
ok "Configuration enregistrée (sauvegardez une copie de $DOSSIER/.env dans un endroit sûr)"

# 5. Démarrage
info "Démarrage de n8n et des agents (première fois : quelques minutes)…"
docker compose up -d --build || stop "Le démarrage a échoué. Envoyez à Claude le message ci-dessus."
for i in $(seq 1 40); do curl -fs http://127.0.0.1:5678/healthz >/dev/null 2>&1 && break; sleep 3; done
curl -fs http://127.0.0.1:5678/healthz >/dev/null 2>&1 && ok "n8n est démarré" || stop "n8n ne répond pas. Lancez : docker compose logs n8n | tail -30"
docker compose exec -T agents node -e "fetch('http://localhost:3000/health').then(r=>r.json()).then(j=>console.log('Agents OK, budget du mois :', j.budget.spentEur,'€ /', j.budget.capEur,'€'))" || stop "Le serveur des agents ne répond pas."

# 6. Import des workflows (une seule fois)
if [ ! -f data/.workflows-importes ]; then
  docker compose exec -T n8n n8n import:workflow --separate --input=/workflows && touch data/.workflows-importes && ok "5 workflows importés (désactivés)"
fi

echo
ok "Installation terminée."
echo "Prochaine étape : ouvrez http://localhost:5678 (la page va s'ouvrir), créez votre compte n8n,"
echo "puis suivez la partie « Connexion Gmail et Google Sheets » du guide A-FAIRE.md."
open "http://localhost:5678"
