// Source 1 (gratuite, officielle) : API Recherche d'entreprises (data.gouv / INSEE / RNE).
// https://recherche-entreprises.api.gouv.fr/docs/  — limite : quelques requêtes/seconde.
// Vérifie l'existence réelle de l'organisation (SIREN, état administratif actif).
//
// Constats sur données réelles (nov. 2026) :
//  - la recherche texte est un ET entre les mots : utiliser UN mot-clé par requête ;
//  - le filtre département porte sur les établissements : le siège peut être ailleurs
//    (Lyon, Brest…). On utilise l'établissement local qui correspond ("matching_etablissements") ;
//  - l'API coupe la connexion si on enchaîne trop vite : pause + nouvelles tentatives ;
//  - le champ "opposition_diffusion_commerciale" signale une opposition à la prospection.
const BASE = 'https://recherche-entreprises.api.gouv.fr/search';
const { haversineKm } = require('../core/geo');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

async function fetchWithRetry(url, fetchImpl, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const wait = Math.max(0, lastCall + 600 - Date.now());
    if (wait) await sleep(wait);
    lastCall = Date.now();
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { retryable: true });
      if (!res.ok) throw new Error(`API Recherche d'entreprises : HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      const retryable = e.retryable || e.name === 'TypeError' || e.name === 'TimeoutError' || /fetch failed|reset|ECONN/i.test(e.message);
      if (!retryable || i === tries - 1) break;
      await sleep(1500 * 2 ** i);
    }
  }
  throw Object.assign(new Error(`API Recherche d'entreprises indisponible : ${lastErr.message}`), { retryable: true });
}

async function searchCompanies({ query, naf = [], departements = [], page = 1, perPage = 25, origin, fetchImpl = fetch }) {
  const params = new URLSearchParams({ per_page: String(perPage), page: String(page), etat_administratif: 'A' });
  if (query) params.set('q', query);
  if (naf.length) params.set('activite_principale', naf.join(','));
  if (departements.length) params.set('departement', departements.join(','));
  const url = `${BASE}?${params}`;
  const data = await fetchWithRetry(url, fetchImpl);
  const results = [];
  let opposes = 0;
  for (const r of data.results || []) {
    if (r.opposition_diffusion_commerciale === true) { opposes++; continue; }
    const c = mapCompany(r, url, { departements, naf, origin });
    if (c) results.push(c);
  }
  return { total: data.total_results || 0, totalPages: data.total_pages || 1, results, opposes };
}

/** Choisit l'établissement local le plus pertinent : dans la zone, actif, code NAF ciblé, proche d'Ermont. */
function pickEstablishment(r, { departements = [], naf = [], origin } = {}) {
  const list = [...(r.matching_etablissements || [])];
  if (r.siege) list.push({ ...r.siege, est_siege: true });
  const inZone = (e) => !departements.length || departements.includes(e.departement || String(e.code_postal || '').slice(0, 2));
  const candidates = list.filter((e) => (e.etat_administratif || 'A') === 'A' && !e.date_fermeture && inZone(e));
  if (!candidates.length) return null;
  const rank = (e) => {
    let s = 0;
    if (naf.includes(e.activite_principale)) s -= 1000;
    const lat = parseFloat(e.latitude), lon = parseFloat(e.longitude);
    s += origin && Number.isFinite(lat) ? haversineKm(origin, { lat, lon }) : 500;
    return s;
  };
  return candidates.sort((a, b) => rank(a) - rank(b))[0];
}

// "MAIRIE" seul n'est pas exploitable : on précise la commune.
function displayName(r, e) {
  const base = r.nom_raison_sociale || r.nom_complet || '';
  // Entrepreneur individuel : on affiche son nom commercial plutôt que son nom de famille.
  if (String(r.nature_juridique) === '1000') {
    const commercial = e.nom_commercial || (e.liste_enseignes || [])[0];
    const paren = (r.nom_complet || '').match(/\(([^()]+)\)\s*$/);
    if (commercial) return commercial;
    if (paren) return paren[1].trim();
  }
  if (/^(mairie|commune)( annexe)?$/i.test(base.trim()) && e.libelle_commune) return `${base.trim()} DE ${e.libelle_commune}`;
  return base;
}

function mapCompany(r, sourceUrl, ctx = {}) {
  const e = pickEstablishment(r, ctx);
  if (!e) return null;
  // Diffusion partielle : l'adresse d'un entrepreneur individuel est masquée -> inutilisable.
  if (r.statut_diffusion === 'P' || e.statut_diffusion_etablissement === 'P') return null;
  const nj = String(r.nature_juridique || '');
  // Sociétés civiles (SCI…) : patrimoine immobilier, pas des organisateurs d'événements.
  if (nj.startsWith('65') || /^SCI\b/i.test(r.nom_complet || '')) return null;
  // Entrepreneur individuel en location immobilière : souvent un particulier bailleur.
  if (nj === '1000' && /^68\.20/.test(e.activite_principale || r.activite_principale || '')) return null;
  const dirigeant = (r.dirigeants || []).find((d) => d.type_dirigeant === 'personne physique' && d.nom);
  const lat = parseFloat(e.latitude), lon = parseFloat(e.longitude);
  const enseigne = e.nom_commercial || (e.liste_enseignes || [])[0] || '';
  return {
    siren: r.siren || '',
    siret: e.siret || '',
    entreprise: displayName(r, e),
    nomComplet: r.nom_complet || '',
    enseigne,
    adresse: e.adresse || '',
    codePostal: e.code_postal || '',
    ville: e.libelle_commune || '',
    departement: e.departement || String(e.code_postal || '').slice(0, 2),
    latitude: Number.isFinite(lat) ? lat : undefined,
    longitude: Number.isFinite(lon) ? lon : undefined,
    estSiege: !!e.est_siege,
    activiteNaf: e.activite_principale || r.activite_principale || '',
    trancheEffectif: r.tranche_effectif_salarie || 'NN',
    dateCreation: r.date_creation || '',
    natureJuridique: nj,
    estAssociation: !!(r.complements && r.complements.est_association),
    estCollectivite: !!(r.complements && r.complements.collectivite_territoriale),
    // Dirigeant déclaré au registre officiel (donnée publique) : utilisé comme contact potentiel.
    contactNom: dirigeant ? [dirigeant.prenoms, dirigeant.nom].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() : '',
    contactFonction: dirigeant ? (dirigeant.qualite || '') : '',
    sources: [{ type: 'registre_officiel', url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}` }],
    _requete: sourceUrl,
  };
}

module.exports = { searchCompanies, mapCompany, pickEstablishment };
