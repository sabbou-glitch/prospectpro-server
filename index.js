const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const GOOGLE_API_KEY = 'AIzaSyB0NpuOwP69JULgf21OkyOgS0edSU3WXVk';

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/search', async (req, res) => {
  const { metier, ville, page = 1 } = req.query;
  if (!metier || !ville) return res.status(400).json({ error: 'metier et ville requis' });

  try {
    const perPage = 25;
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(metier + ' ' + ville)}&per_page=${perPage}&page=${page}`;
    const { data } = await axios.get(url, { headers: { 'Accept': 'application/json' }, timeout: 15000 });

    const results = (data.results || []).map(r => {
      const siege = r.siege || {};
      return {
        'Nom': r.nom_raison_sociale || r.nom_complet || '',
        'Adresse': siege.adresse || '',
        'Code Postal': siege.code_postal || '',
        'Ville': siege.libelle_commune || ville,
        'Téléphone': '',
        'Email': '',
        'Site Web': '',
        'Activité': r.activite_principale || '',
        'SIRET': siege.siret || '',
        'Source': 'INSEE'
      };
    });

    const total = data.total_results || results.length;
    const totalPages = Math.ceil(total / perPage);
    res.json({ results, total, page: parseInt(page), totalPages, metier, ville });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Erreur INSEE', details: err.message });
  }
});

app.get('/enrich', async (req, res) => {
  const { nom, adresse, ville } = req.query;
  if (!nom) return res.status(400).json({ error: 'nom requis' });

  try {
    const query = `${nom} ${adresse || ''} ${ville || ''}`.trim();

    const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name&key=${GOOGLE_API_KEY}`;
    const findRes = await axios.get(findUrl, { timeout: 8000 });
    const candidates = findRes.data.candidates || [];
    if (!candidates.length) return res.json({ telephone: '', website: '', email: '' });

    const placeId = candidates[0].place_id;

    const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website,name&key=${GOOGLE_API_KEY}`;
    const detailRes = await axios.get(detailUrl, { timeout: 8000 });
    const result = detailRes.data.result || {};

    const telephone = result.formatted_phone_number || '';
    const website = result.website || '';

    let email = '';
    if (website) {
      try {
        const webRes = await axios.get(website, {
          timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0' },
          maxRedirects: 3
        });
        const emailMatch = webRes.data.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
        if (emailMatch) {
          const filtered = emailMatch.filter(e =>
            !e.includes('example') && !e.includes('test') &&
            !e.includes('norepl
