const { makeFetch, fakeClaude } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runResearch } = require('../src/agents/research');
const { draftEmail, analyzeReply, checkDraft } = require('../src/agents/prospection');
const { score, classify } = require('../src/core/scoring');
const { buildIndex, isDuplicate } = require('../src/core/dedupe');
const { canProspect, buildExclusionIndex, isOptOut, emailType } = require('../src/core/compliance');
const { robotsAllows, extractEmails } = require('../src/enrich/website');
const budget = require('../src/core/budget');
const { buildDailyReport } = require('../src/agents/report');

test('notation : grille 30/25/20/15/10 et classes', () => {
  const cat = { baseFit: 26, basePotential: 23 };
  const s = score({ latitude: 48.99, longitude: 2.26, email: 'contact@x.fr', telephone: '01', trancheEffectif: '11', nbAvisGoogle: 300 }, cat, null);
  assert.equal(s.detail.proximite, 10);
  assert.equal(s.detail.capacite, 16);
  assert.ok(s.total <= 100);
  assert.equal(classify(85), 'prioritaire');
  assert.equal(classify(65), 'interessant');
  assert.equal(classify(45), 'secondaire');
  assert.equal(classify(10), 'a_ecarter');
  const capped = score({}, cat, { correspondance: 99, potentiel: 99 });
  assert.equal(capped.detail.correspondance, 30);
  assert.equal(capped.detail.potentiel, 25);
});

test('dédoublonnage : SIREN, domaine, nom normalisé', () => {
  const idx = buildIndex([{ Entreprise: 'SARL Le Domaine des Roses', 'Code postal': '95120', SIREN: '111', 'Site internet': 'https://www.roses.fr' }]);
  assert.ok(isDuplicate({ siren: '111' }, idx));
  assert.ok(isDuplicate({ siteWeb: 'http://roses.fr/contact' }, idx));
  assert.ok(isDuplicate({ entreprise: 'Domaine des Roses SAS', codePostal: '95120' }, idx));
  assert.ok(!isDuplicate({ entreprise: 'Domaine des Roses', codePostal: '75001' }, idx));
});

test('robots.txt et extraction des emails', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /contact', '/contact'), false);
  assert.equal(robotsAllows('User-agent: googlebot\nDisallow: /', '/'), true);
  const e = extractEmails('<a href="mailto:Contact@Site.fr">x</a> info@autre.com logo@2x.png bob@gmail.com', 'site.fr');
  assert.deepEqual(e.sort(), ['bob@gmail.com', 'contact@site.fr']);
  assert.equal(emailType('contact@site.fr'), 'generique');
  assert.equal(emailType('alice.martin@site.fr'), 'nominative');
});

test('agent recherche : chaîne complète avec données fictives', async () => {
  const calls = []; const llm = [];
  const res = await runResearch({
    category: 'salle_reception',
    existing: [{ Entreprise: 'Salle déjà connue', SIREN: '900000004' }],
    exclusions: [],
  }, { fetchImpl: makeFetch(calls), callJson: fakeClaude(llm), placesKey: 'cle-test' });

  assert.equal(res.stats.trouves, 5, 'SCI et organisation opposée retirées dès le registre');
  assert.equal(res.stats.oppositionRegistre, 1);
  assert.equal(res.stats.doublons, 1, 'la salle déjà connue est ignorée');
  assert.equal(res.stats.horsCible, 1, 'le garage est écarté');
  assert.equal(res.prospects.length, 3);
  const lyon = res.prospects.find((p) => p.SIREN === '900000007');
  assert.equal(lyon.Ville, 'SARCELLES', "l'établissement local est utilisé, pas le siège lointain");
  const [top] = res.prospects;
  const second = res.prospects.find((p) => p.SIREN === '900000002');
  assert.equal(top.Entreprise, 'DOMAINE FICTIF DES TILLEULS');
  assert.equal(top['Email professionnel'], 'evenements@domaine-tilleuls.example.fr');
  assert.match(top['Source email'], /domaine-tilleuls/);
  assert.equal(top['Contact professionnel'], 'Alice TESTEUR');
  assert.ok(top['Score commercial'] >= 80, `score ${top['Score commercial']}`);
  assert.equal(top.Classe, 'prioritaire');
  assert.match(top['Réseaux sociaux'], /instagram/);
  assert.equal(second['Email professionnel'], 'contact@salle-lumieres.example.fr', 'email obfusqué [at] décodé');
  // Le contenu du site est transmis délimité comme donnée non fiable.
  assert.ok(llm.every((l) => l.user.includes('<contenu_site_non_fiable>')));
  // Les pages interdites par robots.txt ne sont pas lues.
  assert.ok(!calls.some((u) => u.includes('/admin')));
});

test('agent recherche : exclusion appliquée après enrichissement', async () => {
  const res = await runResearch({
    category: 'salle_reception',
    exclusions: [{ Email: 'evenements@domaine-tilleuls.example.fr' }],
  }, { fetchImpl: makeFetch(), callJson: fakeClaude(), placesKey: 'cle-test' });
  assert.ok(!res.prospects.some((p) => p.Entreprise === 'DOMAINE FICTIF DES TILLEULS'));
  assert.ok(res.stats.exclus >= 1);
});

test('conformité : blocage sans SIREN, sans source, en exclusion ou opposé', () => {
  const ok = { email: 'contact@a.fr', siren: '1', emailSource: 'https://a.fr/contact' };
  assert.ok(canProspect(ok).ok);
  assert.ok(!canProspect({ ...ok, siren: '' }).ok);
  assert.ok(!canProspect({ ...ok, emailSource: '' }).ok);
  assert.ok(!canProspect({ ...ok, opposition: 'oui' }).ok);
  assert.ok(!canProspect(ok, buildExclusionIndex([{ Domaine: 'a.fr' }])).ok);
  assert.ok(isOptOut('STOP'));
  assert.ok(isOptOut('Merci de ne plus nous contacter'));
  assert.ok(!isOptOut('Bonjour, pouvez-vous nous envoyer un devis ?'));
});

test('agent prospection : brouillon conforme avec mentions légales', async () => {
  const row = {
    ID: 'P-900000001', Entreprise: 'DOMAINE FICTIF DES TILLEULS', SIREN: '900000001', Catégorie: 'Salle de réception',
    Ville: 'ERMONT', Département: '95', 'Email professionnel': 'evenements@domaine-tilleuls.example.fr',
    'Source email': 'https://domaine-tilleuls.example.fr/', Statut: 'nouveau', 'Opposition à la prospection': 'non',
    'Prestation recommandée': 'Bar à mocktails', Analyse: 'mariages',
  };
  const d = await draftEmail(row, { exclusions: [] }, { callJson: fakeClaude() });
  assert.equal(d.ok, true, JSON.stringify(d.raisons));
  assert.match(d.corps, /répondez simplement « STOP »/);
  assert.match(d.corps, /Prénom Test/);
  const blocked = await draftEmail({ ...row, 'Opposition à la prospection': 'oui' }, {}, { callJson: fakeClaude() });
  assert.equal(blocked.bloque, true);
});

test('contrôle qualité des brouillons', () => {
  assert.ok(checkDraft({ objet: 'Re: devis', corps: 'Comme convenu, voici notre offre à 500 € !!' }).length >= 3);
});

test('suivi des réponses : opposition détectée par règle sans IA', async () => {
  let called = false;
  const r = await analyzeReply({ from: 'x@y.fr', text: 'STOP merci' }, { callJson: async () => { called = true; } });
  assert.equal(r.categorie, 'opposition');
  assert.equal(called, false);
  const r2 = await analyzeReply({ from: 'x@y.fr', text: 'Bonjour, envoyez-moi votre plaquette.' }, { callJson: fakeClaude() });
  assert.equal(r2.categorie, 'interesse');
});

test('budget : arrêt automatique au plafond', () => {
  budget.record('anthropic', 100);
  assert.throws(() => budget.assertCanSpend('anthropic', 0.01), budget.BudgetExceededError);
  assert.equal(budget.status().stopped, true);
  fs.rmSync(path.join(process.env.DATA_DIR, `budget-${new Date().toISOString().slice(0, 7)}.json`));
});

test('rapport quotidien', () => {
  const date = '2026-11-04';
  const r = buildDailyReport({
    date,
    prospects: [{ Entreprise: 'A', 'Score commercial': 85, 'Date de découverte': date, Statut: 'nouveau', Ville: 'Ermont' }],
    contacts: [{ Direction: 'sortant', Type: 'email' }, { Direction: 'entrant', 'Catégorie réponse': 'interesse', Entreprise: 'A', Résumé: 'ok' }],
  });
  assert.equal(r.kpis.nouveauxDuJour, 1);
  assert.equal(r.kpis.tauxReponse, 100);
  assert.match(r.html, /À traiter par vous \(1\)/);
});

const { calculerDevis } = require('../src/agents/devis');
const { draftFollowUp } = require('../src/agents/prospection');

test('agent devis : grille reprise de l\'outil existant, aucun prix inventé', () => {
  const d = calculerDevis({ prestation: 'bar_mocktails', invites: 120, km: 20, options: { fumee: 1, mignardises_sucrees: 50 } });
  assert.deepEqual(d.lignes.map((l) => l.montant), [540, 30, 50]); // 120 × 4,50 ; 20 km × 1,50 ; fumée 50
  assert.equal(d.total, 620);
  assert.equal(d.acompte, 186);
  assert.equal(d.envoiAutomatiquePossible, false, 'grille non validée');
  assert.ok(d.aValiderParDirigeant.some((m) => /Mignardises sucrées/.test(m)));
  assert.equal(calculerDevis({ prestation: 'bar_mocktails', invites: 150, km: 1 }).lignes[0].prixUnitaire, 4);
  assert.equal(calculerDevis({ prestation: 'bar_mocktails', invites: 99, km: 1 }).lignes[0].prixUnitaire, 5);
  const fleurs = calculerDevis({ prestation: 'bar_fleurs', invites: 50, km: 5 });
  assert.ok(fleurs.aValiderParDirigeant.some((m) => /bar_fleurs/.test(m)));
});

test('relances : 2 maximum, seulement après contact, avec désinscription', () => {
  const row = { ID: 'P-1', Entreprise: 'X', SIREN: '1', 'Email professionnel': 'contact@x.fr', 'Source email': 'https://x.fr', Statut: 'contacte', Relances: '0', 'Prestation recommandée': 'Bar à mocktails' };
  const r1 = draftFollowUp(row);
  assert.equal(r1.ok, true);
  assert.match(r1.corps, /STOP/);
  assert.doesNotMatch(r1.objet, /^re/i);
  assert.equal(draftFollowUp({ ...row, Relances: '2' }).ok, false);
  assert.equal(draftFollowUp({ ...row, Statut: 'repondu' }).ok, false);
});
