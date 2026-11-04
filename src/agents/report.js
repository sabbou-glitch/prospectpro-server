// AGENT 1 (version initiale) — Rapport quotidien du Directeur IA, sans appel IA (coût nul).
// Calcule les indicateurs à partir des onglets Google Sheets transmis par n8n.
const budget = require('../core/budget');

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function buildDailyReport({ prospects = [], contacts = [], devis = [], erreurs = [], date = new Date().toISOString().slice(0, 10) }) {
  const today = (r, col) => String(r[col] || '').startsWith(date);
  const nouveaux = prospects.filter((r) => today(r, 'Date de découverte'));
  const prioritaires = prospects.filter((r) => Number(r['Score commercial']) >= 80 && !/ecarte|client/.test(r['Statut'] || ''));
  const envoyes = contacts.filter((c) => c['Direction'] === 'sortant' && c['Type'] === 'email');
  const recus = contacts.filter((c) => c['Direction'] === 'entrant');
  const interesses = recus.filter((c) => /interesse|demande_devis|demande_info/.test(c['Catégorie réponse'] || ''));
  const aTraiter = recus.filter((c) => /interesse|demande_devis|demande_info/.test(c['Catégorie réponse'] || '') && !/traite/i.test(c['Suite donnée'] || ''));
  const devisEnvoyes = devis.filter((d) => /envoye|accepte|refuse/.test(d['Statut'] || ''));
  const devisAcceptes = devis.filter((d) => d['Statut'] === 'accepte');
  const ca = devisAcceptes.reduce((s, d) => s + (Number(String(d['Montant TTC'] || '0').replace(',', '.')) || 0), 0);
  const b = budget.status();

  const k = {
    totalProspects: prospects.length,
    nouveauxDuJour: nouveaux.length,
    prioritaires: prioritaires.length,
    emailsEnvoyes: envoyes.length,
    reponses: recus.length,
    tauxReponse: envoyes.length ? +(100 * recus.length / envoyes.length).toFixed(1) : 0,
    interesses: interesses.length,
    devisEnvoyes: devisEnvoyes.length,
    devisAcceptes: devisAcceptes.length,
    chiffreAffairesAccepte: ca,
    depensesMoisEur: b.spentEur,
    plafondEur: b.capEur,
    erreurs: erreurs.length,
  };

  const top = [...nouveaux].sort((a, b2) => b2['Score commercial'] - a['Score commercial']).slice(0, 10);
  const html = `<div style="font-family:Georgia,serif;color:#2b2b2b;max-width:680px">
<h2 style="color:#7a5c3e;margin-bottom:4px">Maison de l'Événement — rapport du ${esc(date)}</h2>
<p style="color:#777;margin-top:0">Rapport automatique de l'équipe d'agents IA</p>
${aTraiter.length ? `<h3 style="color:#b03a2e">À traiter par vous (${aTraiter.length})</h3><ul>${aTraiter.map((c) => `<li><b>${esc(c['Entreprise'])}</b> — ${esc(c['Catégorie réponse'])} : ${esc(c['Résumé'])}</li>`).join('')}</ul>` : '<p>Aucune réponse en attente de votre action.</p>'}
${b.alert ? `<p style="color:#b03a2e"><b>Alerte budget :</b> ${b.spentEur} € dépensés sur ${b.capEur} € ce mois-ci${b.stopped ? ' — appels payants SUSPENDUS.' : '.'}</p>` : ''}
${erreurs.length ? `<h3 style="color:#b03a2e">Erreurs (${erreurs.length})</h3><ul>${erreurs.slice(0, 10).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
<h3>Indicateurs</h3>
<table cellpadding="6" style="border-collapse:collapse">
${[
    ['Prospects en base', k.totalProspects], ['Nouveaux prospects du jour', k.nouveauxDuJour], ['Prospects prioritaires (≥ 80)', k.prioritaires],
    ['Emails envoyés (total)', k.emailsEnvoyes], ['Réponses reçues', k.reponses], ['Taux de réponse', `${k.tauxReponse} %`],
    ['Prospects intéressés', k.interesses], ['Devis envoyés', k.devisEnvoyes], ['Devis acceptés', k.devisAcceptes],
    ['CA des devis acceptés (TTC)', `${ca.toFixed(2)} €`], ['Dépenses agents ce mois', `${b.spentEur} € / ${b.capEur} €`],
  ].map(([l, v]) => `<tr><td style="border-bottom:1px solid #eee">${esc(l)}</td><td style="border-bottom:1px solid #eee;text-align:right"><b>${esc(v)}</b></td></tr>`).join('')}
</table>
${top.length ? `<h3>Meilleurs nouveaux prospects</h3><ol>${top.map((r) => `<li><b>${esc(r['Entreprise'])}</b> (${esc(r['Ville'])}) — ${esc(r['Score commercial'])}/100 — ${esc(r['Prestation recommandée'])}${r['Email professionnel'] ? '' : ' — <i>pas d\'email trouvé</i>'}</li>`).join('')}</ol>` : ''}
<p style="color:#999;font-size:12px">Chiffre d'affaires = devis acceptés (TTC), ce n'est ni le bénéfice ni la trésorerie.</p>
</div>`;
  return { kpis: k, html, sujet: `Rapport quotidien — ${k.nouveauxDuJour} nouveaux prospects, ${aTraiter.length} réponse(s) à traiter` };
}

module.exports = { buildDailyReport };
