// Notation sur 100 selon la grille validée par le dirigeant :
//  Correspondance prestations 30 · Potentiel événementiel 25 · Capacité commerciale 20
//  Facilité de contact 15 · Proximité géographique 10
const config = require('../config');

function clamp(v, min, max) { return Math.max(min, Math.min(max, Math.round(v))); }

function haversineKm(a, b) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const DEPT_FALLBACK = { '95': 10, '75': 8, '92': 8, '78': 7, '93': 7, '94': 6, '60': 4, '77': 3, '91': 3, '27': 3 };

function proximity(p) {
  if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
    const km = haversineKm(config.research.origin, { lat: p.latitude, lon: p.longitude });
    p.distanceKm = Math.round(km);
    if (km <= 15) return 10;
    if (km <= 25) return 8;
    if (km <= 40) return 6;
    if (km <= 60) return 4;
    if (km <= 90) return 2;
    return 0;
  }
  return DEPT_FALLBACK[p.departement] ?? 0;
}

// Tranches d'effectif INSEE -> points (sur 14) ; le reste (6) vient de la notoriété Google.
const EFFECTIF = { NN: 3, '00': 3, '01': 5, '02': 6, '03': 8, '11': 10, '12': 12, '21': 13, '22': 14, '31': 14, '32': 14, '41': 14, '42': 14, '51': 14, '52': 14, '53': 14 };

function capacity(p) {
  let pts = EFFECTIF[p.trancheEffectif] ?? 4;
  const reviews = p.nbAvisGoogle || 0;
  if (reviews >= 200) pts += 6; else if (reviews >= 50) pts += 4; else if (reviews >= 10) pts += 2;
  return clamp(pts, 0, 20);
}

function contactEase(p) {
  let pts = 0;
  if (p.email) pts += p.emailType === 'nominative' ? 10 : 9;
  if (p.telephone) pts += 3;
  if (p.contactNom) pts += 2;
  if (!p.email && p.siteWeb) pts += 1; // formulaire probable
  return clamp(pts, 0, 15);
}

/**
 * @param p prospect enrichi
 * @param cat catégorie (config/targets.json)
 * @param ai résultat de la qualification IA (optionnel) : { correspondance, potentiel }
 */
function score(p, cat, ai) {
  const fit = ai && Number.isFinite(ai.correspondance) ? clamp(ai.correspondance, 0, 30) : clamp(cat.baseFit, 0, 30);
  const potential = ai && Number.isFinite(ai.potentiel) ? clamp(ai.potentiel, 0, 25) : clamp(cat.basePotential, 0, 25);
  const detail = {
    correspondance: fit,
    potentiel: potential,
    capacite: capacity(p),
    contact: contactEase(p),
    proximite: proximity(p),
  };
  const total = Object.values(detail).reduce((a, b) => a + b, 0);
  return { total, detail, classe: classify(total) };
}

function classify(total) {
  if (total >= 80) return 'prioritaire';
  if (total >= 60) return 'interessant';
  if (total >= 40) return 'secondaire';
  return 'a_ecarter';
}

module.exports = { score, classify, haversineKm, proximity };
