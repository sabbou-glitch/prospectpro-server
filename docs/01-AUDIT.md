# Phase 1 — Audit technique (4 novembre 2026)

## 1. Ce qui a été audité

| Élément | État | Commentaire |
|---|---|---|
| Dépôt GitHub `prospectpro-server` | ✅ audité | Serveur Node.js/Express de 79 lignes : recherche d'entreprises (API officielle) + enrichissement Google Places + extraction d'email sur le site. |
| Mac du dirigeant | ⏳ en attente | Commandes de diagnostic dans `03-INSTALLATION-MAC.md` §1. |
| Docker / n8n | ⏳ en attente | Rien d'installé à ce jour (à confirmer par le diagnostic). |
| Site Netlify + système de devis | ⏳ en attente | Fichiers ou accès à fournir. **Aucune modification avant audit et sauvegarde.** |
| Google Sheets existant (devis) | ⏳ en attente | Lien ou copie à fournir. |

## 2. Constats sur le code existant

### 🔴 Critique — clé Google exposée
`index.js` contenait une **clé API Google écrite en clair** (`AIzaSy…VXk`). Elle est dans l'historique Git :
toute personne ayant accès au dépôt peut l'utiliser à vos frais.

**Action requise de votre part (5 minutes) :**
1. Ouvrir https://console.cloud.google.com/apis/credentials
2. Cliquer sur la clé concernée → **Supprimer** (ou « Régénérer la clé »).
3. Créer une nouvelle clé restreinte (voir `03-INSTALLATION-MAC.md` §6) et la mettre **uniquement** dans le fichier `.env`.

La clé a été retirée du code. Je n'ai **pas** réécrit l'historique Git (opération destructive) : la révocation suffit à neutraliser la clé.

### 🟠 Autres constats
- **API Google Places « historique »** (Find Place + Place Details) : Google la réserve aux anciens projets ; deux appels par entreprise. → remplacée par **Places API (New) – Text Search** : un seul appel.
- **Aucune vérification robots.txt**, extraction d'emails sans vérifier le domaine (risque de récupérer l'email d'un prestataire web ou d'un tiers). → corrigé.
- **Aucune trace de la source** des coordonnées (exigée pour le RGPD). → chaque email est lié à l'URL publique où il a été trouvé.
- **Aucun contrôle de coût, de doublon, de journal ou d'authentification.** → ajoutés.
- Les routes `/search` et `/enrich` sont **conservées et compatibles** (même format de réponse) au cas où l'outil ProspectPro existant les appelle. Merci de me dire où ce serveur est hébergé aujourd'hui (Render, Railway… ?).

## 3. Ce qui est réutilisé

- L'API officielle **Recherche d'entreprises** (gratuite, sans clé) : excellente base pour vérifier que les organisations existent (SIREN, état actif, adresse, dirigeants déclarés).
- Le principe d'enrichissement Google → site web → email : conservé, fiabilisé.
