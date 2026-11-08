/**
 * Création de la base commerciale Maison de l'Événement dans Google Sheets.
 * Utilisation : dans un Google Sheets VIDE -> Extensions -> Apps Script -> coller ce fichier
 * -> Enregistrer -> choisir la fonction "creerBaseCommerciale" -> Exécuter -> autoriser.
 * Le script ne supprime jamais un onglet existant : il crée seulement ceux qui manquent
 * et complète les en-têtes.
 */
const ONGLETS = {
  PROSPECTS: ['ID', 'Entreprise', 'Catégorie', 'Ville', 'Département', 'Code postal', 'Adresse', 'SIREN',
    'Site internet', 'Email professionnel', 'Type email', 'Source email', 'Téléphone professionnel',
    'Contact professionnel', 'Fonction', 'Réseaux sociaux', 'Source', 'Date de découverte', 'Date de vérification',
    'Score commercial', 'Détail score', 'Classe', 'Prestation recommandée', 'Analyse', 'Distance Ermont (km)',
    'Statut', 'Date du dernier contact', 'Prochaine action', 'Opposition à la prospection', 'Relances'],
  CAMPAGNES: ['Nom de campagne', 'Type de clientèle', 'Prestation proposée', 'Zone géographique', 'Date de lancement',
    'Nombre de prospects', 'Nombre de messages envoyés', 'Nombre de réponses', 'Nombre de prospects intéressés',
    'Nombre de devis', 'Nombre de ventes'],
  CONTACTS: ['Date', 'ID prospect', 'Entreprise', 'Email', 'Direction', 'Type', 'Objet', 'Résumé',
    'Catégorie réponse', 'Gmail thread ID', 'Campagne', 'Agent', 'Suite donnée'],
  CLIENTS: ['ID client', 'Nom / Organisation', 'Type de client', 'Email', 'Téléphone', 'Ville', 'Date événement',
    'Lieu événement', 'Prestation', 'Nombre d\'invités', 'Montant TTC', 'Statut réservation', 'Acompte reçu', 'Notes'],
  DEVIS: ['N° devis', 'Date', 'ID client', 'Client', 'Prestation', 'Date événement', 'Lieu', 'Invités',
    'Montant HT', 'Montant TTC', 'Frais de déplacement', 'Statut', 'Date envoi', 'Date relance', 'Lien PDF', 'Notes'],
  PRODUCTION: ['Date événement', 'N° devis', 'Prestation', 'Article', 'Quantité', 'Unité', 'Fournisseur',
    'Coût unitaire', 'Coût total', 'Statut achat', 'Personnel', 'Temps de préparation (h)', 'Notes'],
  STATISTIQUES: ['Indicateur', 'Valeur', 'Mise à jour'],
  EXCLUSIONS: ['Date', 'Email', 'Domaine', 'Entreprise', 'SIREN', 'Motif', 'Source de la demande'],
  JOURNAL: ['Date', 'Agent', 'Action', 'Détail', 'Coût (€)', 'Statut'],
};

const STATS = [
  ['Prospects en base', '=MAX(0,COUNTA(PROSPECTS!A:A)-1)'],
  ['Prospects prioritaires (≥ 80)', '=COUNTIF(PROSPECTS!T:T,">=80")'],
  ['Prospects intéressants (60-79)', '=COUNTIFS(PROSPECTS!T:T,">=60",PROSPECTS!T:T,"<80")'],
  ['Nouveaux prospects aujourd\'hui', '=COUNTIF(PROSPECTS!R:R,TEXT(TODAY(),"yyyy-mm-dd"))'],
  ['Prospects avec email', '=MAX(0,COUNTA(PROSPECTS!J:J)-1)'],
  ['Emails envoyés', '=COUNTIFS(CONTACTS!E:E,"sortant",CONTACTS!F:F,"email")'],
  ['Réponses reçues', '=COUNTIF(CONTACTS!E:E,"entrant")'],
  ['Taux de réponse', '=IFERROR(B8/B7,0)'],
  ['Prospects intéressés', '=COUNTIF(CONTACTS!I:I,"interesse")+COUNTIF(CONTACTS!I:I,"demande_devis")+COUNTIF(CONTACTS!I:I,"demande_info")'],
  ['Devis envoyés', '=COUNTIF(DEVIS!L:L,"envoye")+COUNTIF(DEVIS!L:L,"accepte")+COUNTIF(DEVIS!L:L,"refuse")'],
  ['Devis acceptés', '=COUNTIF(DEVIS!L:L,"accepte")'],
  ['CA des devis acceptés (TTC)', '=SUMIF(DEVIS!L:L,"accepte",DEVIS!J:J)'],
  ['Coût agents enregistré (€)', '=SUM(JOURNAL!E:E)'],
  ['Exclusions (opposition)', '=MAX(0,COUNTA(EXCLUSIONS!A:A)-1)'],
];

function creerBaseCommerciale() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(ONGLETS).forEach(function (nom) {
    const entetes = ONGLETS[nom];
    let sh = ss.getSheetByName(nom);
    if (!sh) sh = ss.insertSheet(nom);
    // Complète les en-têtes manquants sans toucher aux colonnes existantes.
    const largeur = Math.max(sh.getLastColumn(), 1);
    const existants = sh.getRange(1, 1, 1, largeur).getValues()[0].filter(String);
    const manquants = entetes.filter(function (h) { return existants.indexOf(h) === -1; });
    if (manquants.length) sh.getRange(1, existants.length + 1, 1, manquants.length).setValues([manquants]);
    sh.getRange(1, 1, 1, entetes.length).setFontWeight('bold').setBackground('#f3ece4').setFontColor('#5b4330');
    sh.setFrozenRows(1);
  });
  const stats = ss.getSheetByName('STATISTIQUES');
  if (stats.getLastRow() < 2) {
    stats.getRange(2, 1, STATS.length, 2).setValues(STATS);
    stats.getRange(2, 3, STATS.length, 1).setValue('automatique');
    stats.getRange('B9').setNumberFormat('0.0%');
  }
  // Protection : l'onglet EXCLUSIONS ne doit jamais être vidé par erreur.
  const excl = ss.getSheetByName('EXCLUSIONS');
  excl.protect().setDescription('Liste d\'exclusion — modification avec précaution').setWarningOnly(true);
  // Supprime l'onglet vide par défaut s'il existe et qu'il est vide.
  const defaut = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (defaut && defaut.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(defaut);
  SpreadsheetApp.getUi().alert('Base commerciale prête. Identifiant à copier dans .env (GOOGLE_SHEET_ID) : ' + ss.getId());
}
