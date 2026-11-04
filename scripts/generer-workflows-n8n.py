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
  2: ['agence_evenementielle', 'salle_reception'],
  3: ['wedding_planner', 'hotel'],
  4: ['salle_reception', 'comite_entreprise'],
  5: ['agence_evenementielle', 'mairie'],
  6: ['salon_festival', 'association'],
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

for fname, w in [("01-recherche-quotidienne.json", w1), ("02-brouillons-emails.json", w2), ("03-rapport-quotidien.json", w3)]:
    with open(os.path.join(OUT, fname), "w", encoding="utf-8") as f:
        json.dump(w, f, ensure_ascii=False, indent=2)
    print("écrit", fname, len(w["nodes"]), "noeuds")
