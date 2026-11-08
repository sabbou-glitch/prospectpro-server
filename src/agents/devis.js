// AGENT 5 — DEVIS (version 1 : calcul)
// Calcule un devis à partir de la grille validée (config/tarifs.json). Aucun appel IA, aucun prix inventé :
// tout élément sans tarif est renvoyé dans "aValiderParDirigeant" au lieu d'être chiffré.
const fs = require('fs');
const path = require('path');
const { haversineKm } = require('../core/geo');
const config = require('../config');

const TARIFS_PATH = path.join(__dirname, '..', '..', 'config', 'tarifs.json');
function loadTarifs() { return JSON.parse(fs.readFileSync(TARIFS_PATH, 'utf8')); }

const r2 = (n) => Math.round(n * 100) / 100;

function prixMocktail(qte, t) {
  return [...t.mocktails.paliers].sort((a, b) => b.aPartirDe - a.aPartirDe).find((p) => qte >= p.aPartirDe).prixUnitaire;
}

/**
 * @param {object} demande
 *   prestation: 'bar_mocktails' | 'bar_jus' | 'bar_fleurs'
 *   mocktails: nombre de mocktails (par défaut = invités)
 *   invites: nombre d'invités
 *   km: distance aller depuis Ermont (si connue) — sinon lat/lon du lieu pour une ESTIMATION
 *   options: { fumee: 1, fontaine: 1, ... }
 */
function calculerDevis(demande, tarifs = loadTarifs()) {
  const lignes = [];
  const aValider = [];
  const prestation = demande.prestation || 'bar_mocktails';

  if (tarifs.prestationsSansTarif.includes(prestation)) {
    aValider.push(`Aucun tarif validé pour « ${prestation} » : devis à établir par le dirigeant.`);
  } else {
    const qte = Math.round(Number(demande.mocktails || demande.invites || 0));
    if (!qte) aValider.push('Nombre de mocktails / invités inconnu.');
    else {
      const pu = prixMocktail(qte, tarifs);
      lignes.push({ designation: tarifs.mocktails.designation, detail: tarifs.mocktails.detail, quantite: qte, unite: '', prixUnitaire: pu, montant: r2(qte * pu) });
    }
  }

  let km = Number(demande.km);
  let kmEstime = false;
  if (!Number.isFinite(km) || km <= 0) {
    if (Number.isFinite(demande.latitude) && Number.isFinite(demande.longitude)) {
      // Estimation route ≈ vol d'oiseau × 1,3 — signalée comme estimation.
      km = Math.ceil(haversineKm(config.research.origin, { lat: demande.latitude, lon: demande.longitude }) * 1.3);
      kmEstime = true;
    } else km = NaN;
  }
  if (Number.isFinite(km) && km > 0) {
    lignes.push({ designation: tarifs.deplacement.designation, detail: tarifs.deplacement.detail + (kmEstime ? ' (distance estimée)' : ''), quantite: km, unite: 'km', prixUnitaire: tarifs.deplacement.prixParKm, montant: r2(km * tarifs.deplacement.prixParKm) });
    if (kmEstime) aValider.push(`Distance estimée à ${km} km : à vérifier sur un itinéraire.`);
  } else aValider.push('Distance du lieu inconnue : frais de déplacement à ajouter.');

  for (const [cle, qteBrute] of Object.entries(demande.options || {})) {
    const opt = tarifs.options[cle];
    const qte = Number(qteBrute) || 0;
    if (!qte) continue;
    if (!opt) { aValider.push(`Option inconnue « ${cle} » : à chiffrer par le dirigeant.`); continue; }
    if (opt.prix === null || opt.prix === undefined) { aValider.push(`« ${opt.designation} » (${qte}) : pas de tarif validé.`); continue; }
    lignes.push({ designation: opt.designation, detail: 'Option', quantite: qte, unite: opt.unite || '', prixUnitaire: opt.prix, montant: r2(qte * opt.prix) });
  }

  const total = r2(lignes.reduce((s, l) => s + l.montant, 0));
  const pret = tarifs.valide === true && aValider.length === 0;
  if (tarifs.valide !== true) aValider.unshift('Grille tarifaire pas encore validée par le dirigeant : devis non envoyable automatiquement.');
  return {
    prestation, lignes, total, acompte: r2(total * tarifs.acompteRatio), validiteJours: tarifs.validiteJours,
    mention: tarifs.vendeur.tva, envoiAutomatiquePossible: pret, aValiderParDirigeant: aValider,
  };
}

module.exports = { calculerDevis, prixMocktail, loadTarifs };
