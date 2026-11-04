// Lecture du site public d'un prospect : emails professionnels publiés, réseaux sociaux,
// et un extrait de texte pour la qualification IA.
// Règles : respect de robots.txt, 4 pages maximum, aucun contournement de protection,
// le contenu est traité comme DONNÉE NON FIABLE (jamais comme des instructions).
const cheerio = require('cheerio');
const config = require('../config');
const { domainOf } = require('../core/dedupe');
const { emailType, PERSONAL_DOMAINS } = require('../core/compliance');

const CONTACT_PATHS = ['/contact', '/contactez-nous', '/nous-contacter', '/mentions-legales'];
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BAD_EMAIL = /(@example\.|@exemple\.|@domain\.|@email\.|^test@|^nom@|^votre|noreply|no-reply|wixpress|sentry|wordpress|schema|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|u003e|@2x)/i;

async function fetchText(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': config.research.userAgent, Accept: 'text/html,text/plain' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || '';
  if (!/text\/(html|plain)/.test(type)) return null;
  const txt = await res.text();
  return txt.slice(0, 600000);
}

/** robots.txt minimal : respecte les règles "Disallow" pour User-agent: * */
function robotsAllows(robotsTxt, path) {
  if (!robotsTxt) return true;
  let applies = false; const disallows = [];
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const [k, ...rest] = line.split(':'); const v = rest.join(':').trim();
    if (!k) continue;
    if (/^user-agent$/i.test(k)) applies = v === '*' || /maisonevenement/i.test(v);
    else if (applies && /^disallow$/i.test(k) && v) disallows.push(v);
  }
  return !disallows.some((d) => path.startsWith(d));
}

function deobfuscate(html) {
  return html
    .replace(/&#64;|&#x40;|\s?\[at\]\s?|\s?\(at\)\s?|\s+arobase\s+/gi, '@')
    .replace(/\s?\[dot\]\s?|\s?\(dot\)\s?/gi, '.');
}

function extractEmails(html, siteDomain) {
  const $ = cheerio.load(html);
  const found = new Set();
  $('a[href^="mailto:"]').each((_, a) => {
    const m = decodeURIComponent(($(a).attr('href') || '').slice(7).split('?')[0]).trim();
    if (m) found.add(m.toLowerCase());
  });
  for (const m of deobfuscate(html).match(EMAIL_RE) || []) found.add(m.toLowerCase());
  return [...found].filter((e) => !BAD_EMAIL.test(e)).filter((e) => {
    const d = e.split('@')[1];
    // On garde : le domaine du site, ou une messagerie générique (fréquent chez les TPE).
    return d === siteDomain || d.endsWith('.' + siteDomain) || PERSONAL_DOMAINS.test(e);
  });
}

function extractSocials(html) {
  const $ = cheerio.load(html); const out = {};
  $('a[href]').each((_, a) => {
    const h = $(a).attr('href') || '';
    if (!out.instagram && /instagram\.com\/[^/?#]+/i.test(h)) out.instagram = h;
    if (!out.facebook && /facebook\.com\/[^/?#]+/i.test(h)) out.facebook = h;
    if (!out.linkedin && /linkedin\.com\/(company|in)\/[^/?#]+/i.test(h)) out.linkedin = h;
  });
  return out;
}

function extractVisibleText(html, max = 3500) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,iframe,form').remove();
  const title = $('title').text().trim();
  const desc = $('meta[name="description"]').attr('content') || '';
  const body = $('body').text().replace(/\s+/g, ' ').trim();
  return `${title}\n${desc}\n${body}`.slice(0, max);
}

function rankEmail(e, siteDomain) {
  let s = 0;
  if (e.endsWith('@' + siteDomain)) s += 2;
  if (/^(evenement|events?|reservation|commercial|contact)/.test(e)) s += 2;
  if (emailType(e) === 'generique') s += 1;
  return s;
}

async function analyzeWebsite(siteUrl, { fetchImpl = fetch } = {}) {
  const out = { emails: [], email: '', emailSource: '', emailType: '', socials: {}, extrait: '', pagesLues: [], robotsBloque: false };
  if (!siteUrl) return out;
  let base;
  try { base = new URL(/^https?:/i.test(siteUrl) ? siteUrl : `https://${siteUrl}`); } catch (_) { return out; }
  const siteDomain = domainOf(base.href);

  let robots = null;
  try { robots = await fetchText(new URL('/robots.txt', base).href, fetchImpl); } catch (_) { /* ignore */ }

  const pages = [base.pathname || '/', ...CONTACT_PATHS];
  const emailSources = new Map();
  for (const path of pages) {
    if (!robotsAllows(robots, path)) { if (path === pages[0]) out.robotsBloque = true; continue; }
    const url = new URL(path, base).href;
    let html = null;
    try { html = await fetchText(url, fetchImpl); } catch (_) { /* page absente */ }
    if (!html) continue;
    out.pagesLues.push(url);
    if (path === pages[0]) {
      out.extrait = extractVisibleText(html);
      out.socials = extractSocials(html);
    } else {
      out.socials = { ...extractSocials(html), ...out.socials };
    }
    for (const e of extractEmails(html, siteDomain)) if (!emailSources.has(e)) emailSources.set(e, url);
    if (emailSources.size && path !== pages[0]) break; // assez d'information
  }
  out.emails = [...emailSources.keys()].sort((a, b) => rankEmail(b, siteDomain) - rankEmail(a, siteDomain));
  if (out.emails.length) {
    out.email = out.emails[0];
    out.emailSource = emailSources.get(out.email);
    out.emailType = emailType(out.email);
  }
  return out;
}

module.exports = { analyzeWebsite, extractEmails, robotsAllows, extractVisibleText };
