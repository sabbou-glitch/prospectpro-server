// Source 1 (gratuite, officielle) : API Recherche d'entreprises (data.gouv / INSEE / RNE).
// https://recherche-entreprises.api.gouv.fr/docs/  — limite indicative : 7 requêtes/seconde.
// Vérifie l'existence réelle de l'organisation (SIREN, état administratif actif).
const BASE = 'https://recherche-entreprises.api.gouv.fr/search';

async function searchCompanies({ query, naf = [], departements = [], page = 1, perPage = 25, fetchImpl = fetch }) {
  const params = new URLSearchParams({ per_page: String(perPage), page: String(page), etat_administratif: 'A' });
  if (query) params.set('q', query);
  if (naf.length) params.set('activite_principale', naf.join(','));
  if (departements.length) params.set('departement', departements.join(','));
  const url = `${BASE}?${params}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) throw Object.assign(new Error('API Recherche d\'entreprises : trop de requêtes (429)'), { retryable: true });
  if (!res.ok) throw new Error(`API Recherche d'entreprises : HTTP ${res.status}`);
  const data = await res.json();
  return {
    total: data.total_results || 0,
    totalPages: data.total_pages || 1,
    results: (data.results || []).map((r) => mapCompany(r, url)),
  };
}

function mapCompany(r, sourceUrl) {
  const s = r.siege || {};
  const dirigeant = (r.dirigeants || []).find((d) => d.type_dirigeant === 'personne physique' && d.nom);
  const lat = parseFloat(s.latitude), lon = parseFloat(s.longitude);
  return {
    siren: r.siren || '',
    siret: s.siret || '',
    entreprise: r.nom_raison_sociale || r.nom_complet || '',
    nomComplet: r.nom_complet || '',
    adresse: s.adresse || '',
    codePostal: s.code_postal || '',
    ville: s.libelle_commune || '',
    departement: s.departement || (s.code_postal || '').slice(0, 2),
    latitude: Number.isFinite(lat) ? lat : undefined,
    longitude: Number.isFinite(lon) ? lon : undefined,
    activiteNaf: r.activite_principale || s.activite_principale || '',
    trancheEffectif: r.tranche_effectif_salarie || 'NN',
    dateCreation: r.date_creation || '',
    estAssociation: !!(r.complements && r.complements.est_association),
    estCollectivite: !!(r.complements && r.complements.collectivite_territoriale),
    // Dirigeant déclaré au registre officiel (donnée publique) : utilisé comme contact potentiel.
    contactNom: dirigeant ? [dirigeant.prenoms, dirigeant.nom].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() : '',
    contactFonction: dirigeant ? (dirigeant.qualite || '') : '',
    sources: [{ type: 'registre_officiel', url: sourceUrl }],
  };
}

module.exports = { searchCompanies, mapCompany };
