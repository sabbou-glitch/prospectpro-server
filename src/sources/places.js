// Source 2 (payante au-delà du quota gratuit) : Google Places API (New) — Text Search.
// Un seul appel par prospect (site web + téléphone + statut + avis).
// Tarif à vérifier : https://developers.google.com/maps/billing-and-pricing/pricing
// Les champs websiteUri/nationalPhoneNumber relèvent du SKU "Text Search Enterprise"
// (quota gratuit mensuel ~1 000 appels au moment de la rédaction). Le module budget
// bloque les appels avant ce seuil (PLACES_MONTHLY_LIMIT).
const config = require('../config');
const budget = require('../core/budget');

const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.websiteUri',
  'places.nationalPhoneNumber', 'places.businessStatus', 'places.types',
  'places.rating', 'places.userRatingCount', 'places.googleMapsUri',
].join(',');

async function findPlace({ entreprise, adresse, ville }, { fetchImpl = fetch, apiKey = config.googlePlacesKey } = {}) {
  if (!apiKey) return null; // enrichissement désactivé si pas de clé
  budget.assertCanSpend('google_places', config.pricing.googlePlacesPerCall);
  const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({ textQuery: [entreprise, adresse, ville].filter(Boolean).join(' '), languageCode: 'fr', regionCode: 'FR', maxResultCount: 1 }),
    signal: AbortSignal.timeout(10000),
  });
  budget.record('google_places', config.pricing.googlePlacesPerCall, { entreprise });
  if (!res.ok) throw new Error(`Google Places : HTTP ${res.status}`);
  const data = await res.json();
  const p = (data.places || [])[0];
  if (!p) return null;
  return {
    placeId: p.id,
    nomGoogle: p.displayName && p.displayName.text,
    adresseGoogle: p.formattedAddress || '',
    siteWeb: p.websiteUri || '',
    telephone: p.nationalPhoneNumber || '',
    statutGoogle: p.businessStatus || '',
    typesGoogle: p.types || [],
    noteGoogle: p.rating,
    nbAvisGoogle: p.userRatingCount || 0,
    googleMapsUri: p.googleMapsUri || '',
  };
}

module.exports = { findPlace };
