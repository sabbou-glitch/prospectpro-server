const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/search', async (req, res) => {
  const { metier, ville, page = 1 } = req.query;
  if (!metier || !ville) return res.status(400).json({ error: 'metier et ville requis' });

  try {
    const url = `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(metier)}&ou=${encodeURIComponent(ville)}&page=${page}`;
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      }
    });

    const $ = cheerio.load(data);
    const results = [];

    $('.bi-container').each((i, el) => {
      const nom = $(el).find('.bi-denomination').text().trim() || $(el).find('.denominationligne1').text().trim();
      const adresse = $(el).find('.bi-adresse .rue-adr').text().trim();
      const codePostal = $(el).find('.bi-adresse .cp-adr').text().trim();
      const ville_res = $(el).find('.bi-adresse .ville-adr').text().trim();
      const tel = $(el).find('.bi-phone .coord-numero').first().text().trim();
      const categorie = $(el).find('.bi-activite').text().trim();

      if (nom) {
        results.push({
          'Nom': nom,
          'Adresse': adresse,
          'Code Postal': codePostal,
          'Ville': ville_res || ville,
          'Téléphone': tel,
          'Catégorie': categorie,
          'Source': 'Pages Jaunes'
        });
      }
    });

    const totalText = $('.nb-results-number').text().trim();
    const total = parseInt(totalText.replace(/\D/g, '')) || results.length;
    const totalPages = Math.ceil(total / 20);

    res.json({ results, total, page: parseInt(page), totalPages, metier, ville });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Erreur scraping', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
