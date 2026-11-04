// Accès à l'API Claude, avec contrôle budgétaire avant/après chaque appel et sorties JSON structurées.
const Anthropic = require('@anthropic-ai/sdk');
const AnthropicClient = Anthropic.default || Anthropic;
const config = require('../config');
const budget = require('../core/budget');
const log = require('../core/logger');

let client = null;
function getClient() {
  if (!config.anthropicKey) return null;
  if (!client) client = new AnthropicClient({ apiKey: config.anthropicKey, maxRetries: 2, timeout: 120000 });
  return client;
}

/**
 * Appel avec sortie JSON garantie par schéma (structured outputs).
 * @returns {Promise<{data: object, costUsd: number, model: string}>}
 */
async function callJson({ agent, model, system, user, schema, effort = 'low', maxTokens = 4000, estimateUsd = 0.02 }) {
  const c = getClient();
  if (!c) throw new Error('ANTHROPIC_API_KEY absente : fonction IA désactivée.');
  budget.assertCanSpend('anthropic', estimateUsd);

  const params = {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };

  let response;
  if (model.startsWith('claude-opus') || model.startsWith('claude-fable')) {
    // Repli automatique côté serveur si le modèle principal refuse la requête.
    response = await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } else {
    response = await c.messages.create(params);
  }

  const costUsd = budget.claudeCostUsd(model, response.usage);
  budget.record('anthropic', costUsd, { agent, model });

  if (response.stop_reason === 'refusal') {
    log.warn(agent, 'Requête refusée par le modèle', { model });
    throw new Error('Le modèle a refusé la requête.');
  }
  if (response.stop_reason === 'max_tokens') throw new Error('Réponse tronquée (max_tokens).');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`JSON invalide renvoyé par le modèle : ${e.message}`); }
  return { data, costUsd, model: response.model || model };
}

module.exports = { callJson, getClient };
