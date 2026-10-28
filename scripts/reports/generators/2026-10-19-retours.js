'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-19-retours.pdf';
const outDir = process.env.REPORT_DIR
  ? path.resolve(process.env.REPORT_DIR)
  : path.join(__dirname, '../../../dist/reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, OUT_NAME);

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 40, bottom: 46, left: 40, right: 40 },
  bufferPages: true,
  autoFirstPage: true,
  info: { Title: 'Hubera — retours du 19 octobre 2026', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, h2, para, bullets, callout, table, writeFooters } = bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(0.6);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text('Hubera — retours du 19 octobre 2026', LEFT(), doc.y, { width: WIDTH() });
para('Une ligne par retour. Une version n’est citée que si le flux ou le téléphone l’a montrée.');
callout('Servi', 'Fuel 1.4.184 code 210. Maps 0.1.112 code 113. forceUpdate false. mandatory false.');
h2('Publié');
bullets([
  'Fuel : carte d’autonomie du dessous retirée. Samsung : une seule jauge et la carte Conso.',
  'Fuel : identité année, carburant, numéro. Samsung : 2022 · Essence · n°1 sur le compte QA.',
  'Fuel : le ? à côté de la jauge est dans 1.4.184.',
  'Maps : Démarrer le trajet au-dessus de la barre, onglet Fuel, demi-cercle 56 %. Vu Samsung et Blackview.',
]);
h2('Retours');
table(
  ['Retour', 'État'],
  [
    ['Cook, photo d’ingrédient', 'Ouvert'],
    ['Cook, unités', 'Ouvert'],
    ['Music, préchargement au lancement', 'Ouvert'],
    ['Maps, carte Fuel escamotable', 'Ouvert'],
    ['Maps, itinéraire sélectionné plus visible', 'Ouvert'],
    ['Maps, Démarrer le trajet', 'Corrigé, 0.1.112'],
    ['Contacts, favoris en haut', 'Ouvert'],
    ['Photos, 401 albums et vignettes', 'Ouvert'],
    ['Fuel, noms d’APK au dépôt CI', 'Ouvert'],
    ['Fuel, niveau inconnu sans plein', 'Corrigé, 1.4.184'],
    ['Fuel, carte d’autonomie en double', 'Corrigé, 1.4.184'],
    ['Fuel, trajets du véhicule affiché', 'Dans 1.4.184, 206 non revue (compte QA)'],
    ['Fuel, retour au premier plan', 'Dans 1.4.184, pas chronométré'],
    ['Docs, créé / modifié et cible', 'Ouvert'],
    ['Docs, retours non traités d’abord', 'Ouvert'],
    ['Mail, boîtes après mise à jour', 'Ouvert'],
    ['Pass, mots de secours et empreinte', 'Ouvert, coffre non touché'],
    ['Admin, menu compte et retours traités', 'Ouvert'],
    ['Réglages, charte visuelle', 'Ouvert, pas de nouvelle charte'],
    ['Tiroir par le bord gauche', 'Ouvert'],
  ],
  [2.2, 1.4]
);

const pages = writeFooters('Hubera — 19 octobre 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
