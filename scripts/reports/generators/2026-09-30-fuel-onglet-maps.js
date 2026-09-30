'use strict';
/**
 * 30 sept 2026 ~13h30 — Onglet Fuel dedie dans Maps (plus de 62 %, plein pendant trajet).
 * ./scripts/reports/run-report.sh generators/2026-09-30-fuel-onglet-maps.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Fuel-onglet-Maps-2026-09-30.pdf';
const outDir = process.env.REPORT_DIR
  ? process.env.REPORT_DIR
  : path.join(__dirname, '../../../dist/reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, OUT_NAME);
const ASSETS = path.join(__dirname, '../assets');

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 40, bottom: 46, left: 40, right: 40 },
  bufferPages: true,
  autoFirstPage: true,
  info: { Title: 'Hubera Maps — onglet Fuel dedie', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);

const { ACCENT, DARK, LEFT, WIDTH, resetX, need, h2, h3, para, note, bullets, callout, kvList, table, writeFooters } =
  bindPdfHelpers(doc);

function shot(title, file) {
  h3(title);
  const p = path.join(ASSETS, file);
  if (!fs.existsSync(p)) {
    note('Capture absente: ' + file);
    return;
  }
  const maxH = 228;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Fuel dans Maps — ecran dedie, plus de fausse jauge 62 %',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para(
  '30 septembre 2026 ~13h30 Europe/Paris. Samsung SM-G990B2 + Blackview BV9700Pro. Volume media a 0. Nothing non overlaye. Pas de recreate ytmusic. OTA mandatory false, Fuel forceUpdate 0. Package Fuel com.gasoiltracking.app inchange.'
);

kvList([
  ['Maps', '0.1.53 vc 55 — overlay -r Samsung+BV, maps.hubera.cloud/updates.json'],
  ['SHA-256 Maps', '3ba1658d06f2f65a9115370c0760986ffa5c0653a635f3b97407d32391c03605'],
  ['Fuel', '1.4.157 vc 181 — overlay -r Samsung+BV, upload gasoil-tracking (pas force)'],
  ['SHA-256 Fuel', 'd2f0496cdcfc7d5eeb17c931fad149c7986410fdfb44be1a5203b60485cb1cc0'],
  ['Music', 'p+1.3.322 inchangee'],
]);

h2('1. Casse, puis corrige');
table(
  ['Probleme', 'Cause', 'Correctif / preuve'],
  [
    [
      '62 % a cote de la recherche',
      'Faux badge de demo (piste 7). Ce n etait ni la batterie ni la jauge reelle.',
      'Avatar = initiale du compte (P). La jauge est dans l onglet Fuel (Samsung 52 % Peugeot 806).',
    ],
    [
      'Impossible de saisir un plein pendant un trajet',
      'Feuille plein sous d autres calques + hop Fuel qui volait le clavier.',
      'Formulaire litres / euros / station dans Maps, lie au vehicule. Pendant le trajet : « lie au trajet en cours ». Samsung : clavier reste dans Maps.',
    ],
    [
      'Fuel s ouvrait comme une 2e app',
      'Bouton Ouvrir Fuel + mix qui cachait l onglet. Suivi libre = libelle pourri.',
      'Onglet Fuel dedie (Accueil / Trajets / Pleins / Garage / Budget). Bouton « Demarrer un trajet ». Choix vehicule avant. GPS Fuel invisible, Maps revient.',
    ],
    [
      'Garage / budget / pleins absents de Maps',
      'Maps n avait pas le JWT Fuel : pas de snapshot.',
      'Pack silent snap vehicules + pleins + budget. Garage : 806, 206, Touran. Budget : 519 / 250 EUR. Historique La Guerche visible.',
    ],
  ],
  [1.05, 1.2, 1.75]
);

h2('2. Le 62 % — ce que c etait');
para(
  'Le 62 % a droite de la barre de recherche n etait PAS la batterie du telephone, PAS une jauge Google, PAS un pourcentage de trajet. C etait un badge de maquette (proposition 7) ecrit en dur. Il n avait aucun lien avec le reservoir. Maintenant : pastille P (Paul / compte Hubera). La vraie jauge est dans Fuel, liee au vehicule actif du compte Fuel local.'
);
shot('Samsung — avatar P, plus de 62 %, onglet Fuel visible', 'fuel53-sam-home.png');
shot('Blackview — meme chrome, P a cote de la recherche', 'fuel53-bv-home.png');

h2('3. Ecran Fuel dedie (comme l ancienne app, dans Maps)');
para(
  'Tap Fuel en bas : ecran plein (pas une 2e application). Accueil = jauge reservoir + chips vehicules + Demarrer un trajet + Enregistrer un plein. Sous-onglets Trajets, Pleins, Garage, Budget. Donnees = base Fuel du telephone, meme compte qu avant (Gasoil Tracking renomme Hubera Fuel, package inchange).'
);
shot('Samsung — Accueil Fuel, Peugeot 806 Roland Garros 52 %', 'fuel53-sam-fuel.png');
shot('Blackview — memes vehicules, jauge locale 0 % (SQLite du telephone, pas Samsung)', 'fuel53-bv-fuel.png');
shot('Samsung — Trajets (La Guerche, domicile, similarite)', 'fuel53-sam-trips.png');
shot('Samsung — Pleins (Intermarche, Total Thorigne, litres et euros)', 'fuel53-sam-garage.png');
shot('Samsung — Garage : 806 actif 52 %, 206 94 %, Touran 100 %', 'fuel53-sam-budget.png');
shot('Samsung — Budget Carburant total 519 EUR / 250 EUR (enveloppe du mois)', 'fuel53-sam-budget-real.png');

h2('4. Plein — y compris pendant un trajet');
para(
  'Le champ station ne reprend plus le 30 du panneau de vitesse. Litres ou montant suffisent. Pendant un trajet GPS, le hint dit que c est lie au trajet en cours. Maps reste au premier plan, le clavier ne part plus vers Fuel.'
);
shot('Samsung — formulaire plein, station vide (plus le 30)', 'fuel53-sam-fill.png');
shot('Samsung — trajet GPS en cours, Pause / Arreter / Plein dans Maps', 'fuel53-sam-trip-live.png');
shot('Samsung — plein pendant le trajet, lie au 806, clavier Maps', 'fuel53-sam-fill-live.png');
shot('Samsung — trajet arrete, retour carte, avatar P', 'fuel53-sam-after-stop.png');

h2('5. Verdict tests');
table(
  ['Geste', 'Samsung', 'Blackview'],
  [
    ['Avatar = P (plus 62 %)', 'OK', 'OK'],
    ['Onglet Fuel dedie (pas 2e APK)', 'OK', 'OK'],
    ['Vehicules du compte', '806 / 206 / Touran', '806 / 206 (liste Accueil)'],
    ['Jauge reelle', '52 % 806', '0 % local BV'],
    ['Demarrer un trajet (plus suivi libre bouton)', 'OK, HUD Maps', 'non lance (evite double GPS)'],
    ['Plein formulaire + clavier Maps', 'OK', 'OK'],
    ['Plein pendant trajet live', 'OK lie au 806', '—'],
    ['Trajets / Pleins / Garage / Budget', 'OK', 'Pleins OK'],
  ],
  [1.7, 1.15, 1.15]
);

h2('6. Production');
table(
  ['Host', 'Version'],
  [
    ['maps.hubera.cloud/updates.json', '0.1.53 vc 55 · sha256 3ba1658d06f2 · mandatory false'],
    ['hubera-maps container', 'Inchange depuis 29 sept 02:01 UTC. docker cp APK + updates.json seulement.'],
    ['Fuel 1.4.157 vc 181', 'Upload gasoil-tracking.delhomme.ovh forceUpdate=0. Overlay -r Samsung+BV.'],
    ['Music / ytmusic', 'Inchanges. Pas de recreate.'],
  ],
  [1.6, 2.0]
);

h2('7. Pas encore resolu');
bullets([
  'HUD conduite affiche encore « Suivi Fuel / libre » (le bouton Accueil dit bien Demarrer un trajet). Cosmetique.',
  'Demarrage GPS : hop silencieux ~8 s vers Fuel pour le FGS, puis retour Maps. Pas une 2e app qui reste ouverte, mais un flash possible.',
  'Titre du formulaire plein un peu sous l horloge Samsung (safe-area WebView).',
  'Jauge BV 0 % vs Samsung 52 % : Fuel est local par telephone, pas un cloud unique.',
  'StreamMake : landing + stub /app. Nothing : pas d overlay, OTA en ligne pour plus tard.',
  'Notes dessin, Photos cloud vide, Tasks compte vide — inchanges.',
]);

callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Fuel com.gasoiltracking.app inchange. Maps signing debug.keystore 3cf6c532. Overlay -r Samsung+BV seulement. OTA jamais mandatory true. Nothing exclue.'
);

note('Captures 30 sept 2026 13:18-13:21. Samsung SM-G990B2 + Blackview EEA9700PRO0014587. Trajet test 0.0 km arrete. Music pause, volume 0.');

const pages = writeFooters('Hubera Maps — onglet Fuel');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
