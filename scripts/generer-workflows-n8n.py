"""Génère les workflows n8n importables (dossier n8n/). Relancer après modification : python3 scripts/generer-workflows-n8n.py"""
import json, uuid, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'n8n')

def nid(): return str(uuid.uuid4())

def schedule(name, cron, pos):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": pos,
            "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": cron}]}}}

def manual(pos):
    return {"id": nid(), "name": "Test manuel", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": pos, "parameters": {}}

def sheet_read(name, tab, pos):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": pos,
            "alwaysOutputData": True, "executeOnce": True,
            "parameters": {"operation": "read",
                           "documentId": {"__rl": True, "value": "={{ $env.GOOGLE_SHEET_ID }}", "mode": "id"},
                           "sheetName": {"__rl": True, "value": tab, "mode": "name"}, "options": {}}}

def sheet_write(name, tab, pos, op="append", match=None):
    p = {"operation": op,
         "documentId": {"__rl": True, "value": "={{ $env.GOOGLE_SHEET_ID }}", "mode": "id"},
         "sheetName": {"__rl": True, "value": tab, "mode": "name"},
         "columns": {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": match or [], "schema": []},
         "options": {}}
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.googleSheets", "typeVersion": 4.5, "position": pos,
            "parameters": p}

def code(name, js, pos):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos, "parameters": {"jsCode": js}}

def http(name, path, pos, timeout=600000):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": pos,
            "retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000,
            "parameters": {"method": "POST", "url": "={{ $env.AGENTS_URL }}" + path,
                           "sendHeaders": True,
                           "headerParameters": {"parameters": [{"name": "X-API-Key", "value": "={{ $env.AGENTS_TOKEN }}"}]},
                           "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json) }}",
                           "options": {"timeout": timeout}}}

def gmail_send(name, pos, to, subject, message):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "position": pos,
            "parameters": {"sendTo": to, "subject": subject, "message": message, "options": {"appendAttribution": False}}}

def gmail_list(name, pos, query):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "position": pos,
            "alwaysOutputData": True, "executeOnce": True,
            "parameters": {"operation": "getAll", "returnAll": False, "limit": 100, "simple": False,
                           "filters": {"q": query}, "options": {}}}

def gmail_draft(name, pos):
    return {"id": nid(), "name": name, "type": "n8n-nodes-base.gmail", "typeVersion": 2.1, "position": pos,
            "parameters": {"resource": "draft", "subject": "={{ $json.objet }}", "emailType": "text",
                           "message": "={{ $json.corps }}", "options": {"sendTo": "={{ $json.to }}"}}}

def wf(name, nodes, links):
    conns = {}
    for a, b in links:
        conns.setdefault(a, {"main": [[]]})["main"][0].append({"node": b, "type": "main", "index": 0})
    return {"name": name, "nodes": nodes, "connections": conns, "active": False,
            "settings": {"executionOrder": "v1", "timezone": "Europe/Paris", "saveManualExecutions": True},
            "tags": []}

# ---------- 01 Recherche quotidienne ----------
ROTATION = r"""
// Rotation des cibles selon le jour (priorité aux lieux de réception et wedding planners).
const plan = {
  1: ['salle_reception', 'wedding_planner'],
  2: ['agence_evenementielle', 'traiteur'],
  3: ['wedding_planner', 'comite_entreprise'],
  4: ['salle_reception', 'hotel'],
  5: ['agence_evenementielle', 'mairie'],
  6: ['association', 'salon_festival'],
  0: ['salle_reception'],
};
const jour = new Date().getDay();
const existing = $('Lire PROSPECTS').all().map(i => i.json).filter(r => r.Entreprise);
const exclusions = $('Lire EXCLUSIONS').all().map(i => i.json).filter(r => r.Email || r.Domaine || r.SIREN || r.Entreprise);
// On n'envoie que les colonnes utiles au dédoublonnage (données minimales).
const slim = existing.map(r => ({ Entreprise: r.Entreprise, SIREN: r.SIREN, 'Site internet': r['Site internet'], 'Email professionnel': r['Email professionnel'], 'Code postal': r['Code postal'], Ville: r.Ville }));
return (plan[jour] || ['salle_reception']).map(category => ({ json: { category, maxEnrich: 15, existing: slim, exclusions } }));
"""

SPLIT = r"""
const out = [];
const journal = [];
for (const item of $input.all()) {
  const r = item.json;
  for (const p of (r.prospects || [])) if (p['Score commercial'] >= 40) out.push({ json: p });
  journal.push(`${r.categorie} p.${r.page} : ${JSON.stringify(r.stats)}${(r.errors || []).length ? ' — erreurs : ' + r.errors.slice(0, 3).join(' / ') : ''}`);
}
// Mémorise le journal pour le noeud suivant.
$getWorkflowStaticData('global').dernierJournal = journal.join('\n');
return out;
"""

JOURNAL = r"""
const d = $getWorkflowStaticData('global').dernierJournal || '';
return [{ json: { Date: new Date().toISOString(), Agent: 'recherche', Action: 'recherche_quotidienne', Détail: d, 'Coût (€)': '', Statut: 'ok' } }];
"""

w1 = wf("01 - Agent Recherche commerciale (quotidien)",
    [schedule("Chaque jour 8h", "0 8 * * 1-6", [0, 0]), manual([0, 200]),
     sheet_read("Lire PROSPECTS", "PROSPECTS", [250, 100]), sheet_read("Lire EXCLUSIONS", "EXCLUSIONS", [500, 100]),
     code("Choisir les cibles du jour", ROTATION, [750, 100]),
     http("Agent Recherche", "/agent/research", [1000, 100]),
     code("Prospects retenus", SPLIT, [1250, 100]),
     sheet_write("Ajouter à PROSPECTS", "PROSPECTS", [1500, 100]),
     code("Préparer journal", JOURNAL, [1750, 100]),
     sheet_write("Écrire JOURNAL", "JOURNAL", [2000, 100])],
    [("Chaque jour 8h", "Lire PROSPECTS"), ("Test manuel", "Lire PROSPECTS"), ("Lire PROSPECTS", "Lire EXCLUSIONS"),
     ("Lire EXCLUSIONS", "Choisir les cibles du jour"), ("Choisir les cibles du jour", "Agent Recherche"),
     ("Agent Recherche", "Prospects retenus"), ("Prospects retenus", "Ajouter à PROSPECTS"),
     ("Ajouter à PROSPECTS", "Préparer journal"), ("Préparer journal", "Écrire JOURNAL")])
# Le journal doit s'écrire une seule fois même si plusieurs prospects ont été ajoutés.
w1["nodes"][8]["executeOnce"] = True

# ---------- 02 Brouillons d'emails ----------
SELECT = r"""
// Sélectionne au maximum 10 prospects/jour (montée en charge progressive), score >= 60, avec email.
const MAX_PAR_JOUR = 10;
const rows = $('Lire PROSPECTS').all().map(i => i.json);
const exclusions = $('Lire EXCLUSIONS').all().map(i => i.json).filter(r => r.Email || r.Domaine || r.SIREN || r.Entreprise);
const cibles = rows
  .filter(r => r['Prochaine action'] === 'rediger_email' && r['Statut'] === 'nouveau')
  .filter(r => Number(r['Score commercial']) >= 60 && r['Email professionnel'] && String(r['Opposition à la prospection']).toLowerCase() !== 'oui')
  .sort((a, b) => Number(b['Score commercial']) - Number(a['Score commercial']))
  .slice(0, MAX_PAR_JOUR);
if (!cibles.length) return [];
return [{ json: { prospects: cibles, exclusions, max: MAX_PAR_JOUR } }];
"""

SPLIT2 = r"""
const out = [];
for (const b of ($input.first().json.brouillons || [])) out.push({ json: b });
return out;
"""

FILTER_OK = r"""
// Seuls les brouillons conformes partent dans Gmail ; les autres sont signalés dans le journal.
return $input.all().filter(i => i.json.ok && i.json.to);
"""

MAJ = r"""
const today = new Date().toISOString().slice(0, 10);
return $('Brouillons conformes').all().map(i => ({ json: { ID: i.json.id, Statut: 'brouillon_pret', 'Prochaine action': 'valider_et_envoyer', 'Date du dernier contact': '' } }));
"""

CONTACT = r"""
const drafts = $('Brouillons conformes').all();
return drafts.map((d, idx) => ({ json: {
  Date: new Date().toISOString(), 'ID prospect': d.json.id, Entreprise: '', Email: d.json.to, Direction: 'sortant',
  Type: 'brouillon', Objet: d.json.objet, Résumé: `Accroche : ${d.json.accroche} — prestation : ${d.json.prestation}`,
  'Catégorie réponse': '', 'Gmail thread ID': ($('Créer brouillon Gmail').all()[idx] || { json: {} }).json.id || '',
  Campagne: 'premier-contact', Agent: 'prospection', 'Suite donnée': 'à valider par le dirigeant' } }));
"""

w2 = wf("02 - Agent Prospection : brouillons d'emails (quotidien)",
    [schedule("Chaque jour 10h", "0 10 * * 1-5", [0, 0]), manual([0, 200]),
     sheet_read("Lire PROSPECTS", "PROSPECTS", [250, 100]), sheet_read("Lire EXCLUSIONS", "EXCLUSIONS", [500, 100]),
     code("Sélection du jour", SELECT, [750, 100]),
     http("Agent Prospection", "/agent/draft", [1000, 100]),
     code("Un brouillon par ligne", SPLIT2, [1250, 100]),
     code("Brouillons conformes", FILTER_OK, [1500, 100]),
     gmail_draft("Créer brouillon Gmail", [1750, 100]),
     code("Préparer mise à jour", MAJ, [2000, 0]),
     sheet_write("Mettre à jour PROSPECTS", "PROSPECTS", [2250, 0], op="update", match=["ID"]),
     code("Préparer historique", CONTACT, [2000, 250]),
     sheet_write("Ajouter à CONTACTS", "CONTACTS", [2250, 250])],
    [("Chaque jour 10h", "Lire PROSPECTS"), ("Test manuel", "Lire PROSPECTS"), ("Lire PROSPECTS", "Lire EXCLUSIONS"),
     ("Lire EXCLUSIONS", "Sélection du jour"), ("Sélection du jour", "Agent Prospection"),
     ("Agent Prospection", "Un brouillon par ligne"), ("Un brouillon par ligne", "Brouillons conformes"),
     ("Brouillons conformes", "Créer brouillon Gmail"), ("Créer brouillon Gmail", "Préparer mise à jour"),
     ("Préparer mise à jour", "Mettre à jour PROSPECTS"), ("Créer brouillon Gmail", "Préparer historique"),
     ("Préparer historique", "Ajouter à CONTACTS")])
for n in w2["nodes"]:
    if n["name"] in ("Préparer mise à jour", "Préparer historique"): n["executeOnce"] = True

# ---------- 03 Rapport quotidien ----------
REPORT_IN = r"""
const rows = (n) => $(n).all().map(i => i.json).filter(r => Object.keys(r).length > 1);
return [{ json: { prospects: rows('Lire PROSPECTS'), contacts: rows('Lire CONTACTS'), devis: rows('Lire DEVIS'),
  erreurs: rows('Lire JOURNAL').filter(j => j.Statut === 'erreur' && String(j.Date).startsWith(new Date().toISOString().slice(0,10))).map(j => j.Détail) } }];
"""
w3 = wf("03 - Directeur IA : rapport quotidien (18h)",
    [schedule("Chaque jour 18h", "0 18 * * 1-6", [0, 0]), manual([0, 200]),
     sheet_read("Lire PROSPECTS", "PROSPECTS", [250, 100]), sheet_read("Lire CONTACTS", "CONTACTS", [500, 100]),
     sheet_read("Lire DEVIS", "DEVIS", [750, 100]), sheet_read("Lire JOURNAL", "JOURNAL", [1000, 100]),
     code("Assembler les données", REPORT_IN, [1250, 100]),
     http("Directeur IA - rapport", "/agent/report", [1500, 100], 60000),
     gmail_send("Envoyer le rapport", [1750, 100], "={{ $env.REPORT_TO }}", "={{ $json.sujet }}", "={{ $json.html }}")],
    [("Chaque jour 18h", "Lire PROSPECTS"), ("Test manuel", "Lire PROSPECTS"), ("Lire PROSPECTS", "Lire CONTACTS"),
     ("Lire CONTACTS", "Lire DEVIS"), ("Lire DEVIS", "Lire JOURNAL"), ("Lire JOURNAL", "Assembler les données"),
     ("Assembler les données", "Directeur IA - rapport"), ("Directeur IA - rapport", "Envoyer le rapport")])

# ---------- 04 Suivi des envois et des réponses ----------
COMMUN = r"""
const norm = (s) => String(s || '').toLowerCase().trim();
const addr = (v) => { if (!v) return ''; if (typeof v === 'string') { const m = v.match(/<([^>]+)>/); return norm(m ? m[1] : v); }
  if (v.value && v.value[0]) return norm(v.value[0].address); return ''; };
const allAddr = (v) => { if (!v) return []; if (typeof v === 'string') return v.split(',').map(addr); if (v.value) return v.value.map(x => norm(x.address)); return []; };
const today = new Date().toISOString().slice(0, 10);
const prospects = $('Lire PROSPECTS').all().map(i => i.json).filter(r => r.ID);
const byEmail = {}; const byDomain = {};
const PERSO = /@(gmail|yahoo|hotmail|outlook|live|orange|free|sfr|laposte|wanadoo|icloud|aol)\./;
for (const p of prospects) { const e = norm(p['Email professionnel']); if (!e) continue; byEmail[e] = p; if (!PERSO.test(e)) byDomain[e.split('@')[1]] = p; }
const dejaVu = new Set($('Lire CONTACTS').all().map(i => String(i.json['Gmail thread ID'] || '')).filter(Boolean));
const find = (e) => byEmail[e] || byDomain[(e.split('@')[1] || '')];
"""

ENVOIS = COMMUN + r"""
// Emails envoyés depuis Gmail à un prospect : statut "contacte" + compteur de relances.
const out = [];
for (const m of $('Gmail : messages envoyés').all().map(i => i.json)) {
  if (!m.id || dejaVu.has(m.id)) continue;
  for (const to of allAddr(m.to || m.To)) {
    const p = find(to); if (!p) continue;
    if (p.Statut === 'brouillon_pret') {
      out.push({ json: { maj: { ID: p.ID, Statut: 'contacte', 'Date du dernier contact': today, 'Prochaine action': 'relance', Relances: 0 },
        contact: { Date: new Date().toISOString(), 'ID prospect': p.ID, Entreprise: p.Entreprise, Email: to, Direction: 'sortant', Type: 'email', Objet: m.subject || m.Subject || '', Résumé: 'Premier contact envoyé', 'Catégorie réponse': '', 'Gmail thread ID': m.id, Campagne: 'premier-contact', Agent: 'prospection', 'Suite donnée': '' } } });
    } else if (p.Statut === 'contacte' && p['Prochaine action'] === 'relance_brouillon_pret') {
      const n = Number(p.Relances || 0) + 1;
      out.push({ json: { maj: { ID: p.ID, 'Date du dernier contact': today, 'Prochaine action': n >= 2 ? 'aucune' : 'relance', Relances: n },
        contact: { Date: new Date().toISOString(), 'ID prospect': p.ID, Entreprise: p.Entreprise, Email: to, Direction: 'sortant', Type: 'email', Objet: m.subject || m.Subject || '', Résumé: `Relance n°${n} envoyée`, 'Catégorie réponse': '', 'Gmail thread ID': m.id, Campagne: 'relance', Agent: 'prospection', 'Suite donnée': '' } } });
    }
    break;
  }
}
return out;
"""

REPONSES = COMMUN + r"""
// Emails reçus d'un prospect connu, pas encore analysés.
const out = [];
for (const m of $('Gmail : messages reçus').all().map(i => i.json)) {
  if (!m.id || dejaVu.has(m.id)) continue;
  const from = addr(m.from || m.From); const p = find(from); if (!p) continue;
  out.push({ json: { from, subject: m.subject || m.Subject || '', text: (m.text || m.snippet || '').slice(0, 4000), gmailId: m.id, prospectId: p.ID, entreprise: p.Entreprise } });
}
return out;
"""

APRES_IA = r"""
const src = $('Réponses de prospects').all();
const today = new Date().toISOString().slice(0, 10);
return $input.all().map((it, i) => {
  const a = it.json; const m = src[i].json;
  const oppose = a.categorie === 'opposition';
  const statut = oppose ? 'refus' : (a.categorie === 'pas_interesse' ? 'refus' : (['absence_auto', 'mauvais_contact'].includes(a.categorie) ? 'contacte' : 'repondu'));
  const action = oppose ? '' : ({ interesse: 'rappeler', demande_devis: 'preparer_devis', demande_info: 'envoyer_plaquette', plus_tard: 'relancer_plus_tard', pas_interesse: '' }[a.categorie] ?? 'lire_reponse');
  return { json: {
    contact: { Date: new Date().toISOString(), 'ID prospect': m.prospectId, Entreprise: m.entreprise, Email: m.from, Direction: 'entrant', Type: 'email', Objet: m.subject, Résumé: a.resume, 'Catégorie réponse': a.categorie, 'Gmail thread ID': m.gmailId, Campagne: '', Agent: 'suivi_reponses', 'Suite donnée': a.action_recommandee },
    maj: Object.assign({ ID: m.prospectId, Statut: statut, 'Date du dernier contact': today, 'Prochaine action': action }, oppose ? { 'Opposition à la prospection': 'oui' } : {}),
    exclusion: oppose ? { Date: new Date().toISOString(), Email: m.from, Domaine: '', Entreprise: m.entreprise, SIREN: '', Motif: 'Opposition à la prospection', 'Source de la demande': `Email du ${today}` } : null,
  } };
});
"""

def pick(field, src):
    return "return $('" + src + "').all().map(i => i.json." + field + ").filter(Boolean).map(j => ({ json: j }));"

w4 = wf("04 - Suivi des envois et des réponses (14h et 17h)",
    [schedule("14h et 17h", "0 14,17 * * 1-6", [0, 0]), manual([0, 200]),
     sheet_read("Lire PROSPECTS", "PROSPECTS", [250, 100]), sheet_read("Lire EXCLUSIONS", "EXCLUSIONS", [450, 100]),
     sheet_read("Lire CONTACTS", "CONTACTS", [650, 100]),
     gmail_list("Gmail : messages envoyés", [850, 100], "in:sent newer_than:4d"),
     gmail_list("Gmail : messages reçus", [1050, 100], "in:inbox newer_than:4d -category:promotions -category:social"),
     code("Envois détectés", ENVOIS, [1300, -100]),
     code("Statuts après envoi", pick("maj", "Envois détectés"), [1550, -200]),
     sheet_write("PROSPECTS : envois", "PROSPECTS", [1800, -200], op="update", match=["ID"]),
     code("Historique des envois", pick("contact", "Envois détectés"), [1550, 0]),
     sheet_write("CONTACTS : envois", "CONTACTS", [1800, 0]),
     code("Réponses de prospects", REPONSES, [1300, 250]),
     http("Analyse IA réponse", "/agent/reply", [1550, 250], 120000),
     code("Décisions", APRES_IA, [1800, 250]),
     code("Historique des réponses", pick("contact", "Décisions"), [2050, 150]),
     sheet_write("CONTACTS : réponses", "CONTACTS", [2300, 150]),
     code("Statuts après réponse", pick("maj", "Décisions"), [2050, 300]),
     sheet_write("PROSPECTS : réponses", "PROSPECTS", [2300, 300], op="update", match=["ID"]),
     code("Oppositions", pick("exclusion", "Décisions"), [2050, 450]),
     sheet_write("EXCLUSIONS : ajout", "EXCLUSIONS", [2300, 450])],
    [("14h et 17h", "Lire PROSPECTS"), ("Test manuel", "Lire PROSPECTS"), ("Lire PROSPECTS", "Lire EXCLUSIONS"),
     ("Lire EXCLUSIONS", "Lire CONTACTS"), ("Lire CONTACTS", "Gmail : messages envoyés"),
     ("Gmail : messages envoyés", "Gmail : messages reçus"),
     ("Gmail : messages reçus", "Envois détectés"), ("Gmail : messages reçus", "Réponses de prospects"),
     ("Envois détectés", "Statuts après envoi"), ("Statuts après envoi", "PROSPECTS : envois"),
     ("Envois détectés", "Historique des envois"), ("Historique des envois", "CONTACTS : envois"),
     ("Réponses de prospects", "Analyse IA réponse"), ("Analyse IA réponse", "Décisions"),
     ("Décisions", "Historique des réponses"), ("Historique des réponses", "CONTACTS : réponses"),
     ("Décisions", "Statuts après réponse"), ("Statuts après réponse", "PROSPECTS : réponses"),
     ("Décisions", "Oppositions"), ("Oppositions", "EXCLUSIONS : ajout")])
for n in w4["nodes"]:
    if n["name"] in ("Envois détectés", "Réponses de prospects", "Décisions", "Statuts après envoi", "Historique des envois",
                     "Historique des réponses", "Statuts après réponse", "Oppositions"):
        n["executeOnce"] = True
# "Décisions" doit traiter tous les éléments : pas d'executeOnce.
for n in w4["nodes"]:
    if n["name"] == "Décisions": n.pop("executeOnce", None)

# ---------- 05 Relances ----------
SEL_RELANCE = r"""
// Relance 1 à J+6, relance 2 à J+8 après la première ; jamais après une réponse ou une opposition.
const jours = (d) => d ? (Date.now() - new Date(d).getTime()) / 86400000 : 0;
const rows = $('Lire PROSPECTS').all().map(i => i.json);
const exclusions = $('Lire EXCLUSIONS').all().map(i => i.json).filter(r => r.Email || r.Domaine || r.SIREN || r.Entreprise);
const cibles = rows.filter(r => r.Statut === 'contacte' && r['Prochaine action'] === 'relance'
  && String(r['Opposition à la prospection']).toLowerCase() !== 'oui'
  && jours(r['Date du dernier contact']) >= (Number(r.Relances || 0) === 0 ? 6 : 8)).slice(0, 15);
if (!cibles.length) return [];
return [{ json: { prospects: cibles, exclusions, max: 15 } }];
"""
MAJ_REL = r"""
return $('Relances conformes').all().map(i => ({ json: { ID: i.json.id, 'Prochaine action': 'relance_brouillon_pret' } }));
"""
w5 = wf("05 - Relances (brouillons, 16h)",
    [schedule("Chaque jour 16h", "0 16 * * 1-5", [0, 0]), manual([0, 200]),
     sheet_read("Lire PROSPECTS", "PROSPECTS", [250, 100]), sheet_read("Lire EXCLUSIONS", "EXCLUSIONS", [500, 100]),
     code("Prospects à relancer", SEL_RELANCE, [750, 100]),
     http("Agent Prospection : relances", "/agent/followup", [1000, 100], 60000),
     code("Une relance par ligne", "return ($input.first().json.relances || []).map(r => ({ json: r }));", [1250, 100]),
     code("Relances conformes", "return $input.all().filter(i => i.json.ok && i.json.to);", [1500, 100]),
     gmail_draft("Créer brouillon de relance", [1750, 100]),
     code("Marquer en attente d'envoi", MAJ_REL, [2000, 100]),
     sheet_write("PROSPECTS : relance prête", "PROSPECTS", [2250, 100], op="update", match=["ID"])],
    [("Chaque jour 16h", "Lire PROSPECTS"), ("Test manuel", "Lire PROSPECTS"), ("Lire PROSPECTS", "Lire EXCLUSIONS"),
     ("Lire EXCLUSIONS", "Prospects à relancer"), ("Prospects à relancer", "Agent Prospection : relances"),
     ("Agent Prospection : relances", "Une relance par ligne"), ("Une relance par ligne", "Relances conformes"),
     ("Relances conformes", "Créer brouillon de relance"), ("Créer brouillon de relance", "Marquer en attente d'envoi"),
     ("Marquer en attente d'envoi", "PROSPECTS : relance prête")])
for n in w5["nodes"]:
    if n["name"] == "Marquer en attente d'envoi": n["executeOnce"] = True

for fname, w in [("04-suivi-envois-reponses.json", w4), ("05-relances.json", w5), ("01-recherche-quotidienne.json", w1), ("02-brouillons-emails.json", w2), ("03-rapport-quotidien.json", w3)]:
    with open(os.path.join(OUT, fname), "w", encoding="utf-8") as f:
        json.dump(w, f, ensure_ascii=False, indent=2)
    print("écrit", fname, len(w["nodes"]), "noeuds")
