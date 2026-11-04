# Phase 3 — Installation sur votre Mac

Ouvrez le **Terminal** : `Cmd + Espace` → tapez « Terminal » → Entrée.
Collez chaque bloc, appuyez sur Entrée, et **envoyez-moi le résultat** aux étapes marquées 📤.

---

## 1. Diagnostic 📤

Ce bloc ne modifie rien, il lit seulement des informations. Copiez-le en entier :

```bash
echo "=== MAC ==="; sw_vers; uname -m
system_profiler SPHardwareDataType | grep -E "Model Name|Model Identifier|Chip|Processor Name|Memory"
echo "=== DISQUE ==="; df -h ~ | tail -1
echo "=== OUTILS ==="
for t in docker node npm git brew python3; do printf "%-8s" "$t"; command -v $t >/dev/null && ($t --version 2>/dev/null | head -1) || echo "absent"; done
echo "=== DOCKER ==="; ls -d /Applications/Docker.app 2>/dev/null || echo "Docker Desktop absent"
docker ps 2>&1 | head -3
echo "=== N8N ==="; ls -d ~/.n8n 2>/dev/null || echo "pas de dossier ~/.n8n"
echo "=== VEILLE ==="; pmset -g | grep -E " sleep|displaysleep|standby" 
echo "=== DOSSIERS ==="; ls ~ ; ls ~/Documents 2>/dev/null | head -40
```

Ce que je vérifie : processeur Apple (arm64) ou Intel (x86_64), version de macOS (Docker Desktop exige une
des 3 dernières versions majeures), mémoire (8 Go minimum conseillés), espace disque (10 Go libres minimum).

---

## 2. Docker Desktop

1. Aller sur https://www.docker.com/products/docker-desktop/
2. Cliquer **Download for Mac – Apple Silicon** (si `uname -m` affiche `arm64`) ou **Intel Chip** (`x86_64`).
3. Ouvrir le fichier `.dmg`, glisser **Docker** dans **Applications**, puis lancer Docker depuis Applications.
4. Accepter les conditions (gratuit pour les entreprises de moins de 250 salariés et moins de 10 M$ de CA).
   Vous pouvez passer la création de compte (« Skip »).
5. Dans Docker → ⚙️ Settings → General : cocher **Start Docker Desktop when you sign in to your computer**.

Vérification 📤 :
```bash
docker --version && docker compose version && docker run --rm hello-world | head -3
```

---

## 3. Récupérer le projet

```bash
mkdir -p ~/MaisonEvenement && cd ~/MaisonEvenement
git clone https://github.com/sabbou-glitch/prospectpro-server.git agents
cd agents && git checkout claude/maison-evenement-ai-agents-ai395k
cp .env.example .env
```
(Si `git` n'est pas installé, macOS proposera d'installer les « outils de ligne de commande » : acceptez.)

Générer les deux secrets et les écrire dans `.env` automatiquement :
```bash
sed -i '' "s/^SERVER_API_TOKEN=.*/SERVER_API_TOKEN=$(openssl rand -hex 32)/" .env
sed -i '' "s/^N8N_ENCRYPTION_KEY=.*/N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
grep -c "=..*" .env
```
⚠️ Sauvegardez `.env` dans votre gestionnaire de mots de passe : sans `N8N_ENCRYPTION_KEY`, les connexions
enregistrées dans n8n deviennent illisibles.

Ouvrir `.env` pour le compléter : `open -e .env` (TextEdit). Remplissez `SENDER_NAME`, `SENDER_EMAIL`,
`SENDER_PHONE`, `SENDER_WEBSITE`, `REPORT_TO` (votre adresse pour le rapport). **Ne m'envoyez jamais ce fichier.**

---

## 4. Base Google Sheets (2 minutes)

1. Ouvrir https://sheets.new (connecté avec le compte Gmail de l'entreprise). Nommer : « Maison de l'Événement – Base commerciale ».
2. Menu **Extensions → Apps Script**. Effacer le contenu, coller le fichier `sheets/creer-base-commerciale.gs`.
3. 💾 Enregistrer → choisir la fonction `creerBaseCommerciale` → **Exécuter** → autoriser (« Paramètres avancés → Accéder au projet » si Google affiche un avertissement : c'est votre propre script).
4. Une fenêtre affiche l'**identifiant** du fichier : le copier dans `.env` → `GOOGLE_SHEET_ID=`.

Résultat : 9 onglets (PROSPECTS, CAMPAGNES, CONTACTS, CLIENTS, DEVIS, PRODUCTION, STATISTIQUES, EXCLUSIONS, JOURNAL).

---

## 5. Démarrer n8n + le serveur des agents 📤

```bash
cd ~/MaisonEvenement/agents
docker compose up -d --build
docker compose ps
```
Les deux services doivent être « running ». Puis ouvrir http://localhost:5678 et créer le compte propriétaire
n8n (mot de passe fort).

Importer les workflows :
```bash
docker compose exec n8n n8n import:workflow --separate --input=/workflows
```
Ils apparaissent dans n8n, **désactivés**. Rien ne s'exécute tant que vous ne les activez pas.

---

## 6. Clés API (actions avec engagement financier → votre accord)

### Claude API
1. https://console.anthropic.com → créer un compte entreprise.
2. **Billing** : acheter **10 $ de crédits prépayés** et **désactiver le rechargement automatique**
   (le prépayé est un plafond dur). → *nécessite votre accord : dépense de 10 $.*
3. **Settings → Limits** : fixer une limite de dépense mensuelle (ex. 15 $) si l'option est proposée.
4. **API Keys → Create Key** (nom : `agents-maison-evenement`) → coller dans `.env` : `ANTHROPIC_API_KEY=`.

### Google Places (quota gratuit, carte bancaire exigée par Google)
1. https://console.cloud.google.com → créer un projet « maison-evenement ».
2. **Facturation** : associer un compte de facturation → *nécessite votre accord (aucun coût prévu dans le quota gratuit).*
3. **Facturation → Budgets et alertes** : créer un budget de **1 €** avec alertes à 50 %, 90 %, 100 %.
4. **API et services → Bibliothèque** : activer **Places API (New)**.
5. **Identifiants → Créer → Clé API** → Modifier la clé → *Restrictions d'API* : **Places API (New)** uniquement.
6. **API et services → Places API (New) → Quotas** : limiter « SearchText requests per day » à **40**.
7. Coller la clé dans `.env` : `GOOGLE_PLACES_API_KEY=`.

Après modification de `.env` : `docker compose up -d` (redémarre avec les nouvelles valeurs).

### Connexion Gmail + Google Sheets dans n8n
Guide officiel : https://docs.n8n.io/integrations/builtin/credentials/google/oauth-single-service/
1. Dans le projet Google Cloud : **API et services → Bibliothèque** → activer **Gmail API**, **Google Sheets API**, **Google Drive API**.
2. **Écran de consentement OAuth** : type **Interne** si votre adresse est Google Workspace (nom de domaine) ;
   sinon **Externe**, puis ajoutez votre adresse comme utilisateur test et, une fois tout validé, cliquez
   **Publier l'application** (sinon la connexion expire tous les 7 jours).
3. **Identifiants → Créer → ID client OAuth → Application Web** ; URI de redirection autorisée :
   `http://localhost:5678/rest/oauth2-credential/callback`
4. Dans n8n : **Credentials → Add** → « Google Sheets OAuth2 API » puis « Gmail OAuth2 API » → coller l'ID et le
   secret client → **Sign in with Google**.
5. Ouvrir chaque workflow, cliquer sur les nœuds Google Sheets / Gmail (marqués en rouge) et choisir ces connexions.

---

## 7. Premier test réel (après mon feu vert) 📤

Test du serveur sans IA ni Google (gratuit) :
```bash
docker compose exec agents wget -qO- http://localhost:3000/health
```
Puis dans n8n : ouvrir « 01 – Agent Recherche » → **Test workflow**. Vérifier l'onglet PROSPECTS et m'envoyer
votre avis sur 20 prospects (pertinents ? coordonnées justes ?).

---

## 8. Veille du Mac

Les tâches planifiées ne s'exécutent pas si le Mac dort (elles ne sont **pas** rattrapées au réveil).
Réglages système → **Batterie / Économiseur d'énergie** → sur secteur : activer
« Empêcher la suspension automatique lorsque l'écran est éteint ». À terme : serveur cloud (étape 8).

## Arrêt d'urgence
```bash
touch ~/MaisonEvenement/agents/data/PAUSE      # suspend les agents
rm ~/MaisonEvenement/agents/data/PAUSE         # reprise
docker compose down                            # arrêt complet
```
