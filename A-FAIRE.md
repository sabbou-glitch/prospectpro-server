# Ce que vous devez faire (et seulement ça)

J'ai construit et testé tout ce qui peut l'être sans vous. Il reste les étapes qui demandent **votre compte, votre carte bancaire ou votre Mac**.
Durée totale : environ **1 heure**, une seule fois. Faites-les dans l'ordre et cochez au fur et à mesure.

---

## ☐ 1. Supprimer l'ancienne clé Google (2 min) — URGENT
Elle est visible publiquement sur GitHub.
1. Ouvrez https://console.cloud.google.com/apis/credentials (avec le compte qui l'a créée).
2. Cliquez sur la clé qui commence par `AIzaSyB0Np…` → **Supprimer**.

## ☐ 2. Installer Docker Desktop (10 min)
1. Ouvrez https://www.docker.com/products/docker-desktop/ → **Download for Mac**
   (choisissez **Apple Silicon** si votre Mac date de 2021 ou après, sinon **Intel**. En cas de doute : menu  → « À propos de ce Mac » → ligne « Puce » = Apple Silicon).
2. Ouvrez le fichier téléchargé, glissez **Docker** dans **Applications**, lancez-le, acceptez, cliquez **Skip** pour le compte.

## ☐ 3. Base Google Sheets (3 min)
Connecté avec **maisonevenementidf@gmail.com** :
- **Si vous avez déjà un Google Sheets** de prospection/devis : envoyez-moi son lien d'abord, je vous dirai s'il faut le compléter.
- Sinon : ouvrez https://sheets.new → **Extensions → Apps Script** → effacez tout → collez le contenu du fichier
  [`sheets/creer-base-commerciale.gs`](sheets/creer-base-commerciale.gs) → 💾 → **Exécuter** → autorisez.
  Notez l'identifiant affiché (vous le collerez à l'étape 6).

## ☐ 4. Clé Claude (5 min) — dépense de 10 $ à autoriser
1. https://console.anthropic.com → créez le compte avec maisonevenementidf@gmail.com.
2. **Billing** → achetez **10 $** de crédits → **désactivez le rechargement automatique**.
3. **API Keys → Create Key** → copiez la clé (`sk-ant-…`) dans un endroit sûr. Ne me l'envoyez pas.

## ☐ 5. Google Cloud (15 min) — aucune dépense prévue, mais carte demandée par Google
Connecté avec **maisonevenementidf@gmail.com**, sur https://console.cloud.google.com :
1. En haut : **Sélectionner un projet → Nouveau projet** → nom `maison-evenement` → Créer.
2. Menu ☰ → **Facturation** → associer un compte de facturation (carte). Puis **Budgets et alertes** → budget **1 €**.
3. Menu ☰ → **API et services → Bibliothèque** → activez une par une : **Places API (New)**, **Gmail API**, **Google Sheets API**, **Google Drive API**.
4. **API et services → Identifiants → Créer des identifiants → Clé API** → **Modifier** → *Restreindre la clé* → cochez **Places API (New)** → Enregistrer. Copiez la clé.
5. **API et services → Écran de consentement OAuth** → **Externe** → nom « Agents Maison de l'Événement », email `maisonevenementidf@gmail.com` → ajoutez cette même adresse dans **Utilisateurs test**.
6. **Identifiants → Créer des identifiants → ID client OAuth** → type **Application Web** → dans « URI de redirection autorisés » collez :
   `http://localhost:5678/rest/oauth2-credential/callback` → Créer. Gardez l'**ID client** et le **Code secret** ouverts.

## ☐ 6. Lancer l'installation automatique (5 min)
Ouvrez le **Terminal** (`Cmd + Espace`, tapez Terminal) et collez :
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/sabbou-glitch/prospectpro-server/claude/maison-evenement-ai-agents-ai395k/installer-mac.sh)
```
Le script vérifie votre Mac, télécharge le système, vous pose quelques questions (signature, identifiant du
Google Sheets, clés des étapes 4 et 5 — les clés ne s'affichent pas quand vous les tapez, c'est normal) puis démarre tout.
Il crée aussi `~/MaisonEvenement/diagnostic.txt` : **envoyez-moi son contenu**.

## ☐ 7. Connecter Gmail et Google Sheets à n8n (10 min)
La page http://localhost:5678 s'ouvre :
1. Créez votre compte n8n (mot de passe fort).
2. Menu de gauche **Credentials** (ou « Overview → Credentials ») → **Add credential** → « **Google Sheets OAuth2 API** » → collez l'ID client et le code secret de l'étape 5.6 → **Sign in with Google** → choisissez maisonevenementidf@gmail.com → « Paramètres avancés » → « Accéder » → Autoriser.
3. Recommencez avec « **Gmail OAuth2 API** ».
4. Ouvrez chacun des 5 workflows : les nœuds Google Sheets et Gmail ont un triangle rouge → cliquez dessus → choisissez la connexion → enregistrez.
5. Retournez dans Google Cloud → **Écran de consentement OAuth** → **Publier l'application** (sinon la connexion expire après 7 jours).

## ☐ 8. Premier test (2 min)
Dans n8n, ouvrez « **01 - Agent Recherche commerciale** » → **Test workflow**.
Ouvrez votre Google Sheets, onglet PROSPECTS : envoyez-moi une capture. Je vérifie la qualité avant d'aller plus loin.

---

## Plus tard (je vous les demanderai au bon moment)
- **Valider la grille tarifaire** reprise de votre outil de devis (`config/tarifs.json`) et donner les prix manquants
  (mignardises, jus 33 cl, bar à jus, bar à fleurs).
- **Valider le modèle d'email** sur les premiers brouillons.
- **Autoriser l'envoi automatique** (aujourd'hui : brouillons seulement, vous cliquez « Envoyer » dans Gmail).
- Le site Netlify et le formulaire de devis (pour brancher l'Agent Devis).

## En cas de problème
- Arrêter les agents : `touch ~/MaisonEvenement/agents/data/PAUSE` (reprise : `rm ~/MaisonEvenement/agents/data/PAUSE`).
- Relancer l'installation : recollez la commande de l'étape 6 (sans risque).
- Envoyez-moi le message d'erreur ou une capture : je corrige.
