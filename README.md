# Maison de l'Événement — équipe d'agents IA

Moteur des agents commerciaux (recherche, qualification, prospection, rapport) piloté par n8n.

**👉 Pour démarrer : [A-FAIRE.md](A-FAIRE.md)** (la liste simple de ce que vous avez à faire).

| Document | Contenu |
|---|---|
| [docs/01-AUDIT.md](docs/01-AUDIT.md) | Audit de l'existant — **action urgente : révoquer l'ancienne clé Google** |
| [docs/02-ARCHITECTURE.md](docs/02-ARCHITECTURE.md) | Architecture, coûts, risques, planning |
| [docs/03-INSTALLATION-MAC.md](docs/03-INSTALLATION-MAC.md) | Installation pas à pas sur Mac |
| [docs/04-CONFORMITE-RGPD.md](docs/04-CONFORMITE-RGPD.md) | Règles RGPD/CNIL appliquées |

## Arborescence
```
src/agents/      research.js (Agent 2) · prospection.js (Agent 3) · report.js (Agent 1, rapport) · devis.js (Agent 5, calcul)
src/core/        scoring · dedupe · compliance · budget · logger
src/sources/     insee.js (registre officiel) · places.js (Google Places New)
src/enrich/      website.js (emails publiés, robots.txt, réseaux sociaux)
prompts/         prompts système des agents
config/          targets.json (cibles calibrées sur le registre officiel) · tarifs.json (grille de l'outil de devis, à valider)
installer-mac.sh installation automatique sur Mac
n8n/             workflows importables (01 recherche 8h, 02 brouillons 10h, 03 rapport 18h, 04 suivi envois/réponses 14h-17h, 05 relances 16h)
sheets/          script Apps Script de création de la base Google Sheets
test/            tests sur données fictives (npm test)
```

## API (appelée par n8n, en-tête `X-API-Key`)
| Route | Rôle |
|---|---|
| `POST /agent/research` `{category, existing, exclusions, maxEnrich}` | Trouve, vérifie, enrichit, note les prospects |
| `POST /agent/draft` `{prospects, exclusions, max}` | Prépare des brouillons d'emails conformes |
| `POST /agent/followup` `{prospects, exclusions}` | Relances (sans IA, 2 maximum) |
| `POST /agent/devis/calcul` `{prestation, invites, km, options}` | Calcul de devis selon la grille validée |
| `POST /agent/reply` `{from, subject, text}` | Classe une réponse (opposition détectée sans IA) |
| `POST /agent/report` `{prospects, contacts, devis, erreurs}` | Rapport quotidien HTML |
| `GET /agent/budget`, `GET /agent/categories`, `GET /health` | Suivi |

Routes historiques conservées : `GET /search`, `GET /enrich`.

## Développement
```bash
npm install
npm test
```
