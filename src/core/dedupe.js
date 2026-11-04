// Détection des doublons : SIREN, domaine du site, email, ou nom normalisé + code postal.
const STOP = /\b(sarl|sas|sasu|eurl|sa|sci|snc|ste|societe|société|la|le|les|l|de|du|des|et)\b/g;

function normalizeName(name = '') {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(STOP, ' ')
    .replace(/\s+/g, ' ').trim();
}

function domainOf(url = '') {
  if (!url) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) { return ''; }
}

function keysFor(p) {
  const keys = [];
  const siren = (p.siren || (p.siret || '').slice(0, 9) || '').replace(/\s/g, '');
  if (siren) keys.push(`siren:${siren}`);
  const d = domainOf(p.siteWeb || p.website);
  // Les domaines de plateformes partagées ne sont pas discriminants.
  if (d && !/(facebook|instagram|linkedin|wix|pagesjaunes|google|mariages\.net)\./.test(d)) keys.push(`domain:${d}`);
  const email = (p.email || '').toLowerCase().trim();
  if (email) keys.push(`email:${email}`);
  const n = normalizeName(p.entreprise || p.nom || '');
  if (n) keys.push(`name:${n}|${p.codePostal || p.ville || ''}`);
  return keys;
}

/** Construit un index à partir des prospects déjà en base (lignes Google Sheets). */
function buildIndex(existing = []) {
  const idx = new Set();
  for (const p of existing) for (const k of keysFor(normalizeRow(p))) idx.add(k);
  return idx;
}

// Accepte aussi bien nos objets internes que les lignes de Sheets (en-têtes en français).
function normalizeRow(r) {
  return {
    siren: r.siren || r.SIREN || '',
    siret: r.siret || r.SIRET || '',
    siteWeb: r.siteWeb || r['Site internet'] || '',
    email: r.email || r['Email professionnel'] || '',
    entreprise: r.entreprise || r.Entreprise || '',
    codePostal: r.codePostal || r['Code postal'] || '',
    ville: r.ville || r.Ville || '',
  };
}

function isDuplicate(p, idx) { return keysFor(normalizeRow(p)).some((k) => idx.has(k)); }
function addToIndex(p, idx) { for (const k of keysFor(normalizeRow(p))) idx.add(k); }

module.exports = { normalizeName, domainOf, keysFor, buildIndex, isDuplicate, addToIndex };
