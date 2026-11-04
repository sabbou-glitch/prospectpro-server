// Configuration centrale : tout ce qui est secret vient des variables d'environnement (.env).
// Aucun secret ne doit être écrit dans le code ni committé.
require('dotenv').config();
const path = require('path');

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Variable ${name} invalide : ${v}`);
  return n;
}

const config = {
  port: num('PORT', 3000),
  // Jeton partagé avec n8n : toutes les routes /agent/* l'exigent (en-tête X-API-Key).
  serverApiToken: process.env.SERVER_API_TOKEN || '',
  googlePlacesKey: process.env.GOOGLE_PLACES_API_KEY || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  models: {
    // Qualification en volume : modèle économique.
    qualify: process.env.MODEL_QUALIFY || 'claude-haiku-5-5',
    // Rédaction des emails : modèle le plus capable, effort bas pour limiter le coût.
    draft: process.env.MODEL_DRAFT || 'claude-opus-5-5',
    draftEffort: process.env.MODEL_DRAFT_EFFORT || 'low',
  },

  // Tarifs (USD par million de tokens) — à revérifier sur https://www.anthropic.com/pricing
  pricing: {
    'claude-haiku-5-5': { in: 0.10, out: 0.50 },
    'claude-opus-5-5': { in: 4.0, out: 20.0 },
    'claude-sonnet-5-5': { in: 2.0, out: 10.0 },
    // Google Places API (New) — Text Search avec site web/téléphone = SKU "Enterprise"
    googlePlacesPerCall: num('PLACES_USD_PER_CALL', 0.035),
  },

  budget: {
    usdToEur: num('USD_TO_EUR', 0.95),
    // Plafond mensuel global des agents (en €). Au-delà : arrêt automatique des appels payants.
    monthlyCapEur: num('BUDGET_MONTHLY_CAP_EUR', 15),
    // Alerte quand ce pourcentage du plafond est atteint.
    alertRatio: num('BUDGET_ALERT_RATIO', 0.7),
    // Quota gratuit Google Places (Enterprise) : 1 000 appels/mois. On s'arrête avant.
    placesMonthlyLimit: num('PLACES_MONTHLY_LIMIT', 900),
  },

  research: {
    // Nombre maximum de prospects enrichis (appels payants) par exécution.
    maxEnrichPerRun: num('RESEARCH_MAX_ENRICH_PER_RUN', 30),
    minScoreToKeep: num('RESEARCH_MIN_SCORE', 40),
    userAgent: process.env.CRAWLER_USER_AGENT || 'MaisonEvenementBot/1.0 (prospection B2B; respecte robots.txt)',
    origin: { name: 'Ermont', lat: 48.9906, lon: 2.2581 },
  },

  sender: {
    companyName: "Maison de l'Événement",
    signatureName: process.env.SENDER_NAME || '',
    email: process.env.SENDER_EMAIL || '',
    phone: process.env.SENDER_PHONE || '',
    website: process.env.SENDER_WEBSITE || '',
  },
};

module.exports = config;
