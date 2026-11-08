// Serveur des agents : appelé par n8n (planification, Google Sheets, Gmail).
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const log = require('./core/logger');
const budget = require('./core/budget');
const { runResearch, TARGETS } = require('./agents/research');
const { draftEmail, draftFollowUp, analyzeReply } = require('./agents/prospection');
const { calculerDevis } = require('./agents/devis');
const { buildDailyReport } = require('./agents/report');
const { searchCompanies } = require('./sources/insee');
const { findPlace } = require('./sources/places');
const { analyzeWebsite } = require('./enrich/website');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok', paused: isPaused(), budget: budget.status() }));

  // --- Routes historiques (compatibilité avec l'outil ProspectPro existant) ---
  app.get('/search', cors(), async (req, res) => {
    const { metier, ville, page = 1 } = req.query;
    if (!metier || !ville) return res.status(400).json({ error: 'metier et ville requis' });
    try {
      const r = await searchCompanies({ query: `${metier} ${ville}`, page: Number(page) });
      const results = r.results.map((c) => ({
        Nom: c.entreprise, Adresse: c.adresse, 'Code Postal': c.codePostal, Ville: c.ville || ville,
        Telephone: '', Email: '', Activite: c.activiteNaf, SIRET: c.siret, Source: 'INSEE',
      }));
      res.json({ results, total: r.total, page: Number(page), totalPages: r.totalPages, metier, ville });
    } catch (err) {
      log.error('api', 'search', { error: err.message });
      res.status(500).json({ error: 'Erreur INSEE', details: err.message });
    }
  });

  app.get('/enrich', cors(), async (req, res) => {
    const { nom, adresse, ville } = req.query;
    if (!nom) return res.status(400).json({ error: 'nom requis' });
    try {
      const place = await findPlace({ entreprise: nom, adresse, ville });
      const site = place && place.siteWeb ? await analyzeWebsite(place.siteWeb) : { email: '' };
      res.json({ telephone: (place && place.telephone) || '', website: (place && place.siteWeb) || '', email: site.email || '' });
    } catch (err) {
      log.error('api', 'enrich', { error: err.message });
      res.json({ telephone: '', website: '', email: '' });
    }
  });

  // --- Routes des agents (protégées par jeton) ---
  const agent = express.Router();
  agent.use((req, res, next) => {
    if (!config.serverApiToken) return res.status(503).json({ error: 'SERVER_API_TOKEN non configuré : routes agents désactivées.' });
    if (req.get('X-API-Key') !== config.serverApiToken) return res.status(401).json({ error: 'Non autorisé' });
    next();
  });
  agent.use((req, res, next) => {
    if (req.method !== 'GET' && isPaused()) return res.status(503).json({ error: 'Agents en pause (fichier data/PAUSE ou AGENTS_PAUSED=true).' });
    next();
  });

  agent.get('/budget', (req, res) => res.json(budget.status()));
  agent.get('/categories', (req, res) => res.json(Object.entries(TARGETS.categories)
    .map(([key, c]) => ({ key, label: c.label, priority: c.priority })).sort((a, b) => a.priority - b.priority)));

  agent.post('/research', wrap(async (req) => runResearch(req.body || {})));

  agent.post('/draft', wrap(async (req) => {
    const { prospects = [], exclusions = [], max = 10 } = req.body || {};
    const out = [];
    for (const row of prospects.slice(0, Math.min(max, 30))) {
      try { out.push(await draftEmail(row, { exclusions })); }
      catch (e) { out.push({ id: row['ID'], ok: false, bloque: false, raisons: [e.message] }); if (e instanceof budget.BudgetExceededError) break; }
    }
    return { brouillons: out };
  }));

  agent.post('/followup', wrap(async (req) => {
    const { prospects = [], exclusions = [], max = 15 } = req.body || {};
    return { relances: prospects.slice(0, Math.min(max, 30)).map((row) => draftFollowUp(row, { exclusions })) };
  }));
  agent.post('/devis/calcul', wrap(async (req) => calculerDevis(req.body || {})));
  agent.post('/reply', wrap(async (req) => analyzeReply(req.body || {})));
  agent.post('/report', wrap(async (req) => buildDailyReport(req.body || {})));

  app.use('/agent', agent);

  app.use((err, req, res, _next) => {
    log.error('api', 'Erreur non gérée', { error: err.message });
    res.status(500).json({ error: err.message });
  });
  return app;
}

function wrap(fn) {
  return async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      const status = e instanceof budget.BudgetExceededError ? 402 : (e.retryable ? 503 : 500);
      log.error('api', req.path, { error: e.message });
      res.status(status).json({ error: e.message, retryable: !!e.retryable });
    }
  };
}

function isPaused() {
  return process.env.AGENTS_PAUSED === 'true' || fs.existsSync(path.join(config.dataDir, 'PAUSE'));
}

if (require.main === module) {
  const host = process.env.HOST || '0.0.0.0';
  createApp().listen(config.port, host, () => log.info('api', `Serveur des agents démarré sur http://${host}:${config.port}`));
}

module.exports = { createApp };
