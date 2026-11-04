// Contrôle des coûts : registre mensuel des dépenses (data/budget-AAAA-MM.json).
// Chaque appel payant passe par assertCanSpend() AVANT et record() APRÈS.
// Au-delà du plafond mensuel, les appels payants sont refusés (arrêt automatique).
const fs = require('fs');
const path = require('path');
const config = require('../config');

class BudgetExceededError extends Error {
  constructor(msg) { super(msg); this.name = 'BudgetExceededError'; }
}

function monthKey(d = new Date()) { return d.toISOString().slice(0, 7); }
function file(month) { return path.join(config.dataDir, `budget-${month}.json`); }

function load(month = monthKey()) {
  try { return JSON.parse(fs.readFileSync(file(month), 'utf8')); }
  catch (_) { return { month, totalUsd: 0, byProvider: {}, placesCalls: 0, calls: 0 }; }
}

function save(state) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(state.month), JSON.stringify(state, null, 2));
}

function totalEur(state = load()) { return state.totalUsd * config.budget.usdToEur; }

function assertCanSpend(provider, estimatedUsd = 0) {
  const s = load();
  if (provider === 'google_places' && s.placesCalls >= config.budget.placesMonthlyLimit) {
    throw new BudgetExceededError(`Quota mensuel Google Places atteint (${s.placesCalls}/${config.budget.placesMonthlyLimit}).`);
  }
  const projected = (s.totalUsd + estimatedUsd) * config.budget.usdToEur;
  if (projected > config.budget.monthlyCapEur) {
    throw new BudgetExceededError(`Plafond mensuel atteint : ${projected.toFixed(2)} € > ${config.budget.monthlyCapEur} €.`);
  }
}

function record(provider, usd, meta = {}) {
  const s = load();
  s.totalUsd = +(s.totalUsd + usd).toFixed(6);
  s.byProvider[provider] = +((s.byProvider[provider] || 0) + usd).toFixed(6);
  s.calls += 1;
  if (provider === 'google_places') s.placesCalls += 1;
  s.lastCall = { provider, usd, at: new Date().toISOString(), ...meta };
  save(s);
  return s;
}

function claudeCostUsd(model, usage) {
  const p = config.pricing[model];
  if (!p || !usage) return 0;
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25
    + (usage.cache_read_input_tokens || 0) * 0.1;
  return (inTok * p.in + (usage.output_tokens || 0) * p.out) / 1e6;
}

function status() {
  const s = load();
  const eur = totalEur(s);
  return {
    month: s.month,
    spentEur: +eur.toFixed(2),
    capEur: config.budget.monthlyCapEur,
    ratio: +(eur / config.budget.monthlyCapEur).toFixed(3),
    alert: eur >= config.budget.monthlyCapEur * config.budget.alertRatio,
    stopped: eur >= config.budget.monthlyCapEur,
    placesCalls: s.placesCalls,
    placesLimit: config.budget.placesMonthlyLimit,
    byProviderEur: Object.fromEntries(Object.entries(s.byProvider).map(([k, v]) => [k, +(v * config.budget.usdToEur).toFixed(3)])),
  };
}

module.exports = { assertCanSpend, record, claudeCostUsd, status, BudgetExceededError, load };
