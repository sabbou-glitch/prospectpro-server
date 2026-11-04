# Phase 2 — Architecture retenue

## 1. Vue d'ensemble

```
                 ┌──────────────────────── Mac (puis petit serveur cloud) ────────────────────────┐
                 │                                                                                 │
 Planning  ───►  │  n8n Community (Docker)            Serveur des agents (Docker, Node.js)         │
 8h/10h/18h      │  ─ déclenche les tâches  ── HTTP ─► ─ Agent Recherche   (/agent/research)      │
                 │  ─ lit/écrit Google Sheets  (jeton) ─ Agent Prospection (/agent/draft)          │
                 │  ─ crée les brouillons Gmail        ─ Suivi réponses    (/agent/reply)          │
                 │  ─ envoie le rapport                ─ Directeur IA      (/agent/report)         │
                 │  ─ relance les tâches échouées      ─ Budget, journal, conformité, doublons     │
                 └──────────┬──────────────────────────────────┬──────────────────────────────────┘
                            │                                  │
              Google Sheets / Gmail / Drive        API officielle entreprises (gratuit)
              (OAuth, votre compte)                Google Places (quota gratuit)
                                                   Sites web publics des prospects
                                                   Claude API (Haiku 5.5 + Opus 5.5)
```

**Principe d'économie :** il n'y a pas « 7 agents qui tournent en permanence ». Il y a **un seul serveur** et
**un seul fournisseur d'IA**. Chaque « agent » est une fonction spécialisée (prompt + outils + règles) déclenchée
par un workflow n8n. Les tâches qui n'ont pas besoin d'IA (score, doublons, conformité, rapport) sont du code
classique : coût nul et résultat prévisible.

## 2. Outils retenus

| Besoin | Outil | Pourquoi | Coût |
|---|---|---|---|
| Orchestration, planning, connexions | **n8n Community** (Docker) | Gratuit, visuel, connecteurs Gmail/Sheets prêts | 0 € |
| Logique des agents | **Serveur Node.js** (ce dépôt) | Testable, versionné, sécurisé | 0 € |
| IA – qualification, tri des réponses | **Claude Haiku 5.5** | Très bon marché pour le volume | ≈ 0,5 €/mois |
| IA – rédaction des emails | **Claude Opus 5.5** (effort bas) | Meilleure qualité rédactionnelle | ≈ 4–5 €/mois |
| Vérification d'existence des entreprises | **API Recherche d'entreprises** (État) | Officielle, gratuite, SIREN | 0 € |
| Site web + téléphone des entreprises | **Google Places API (New)** | Données fiables | 0 € dans le quota gratuit (plafonné) |
| Base commerciale | **Google Sheets** (9 onglets) | Simple, vous pouvez tout lire et corriger | 0 € |
| Emails | **Gmail** (brouillons → envoi) | Votre messagerie actuelle | 0 € |
| Hébergement | **Mac** (phase 1) → **VPS** (phase 2) | Démarrage gratuit, puis 24h/24 | 0 € puis ≈ 5 €/mois |

Non retenus pour l'instant : Supabase (inutile tant que Sheets suffit, < quelques milliers de lignes),
outils payants d'enrichissement d'emails (Hunter, Dropcontact… : 30 à 50 €/mois), recherche web par IA
(≈ 10 $ / 1 000 recherches, réservée plus tard aux cas que les sources gratuites ne couvrent pas).

## 3. Coûts mensuels estimés (à revérifier avant engagement)

| Poste | Type | Estimation | Plafond technique |
|---|---|---|---|
| n8n Community | Abonnement | 0 € | — |
| Claude API – qualification (≈ 600 prospects) | Frais API | ≈ 0,30 € | Plafond global ci-dessous |
| Claude API – rédaction (≈ 220 emails) | Frais API | ≈ 4,50 € | idem |
| Claude API – analyse des réponses | Frais API | < 0,10 € | idem |
| Google Places (≤ 900 appels) | Recherche commerciale | 0 € (quota gratuit Google ≈ 1 000/mois) | 900 appels/mois dans le code + quota journalier Google |
| API Recherche d'entreprises | Recherche commerciale | 0 € | — |
| Hébergement Mac | Hébergement | 0 € (électricité) | — |
| VPS (plus tard, sur votre accord) | Hébergement | ≈ 4–6 €/mois | — |
| **Total phase 1** | | **≈ 5 €/mois** | **arrêt automatique à 15 €** |
| **Total avec VPS** | | **≈ 10–11 €/mois** | |

Garde-fous :
1. **Plafond interne** `BUDGET_MONTHLY_CAP_EUR=15` : au-delà, le serveur refuse tout appel payant (alerte à 70 %).
2. **Crédits prépayés Anthropic** sans rechargement automatique : impossible de dépasser le montant acheté.
3. **Quota journalier Google Places** (40/jour) + **alerte budgétaire Google Cloud** à 1 €.
4. Coûts suivis dans le rapport quotidien.

Tarifs utilisés : Haiku 5.5 = 0,10 $/0,50 $ et Opus 5.5 = 4 $/20 $ par million de tokens (entrée/sortie) ;
Google Places Text Search Enterprise ≈ 35 $/1 000 au-delà du quota gratuit. Sources :
https://www.anthropic.com/pricing — https://developers.google.com/maps/billing-and-pricing/pricing

## 4. Fonctionnement des agents commerciaux (construits)

### Agent 2 — Recherche commerciale (`src/agents/research.js`)
1. Interroge le **registre officiel** par catégorie (codes d'activité NAF + départements 95, 75, 92, 93, 94, 78).
2. Écarte les doublons (SIREN, domaine, email, nom normalisé + code postal), les exclusions et les noms hors cible.
3. Classe par distance à Ermont, garde les 15 plus proches par exécution.
4. Google Places → site, téléphone, statut (les établissements **fermés définitivement** sont écartés).
5. Lit au maximum 4 pages publiques du site (accueil, contact, mentions légales) **en respectant robots.txt** :
   emails publiés **sur le domaine du site** (avec l'URL source), réseaux sociaux, extrait de texte.
6. Claude Haiku évalue la correspondance (/30) et le potentiel (/25) **uniquement à partir des données fournies**.
7. Le code calcule capacité (/20), facilité de contact (/15), proximité (/10) → **score /100** et classe.

### Agent 3 — Prospection (`src/agents/prospection.js`)
- Vérifie la conformité avant tout (SIREN, email publié avec source, pas d'opposition, pas d'exclusion).
- Claude Opus rédige un email court et personnalisé ; le **code** ajoute signature, mention d'origine des données et
  désinscription « STOP ». Contrôles automatiques : longueur, aucun prix, aucune fausse relation, pas de « Re: ».
- **Phase actuelle : brouillons Gmail uniquement.** Vous relisez et envoyez. L'envoi automatique ne sera activé
  qu'après votre validation des modèles.
- Analyse des réponses : l'opposition (« STOP », « ne plus nous contacter »…) est détectée **par règle, sans IA**,
  puis la réponse est classée (intéressé, demande de devis, plus tard…).

### Agent 1 — Directeur IA (version 1, `src/agents/report.js`)
Rapport HTML quotidien à 18h : actions qui vous attendent, indicateurs, dépenses, erreurs, meilleurs prospects.

## 5. Planning quotidien (n8n)

| Heure | Workflow | État |
|---|---|---|
| 08h00 (lun–sam) | 01 – Recherche + qualification + enregistrement | ✅ fourni |
| 10h00 (lun–ven) | 02 – Brouillons d'emails (10/jour max) | ✅ fourni |
| 14h00 | 04 – Analyse des réponses Gmail → CONTACTS / EXCLUSIONS | prochaine étape |
| 16h00 | 05 – Relances (J+6, J+14, 2 relances max) | prochaine étape |
| 18h00 | 03 – Rapport quotidien au dirigeant | ✅ fourni |

La recherche et la qualification sont fusionnées (un seul passage = moins d'appels). Chaque appel HTTP est
retenté 3 fois ; les erreurs sont journalisées (`data/journal-*.log` + onglet JOURNAL) et remontées au rapport.

## 6. Sécurité

- Clés uniquement dans `.env` (jamais dans le code ni sur GitHub).
- Serveur des agents **non exposé** : accessible seulement depuis n8n (réseau Docker interne) + jeton.
- n8n accessible uniquement depuis le Mac (`127.0.0.1:5678`), compte propriétaire avec mot de passe.
- Contenu web = **donnée non fiable** : délimité dans les prompts, détection des tentatives d'injection, sorties
  JSON contraintes par schéma, l'IA n'a **aucun outil** lui permettant d'agir (envoyer, supprimer, payer).
- Arrêt d'urgence : `AGENTS_PAUSED=true` dans `.env` ou créer le fichier `data/PAUSE`.
- Aucune suppression de données par les agents (ajout et mise à jour seulement).
- Retour arrière : Git (code), historique des versions Google Sheets (données), export n8n (workflows).

## 7. Risques et limites

| Risque | Mesure |
|---|---|
| Mac en veille = tâches non exécutées | Réglage de veille (guide §8) ; migration VPS dès que le système est validé |
| Peu d'emails publiés pour certaines cibles (mairies, CSE) | Le prospect est gardé avec « trouver_contact » ; téléphone/formulaire |
| Délivrabilité Gmail | Brouillons validés à la main, puis montée progressive 10 → 25/jour |
| Codes NAF imparfaits (ex. salles déclarées en « location immobilière ») | Filtre par mots-clés + qualification IA ; à ajuster après vos premiers retours |
| Jeton OAuth Google expirant au bout de 7 jours (app Google en mode « Test ») | Procédure de publication dans le guide §5 |
| Erreurs d'import n8n selon la version | Workflows générés pour n8n 2.x ; je corrige sur votre retour d'import |

## 8. Planning de construction

| Étape | Contenu | Validation par vous |
|---|---|---|
| **1. (fait)** | Audit, moteur Agent Recherche + Prospection + rapport, tests sur données fictives, workflows 01-02-03 | Lecture de ce document |
| **2.** | Installation Mac : Docker, n8n, Google Sheets, connexions Gmail/Sheets, clés API | Résultats des commandes |
| **3.** | Premier essai réel sur 1 catégorie (salles de réception 95) → vous notez 20 prospects | Qualité des prospects |
| **4.** | Brouillons réels → vous validez le ton et le modèle | Modèle d'email |
| **5.** | Workflows 04 (réponses) et 05 (relances), liste d'exclusion automatique | Tests |
| **6.** | Mise en production : recherche quotidienne, envoi progressif autorisé | Accord d'envoi |
| **7.** | Agent Devis (audit Netlify + Sheets + PDF existants), puis Marketing, Production, Finance | Grille tarifaire |
| **8.** | Migration VPS (accord financier requis) | Accord de dépense |
