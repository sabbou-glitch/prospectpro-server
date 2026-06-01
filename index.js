const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/search', async (req, res) => {
  const { metier, ville, page = 1 } = req.query;
  if (!metier || !ville) return res.status(400).json({ error: 'metier et ville requis' });

  try {
    const perPage = 25;
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(metier + ' ' + ville)}&per_page=${perPage}&page=${page}`;

    const { data } = await axios.get(url, {
      headers: { 'Accept': 'application/json' },
      timeout: 15000
    });

    const results = (data.results || []).map(r => {
      const siege = r.siege || {};
      return {
        'Nom': r.nom_raison_sociale || r.nom_complet || '',
        'Adresse': siege.adresse || '',
        'Code Postal': siege.code_postal || '',
        'Ville': siege.libelle_commune || ville,
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
    res.status(500).json({ error: 'Erreur', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
