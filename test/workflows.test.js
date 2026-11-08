// Exécute le code des nœuds n8n avec des données fictives pour vérifier leur logique.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function load(file) { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'n8n', file), 'utf8')); }
function run(wf, nodeName, nodes, input = []) {
  const n = wf.nodes.find((x) => x.name === nodeName);
  const $ = (name) => ({ all: () => (nodes[name] || []).map((json) => ({ json })), first: () => ({ json: (nodes[name] || [])[0] }) });
  const $input = { all: () => input.map((json) => ({ json })), first: () => ({ json: input[0] }) };
  const fn = new Function('$', '$input', '$getWorkflowStaticData', n.parameters.jsCode);
  return fn($, $input, () => ({}));
}

const prospects = [
  { ID: 'P-1', Entreprise: 'Domaine A', 'Email professionnel': 'contact@domaine-a.fr', Statut: 'brouillon_pret', Relances: '' },
  { ID: 'P-2', Entreprise: 'Traiteur B', 'Email professionnel': 'traiteurb@gmail.com', Statut: 'contacte', 'Prochaine action': 'relance_brouillon_pret', Relances: '0' },
  { ID: 'P-3', Entreprise: 'CSE C', 'Email professionnel': 'cse@c.fr', Statut: 'contacte', 'Prochaine action': 'relance', Relances: '0', 'Date du dernier contact': '2026-01-01', 'Opposition à la prospection': 'non' },
];

test('04 : envois détectés -> statut contacte et compteur de relances', () => {
  const wf = load('04-suivi-envois-reponses.json');
  const out = run(wf, 'Envois détectés', {
    'Lire PROSPECTS': prospects, 'Lire CONTACTS': [{ 'Gmail thread ID': 'deja' }],
    'Gmail : messages envoyés': [
      { id: 'm1', to: { value: [{ address: 'Contact@Domaine-A.fr' }] }, subject: 'Bonjour' },
      { id: 'm2', to: 'Traiteur B <traiteurb@gmail.com>', subject: 'Relance' },
      { id: 'deja', to: 'cse@c.fr' },
      { id: 'm3', to: 'inconnu@ailleurs.fr' },
    ],
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].json.maj, { ID: 'P-1', Statut: 'contacte', 'Date du dernier contact': new Date().toISOString().slice(0, 10), 'Prochaine action': 'relance', Relances: 0 });
  assert.equal(out[1].json.maj.Relances, 1);
});

test('04 : réponses reconnues par email ou domaine, opposition -> exclusion', () => {
  const wf = load('04-suivi-envois-reponses.json');
  const recus = run(wf, 'Réponses de prospects', {
    'Lire PROSPECTS': prospects, 'Lire CONTACTS': [],
    'Gmail : messages reçus': [
      { id: 'r1', from: { value: [{ address: 'marie@domaine-a.fr' }] }, subject: 'Re', text: 'STOP' },
      { id: 'r2', from: 'pub@newsletter.com', text: 'promo' },
      { id: 'r3', from: 'autre@gmail.com', text: 'x' },
    ],
  });
  assert.equal(recus.length, 1, 'le domaine gmail.com ne doit pas faire correspondre un inconnu');
  const dec = run(wf, 'Décisions', { 'Réponses de prospects': recus.map((r) => r.json) }, [{ categorie: 'opposition', resume: 'stop', action_recommandee: 'exclure' }]);
  assert.equal(dec[0].json.maj['Opposition à la prospection'], 'oui');
  assert.equal(dec[0].json.exclusion.Email, 'marie@domaine-a.fr');
  const ok = run(wf, 'Décisions', { 'Réponses de prospects': recus.map((r) => r.json) }, [{ categorie: 'demande_devis', resume: 'devis', action_recommandee: 'devis' }]);
  assert.equal(ok[0].json.maj['Prochaine action'], 'preparer_devis');
  assert.equal(ok[0].json.exclusion, null);
});

test('05 : sélection des relances', () => {
  const out = run(load('05-relances.json'), 'Prospects à relancer', { 'Lire PROSPECTS': prospects, 'Lire EXCLUSIONS': [] });
  assert.deepEqual(out[0].json.prospects.map((p) => p.ID), ['P-3']);
});

test('02 : sélection des brouillons (score >= 60, email, nouveau)', () => {
  const rows = [
    { ID: 'a', 'Prochaine action': 'rediger_email', Statut: 'nouveau', 'Score commercial': '75', 'Email professionnel': 'a@a.fr' },
    { ID: 'b', 'Prochaine action': 'rediger_email', Statut: 'nouveau', 'Score commercial': '50', 'Email professionnel': 'b@b.fr' },
    { ID: 'c', 'Prochaine action': 'rediger_email', Statut: 'nouveau', 'Score commercial': '90', 'Email professionnel': 'c@c.fr', 'Opposition à la prospection': 'oui' },
  ];
  const out = run(load('02-brouillons-emails.json'), 'Sélection du jour', { 'Lire PROSPECTS': rows, 'Lire EXCLUSIONS': [] });
  assert.deepEqual(out[0].json.prospects.map((p) => p.ID), ['a']);
});

test('01 : rotation des cibles du jour', () => {
  const out = run(load('01-recherche-quotidienne.json'), 'Choisir les cibles du jour', { 'Lire PROSPECTS': [], 'Lire EXCLUSIONS': [] });
  assert.ok(out.length >= 1 && out.every((o) => o.json.category));
});
