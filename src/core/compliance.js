// Règles de conformité (RGPD / CNIL) appliquées AVANT toute préparation ou tout envoi d'email.
// Principes retenus (voir docs/04-CONFORMITE-RGPD.md) :
//  - Prospection uniquement de personnes morales (SIREN) via leurs coordonnées professionnelles.
//  - Jamais de prospection de particuliers par email sans consentement préalable.
//  - Le message doit être en rapport avec l'activité professionnelle du destinataire.
//  - Information du destinataire (origine des données) et droit d'opposition simple dans chaque email.
//  - Liste d'exclusion centralisée vérifiée systématiquement (email, domaine, SIREN).
const { domainOf } = require('./dedupe');

const PERSONAL_DOMAINS = /@(gmail|yahoo|hotmail|outlook|live|orange|free|sfr|laposte|wanadoo|icloud|aol)\./i;

function buildExclusionIndex(rows = []) {
  const idx = { emails: new Set(), domains: new Set(), sirens: new Set(), names: new Set() };
  for (const r of rows) {
    const email = (r.email || r.Email || r['Email professionnel'] || '').toLowerCase().trim();
    if (email) { idx.emails.add(email); }
    const dom = (r.domaine || r.Domaine || '').toLowerCase().trim() || (email && !PERSONAL_DOMAINS.test(email) ? email.split('@')[1] : '');
    if (dom) idx.domains.add(dom.replace(/^www\./, ''));
    const siren = String(r.siren || r.SIREN || '').trim();
    if (siren) idx.sirens.add(siren);
    const name = (r.entreprise || r.Entreprise || '').toLowerCase().trim();
    if (name) idx.names.add(name);
  }
  return idx;
}

function isExcluded(p, idx) {
  if (!idx) return false;
  const email = (p.email || '').toLowerCase();
  if (email && idx.emails.has(email)) return true;
  const d1 = domainOf(p.siteWeb);
  const d2 = email && !PERSONAL_DOMAINS.test(email) ? email.split('@')[1] : '';
  if ((d1 && idx.domains.has(d1)) || (d2 && idx.domains.has(d2))) return true;
  if (p.siren && idx.sirens.has(String(p.siren))) return true;
  if (p.entreprise && idx.names.has(p.entreprise.toLowerCase().trim())) return true;
  return false;
}

/** Type d'adresse : générique (contact@) ou nominative (donnée personnelle). */
function emailType(email = '') {
  const local = email.split('@')[0].toLowerCase();
  if (/^(contact|info|infos|hello|bonjour|accueil|reservation|reservations|evenement|evenements|events?|commercial|direction|secretariat|mairie|cse|ce|communication|admin)\b/.test(local)) return 'generique';
  return 'nominative';
}

/**
 * Vérifie qu'un prospect peut recevoir un email de prospection.
 * Retourne { ok, reasons[] }.
 */
function canProspect(p, exclusionIdx) {
  const reasons = [];
  if (!p.email) reasons.push('Aucune adresse email professionnelle vérifiée.');
  if (!p.siren) reasons.push('Organisation non identifiée par un SIREN (risque de particulier).');
  if (p.opposition === true || /^oui$/i.test(p.opposition || '')) reasons.push('Opposition à la prospection enregistrée.');
  if (isExcluded(p, exclusionIdx)) reasons.push("Présent dans la liste d'exclusion.");
  if (!p.emailSource) reasons.push("Source publique de l'email non enregistrée.");
  if (['ecarte', 'client', 'refus'].includes((p.statut || '').toLowerCase())) reasons.push(`Statut incompatible : ${p.statut}.`);
  return { ok: reasons.length === 0, reasons };
}

/** Mentions obligatoires ajoutées à CHAQUE email (non modifiables par l'IA). */
function legalFooter(sender) {
  return [
    '',
    '—',
    `${sender.companyName}${sender.website ? ' · ' + sender.website : ''}`,
    "Vous recevez ce message car vos coordonnées professionnelles sont publiées sur votre site ou un annuaire professionnel, et notre offre concerne votre activité.",
    "Si vous ne souhaitez plus être contacté(e), répondez simplement « STOP » : vous ne recevrez plus aucun message de notre part.",
  ].join('\n');
}

/** Détecte une demande d'opposition dans une réponse reçue. */
function isOptOut(text = '') {
  return /(^|\s)(stop|désinscri|desinscri|unsubscribe|ne plus (me |nous )?(contacter|recevoir|écrire|ecrire)|retirez[- ]nous|retirez[- ]moi|supprimez (mes|nos) (coordonnées|données)|pas intéress)/i.test(text);
}

module.exports = { buildExclusionIndex, isExcluded, canProspect, legalFooter, isOptOut, emailType, PERSONAL_DOMAINS };
