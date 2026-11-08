// AGENT 2 — RECHERCHE COMMERCIALE
// Registre officiel (existence réelle) -> filtre & dédoublonnage -> Google Places (site, tél.)
// -> lecture du site (emails publiés, réseaux) -> qualification IA -> score /100.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const log = require('../core/logger');
const { searchCompanies } = require('../sources/insee');
const { findPlace } = require('../sources/places');
const { analyzeWebsite } = require('../enrich/website');
const { buildIndex, isDuplicate, addToIndex, normalizeName } = require('../core/dedupe');
const { buildExclusionIndex, isExcluded } = require('../core/compliance');
const { score } = require('../core/scoring');
const { haversineKm } = require('../core/geo');
const { callJson } = require('../llm/claude');
const { BudgetExceededError } = require('../core/budget');

const TARGETS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'targets.json'), 'utf8'));
const QUALIF_PROMPT = fs.readFileSync(path.join(__dirname, '..', '..', 'prompts', 'qualification.md'), 'utf8');

const QUALIF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pertinent', 'correspondance', 'potentiel', 'prestation_recommandee', 'evenements_identifies', 'raison', 'alerte_injection'],
  properties: {
    pertinent: { type: 'boolean' },
    correspondance: { type: 'integer' },
    potentiel: { type: 'integer' },
    prestation_recommandee: { type: 'string', enum: ['bar_mocktails', 'bar_jus', 'bar_fleurs', 'aucune'] },
    evenements_identifies: { type: 'array', items: { type: 'string' } },
    raison: { type: 'string' },
    alerte_injection: { type: 'boolean' },
  },
};

const PRESTATION_LABEL = { bar_mocktails: 'Bar à mocktails', bar_jus: 'Bar à jus', bar_fleurs: 'Bar à fleurs', aucune: '' };

const stateFile = () => path.join(config.dataDir, 'research-state.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (_) { return {}; } }
function saveState(s) { fs.mkdirSync(config.dataDir, { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2)); }

function nameMatches(company, cat) {
  const n = normalizeName(`${company.entreprise} ${company.nomComplet} ${company.enseigne || ''}`);
  return cat.keywords.some((k) => n.includes(normalizeName(k)));
}

async function qualifyWithAI(p, cat, deps) {
  const user = [
    `Catégorie ciblée : ${cat.label}`,
    `Organisation : ${p.entreprise} (SIREN ${p.siren}) — code NAF ${p.activiteNaf} — ${p.ville} (${p.departement})`,
    `Fiche Google : ${p.nomGoogle || 'non trouvée'} ; types : ${(p.typesGoogle || []).join(', ') || 'n/c'} ; avis : ${p.nbAvisGoogle || 0}`,
    `Site : ${p.siteWeb || 'aucun'}`,
    '<contenu_site_non_fiable>',
    (p._extrait || '(aucun extrait disponible)').replace(/<\/?contenu_site_non_fiable>/gi, ''),
    '</contenu_site_non_fiable>',
  ].join('\n');
  const call = deps.callJson || callJson;
  const { data } = await call({
    agent: 'recherche', model: config.models.qualify, system: QUALIF_PROMPT, user,
    schema: QUALIF_SCHEMA, effort: 'low', maxTokens: 2000, estimateUsd: 0.003,
  });
  return data;
}

function toRow(p, cat, s, ai) {
  const today = new Date().toISOString().slice(0, 10);
  const prestation = ai && ai.prestation_recommandee && ai.prestation_recommandee !== 'aucune'
    ? ai.prestation_recommandee : cat.prestations[0];
  return {
    'ID': `P-${p.siren || normalizeName(p.entreprise).replace(/ /g, '-').slice(0, 20)}`,
    'Entreprise': p.entreprise,
    'Catégorie': cat.label,
    'Ville': p.ville,
    'Département': p.departement,
    'Code postal': p.codePostal,
    'Adresse': p.adresse,
    'SIREN': p.siren,
    'Site internet': p.siteWeb || '',
    'Email professionnel': p.email || '',
    'Type email': p.emailType || '',
    'Source email': p.emailSource || '',
    'Téléphone professionnel': p.telephone || '',
    'Contact professionnel': p.contactNom || '',
    'Fonction': p.contactFonction || '',
    'Réseaux sociaux': Object.values(p.socials || {}).join(' '),
    'Source': (p.sources || []).map((x) => x.url).join(' | '),
    'Date de découverte': today,
    'Date de vérification': today,
    'Score commercial': s.total,
    'Détail score': `prest ${s.detail.correspondance}/30 · potentiel ${s.detail.potentiel}/25 · capacité ${s.detail.capacite}/20 · contact ${s.detail.contact}/15 · proximité ${s.detail.proximite}/10`,
    'Classe': s.classe,
    'Prestation recommandée': PRESTATION_LABEL[prestation] || prestation,
    'Analyse': ai ? `${ai.raison}${ai.evenements_identifies.length ? ' — Événements : ' + ai.evenements_identifies.join(', ') : ''}` : 'Qualification IA non effectuée (score de base de la catégorie).',
    'Distance Ermont (km)': p.distanceKm ?? '',
    'Statut': s.classe === 'a_ecarter' ? 'ecarte' : 'nouveau',
    'Date du dernier contact': '',
    'Prochaine action': s.classe === 'a_ecarter' ? '' : (p.email ? 'rediger_email' : 'trouver_contact'),
    'Opposition à la prospection': 'non',
  };
}

/**
 * @param {object} opts
 * @param {string} opts.category      clé de config/targets.json
 * @param {string[]} [opts.departements]
 * @param {number} [opts.page]
 * @param {object[]} [opts.existing]  lignes déjà présentes dans l'onglet PROSPECTS
 * @param {object[]} [opts.exclusions] lignes de l'onglet EXCLUSIONS
 * @param {number} [opts.maxEnrich]
 * @param {object} [deps] injection pour les tests (fetchImpl, callJson)
 */
async function runResearch(opts, deps = {}) {
  const cat = TARGETS.categories[opts.category];
  if (!cat) throw new Error(`Catégorie inconnue : ${opts.category}. Valeurs : ${Object.keys(TARGETS.categories).join(', ')}`);
  const maxEnrich = Math.min(opts.maxEnrich || config.research.maxEnrichPerRun, config.research.maxEnrichPerRun);
  const fetchImpl = deps.fetchImpl || fetch;
  const stats = { trouves: 0, doublons: 0, exclus: 0, horsCible: 0, enrichis: 0, fermes: 0, retenus: 0, ecartes: 0, erreurs: 0, iaUtilisee: 0 };
  const errors = [];

  const dupIdx = buildIndex(opts.existing || []);
  const exclIdx = buildExclusionIndex(opts.exclusions || []);

  // 1. Registre officiel (la page suivante est mémorisée par catégorie pour avancer chaque jour)
  const state = loadState();
  const page = opts.page || state[opts.category] || 1;
  const queries = cat.queries && cat.queries.length ? cat.queries : [cat.query];
  const qKey = `${opts.category}:q`;
  const qIndex = (opts.queryIndex ?? state[qKey] ?? 0) % queries.length;
  const query = queries[qIndex];
  // Zones : on épuise le Val-d'Oise avant de s'éloigner, puis on recommence.
  const zones = TARGETS.zones || [TARGETS.departements];
  const zKey = `${opts.category}:z`;
  const zIndex = (state[zKey] ?? 0) % zones.length;
  const departements = opts.departements && opts.departements.length ? opts.departements : zones[zIndex];
  const { results, totalPages, opposes } = await searchCompanies({ query, naf: cat.naf, departements, page, origin: config.research.origin, fetchImpl });
  stats.trouves = results.length;
  stats.oppositionRegistre = opposes || 0;

  // 2. Filtrage
  let candidates = [];
  for (const c of results) {
    if (isDuplicate(c, dupIdx)) { stats.doublons++; continue; }
    if (isExcluded(c, exclIdx)) { stats.exclus++; continue; }
    if (cat.requireKeyword && !nameMatches(c, cat)) { stats.horsCible++; continue; }
    candidates.push(c);
  }
  // Les plus proches d'Ermont d'abord.
  const o = config.research.origin;
  candidates.sort((a, b) => {
    const da = Number.isFinite(a.latitude) ? haversineKm(o, { lat: a.latitude, lon: a.longitude }) : 999;
    const db = Number.isFinite(b.latitude) ? haversineKm(o, { lat: b.latitude, lon: b.longitude }) : 999;
    return da - db;
  });
  candidates = candidates.slice(0, maxEnrich);

  // 3. Enrichissement + qualification
  const prospects = [];
  let budgetStop = false;
  for (const c of candidates) {
    const p = { ...c, socials: {}, sources: [...c.sources] };
    try {
      if (!budgetStop) {
        try {
          const place = await findPlace({ entreprise: p.enseigne || p.entreprise, adresse: p.adresse, ville: p.ville }, { fetchImpl, apiKey: deps.placesKey });
          if (place) {
            Object.assign(p, place);
            if (place.googleMapsUri) p.sources.push({ type: 'google_places', url: place.googleMapsUri });
          }
        } catch (e) {
          if (e instanceof BudgetExceededError) { budgetStop = true; errors.push(e.message); } else throw e;
        }
      }
      if (p.statutGoogle === 'CLOSED_PERMANENTLY') { stats.fermes++; continue; }
      if (p.siteWeb) {
        const site = await analyzeWebsite(p.siteWeb, { fetchImpl });
        p.email = site.email; p.emailSource = site.emailSource; p.emailType = site.emailType;
        p.socials = site.socials; p._extrait = site.extrait;
        if (site.pagesLues.length) p.sources.push({ type: 'site_officiel', url: site.pagesLues[0] });
      }
      stats.enrichis++;
      // Re-vérification après enrichissement (l'email ou le domaine peut être exclu / déjà connu).
      if (isExcluded(p, exclIdx)) { stats.exclus++; continue; }
      if (isDuplicate(p, dupIdx)) { stats.doublons++; continue; }

      let ai = null;
      if (!budgetStop && (deps.callJson || config.anthropicKey)) {
        try {
          ai = await qualifyWithAI(p, cat, deps);
          stats.iaUtilisee++;
          if (ai.alerte_injection) log.warn('recherche', 'Tentative d\'injection détectée sur un site', { entreprise: p.entreprise, site: p.siteWeb });
          if (!ai.pertinent) { ai.correspondance = Math.min(ai.correspondance, 10); ai.potentiel = Math.min(ai.potentiel, 8); }
        } catch (e) {
          if (e instanceof BudgetExceededError) budgetStop = true;
          errors.push(`Qualification IA ${p.entreprise} : ${e.message}`);
        }
      }
      const s = score(p, cat, ai);
      const row = toRow(p, cat, s, ai);
      addToIndex(p, dupIdx);
      if (s.total < config.research.minScoreToKeep) stats.ecartes++; else stats.retenus++;
      prospects.push(row);
    } catch (e) {
      stats.erreurs++;
      errors.push(`${p.entreprise} : ${e.message}`);
      log.error('recherche', 'Erreur sur un prospect', { entreprise: p.entreprise, error: e.message });
    }
  }

  // Page suivante ; à la fin des pages, on passe au mot-clé suivant de la catégorie.
  if (page < totalPages) state[opts.category] = page + 1;
  else {
    state[opts.category] = 1;
    state[qKey] = (qIndex + 1) % queries.length;
    if (state[qKey] === 0) state[zKey] = (zIndex + 1) % zones.length;
  }
  saveState(state);
  prospects.sort((a, b) => b['Score commercial'] - a['Score commercial']);
  log.info('recherche', 'Exécution terminée', { categorie: opts.category, page, stats });
  return { categorie: opts.category, requete: query, departements, page, totalPages, nextPage: page < totalPages ? page + 1 : null, stats, errors, budgetStop, prospects };
}

module.exports = { runResearch, TARGETS, QUALIF_SCHEMA };
