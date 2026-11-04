# Règles de conformité appliquées par les agents

> Synthèse opérationnelle, pas un avis juridique. Référence : CNIL, « La prospection commerciale par courrier
> électronique » — https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique

## Ce que le système fait automatiquement

| Règle | Mise en œuvre |
|---|---|
| **B2B uniquement** : pas d'email de prospection aux particuliers sans consentement préalable | Seules les organisations identifiées par un **SIREN** au registre officiel sont prospectées. Les particuliers ne sont contactés que s'ils vous écrivent (demande de devis). |
| Message **en rapport avec la profession** du destinataire | Cibles limitées aux métiers de l'événementiel/réception/organisation ; contrôle IA de pertinence. |
| **Information** du destinataire sur l'origine des données | Mention fixe dans chaque email : coordonnées issues de son site ou d'un annuaire professionnel. |
| **Droit d'opposition** simple et gratuit | « Répondez STOP » dans chaque email ; détection automatique, ajout immédiat à EXCLUSIONS. |
| **Liste d'exclusion centralisée** | Vérifiée à la recherche, avant la rédaction et avant l'envoi (email, domaine, SIREN, nom). |
| **Minimisation** | Seules les coordonnées professionnelles publiques utiles sont stockées, avec leur source. |
| **Traçabilité** | Source + date de découverte/vérification pour chaque prospect ; historique dans CONTACTS. |
| **Pas de tromperie** | Interdiction des faux « Re: », des fausses relations, des faux avis/clients/chiffres (prompt + contrôle automatique). |
| **Respect des sites** | robots.txt respecté, 4 pages maximum, identification honnête du robot, aucun contournement. |

## Ce qui reste à faire de votre côté
1. Ajouter dans les **mentions légales / politique de confidentialité** de votre site une section « Prospection
   commerciale » (finalité, base légale : intérêt légitime, durée de conservation proposée : 3 ans sans réponse,
   droits et contact). Je peux la rédiger à l'étape « site ».
2. Inscrire ce traitement dans votre **registre des traitements** (modèle CNIL gratuit).
3. Ne jamais importer de fichiers achetés ou de listes dont la source est inconnue.

## Adresses génériques vs nominatives
- `contact@`, `info@`, `evenements@` : adresses de l'organisation.
- `prenom.nom@` : donnée personnelle d'un professionnel — autorisée en B2B si le message concerne sa fonction,
  avec information et opposition (appliqué).
