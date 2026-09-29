'use strict';
/**
 * 29 sept 2026 — Maps 0.1.46 prod : Fuel dans Maps, tests Samsung+Blackview.
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Maps-0.1.46-Fuel-prod-2026-09-29.pdf';
const outDir = process.env.REPORT_DIR
  ? path.resolve(process.env.REPORT_DIR)
  : path.join(__dirname, '../../../dist/reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, OUT_NAME);
const ASSETS = path.join(__dirname, '../assets');

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 40, bottom: 46, left: 40, right: 40 },
  bufferPages: true,
  autoFirstPage: true,
  info: {
    Title: 'Hubera Maps 0.1.46 — Fuel dans Maps (prod proposee)',
    Author: 'Hubera',
  },
});

const stream = fs.createWriteStream(out);
doc.pipe(stream);

const {
  ACCENT,
  DARK,
  LEFT,
  WIDTH,
  resetX,
  need,
  h2,
  h3,
  para,
  note,
  bullets,
  callout,
  kvList,
  table,
  writeFooters,
} = bindPdfHelpers(doc);

function shot(title, file) {
  h3(title);
  const p = path.join(ASSETS, file);
  if (!fs.existsSync(p)) {
    note('Capture absente: ' + file);
    return;
  }
  const maxH = 248;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(17).fillColor(DARK).text('Hubera Maps 0.1.46', LEFT(), doc.y, {
  width: WIDTH(),
});
para(
  '29 septembre 2026 ~18h25 Europe/Paris. Fuel passe par Maps (mix feuille + HUD + GPS invisible). Tests Samsung + Blackview. OTA proposee, pas forcee. Rien sur la Nothing (pas connectee, pas d overlay).'
);

kvList([
  ['APK Maps', '0.1.46 / versionCode 48 · ovh.delhomme.maps'],
  ['SHA-256 APK', '3d0b9a15e6cdaf208a90aaf72d54e6f0cea422b9d806c3ed7730de2d7344c377'],
  ['Signature', 'debug.keystore 3cf6c532… (inchangee)'],
  ['OTA', 'maps.hubera.cloud/updates.json · mandatory false'],
  ['Fuel APK', '1.4.156 · com.gasoiltracking.app inchange'],
  ['Music APK', 'p+1.3.317 · pas de nouvelle OTA Music'],
]);

callout(
  'Socle',
  'GPS + SQLite restent dans Hubera Fuel en arriere-plan. L interface visuelle est Maps. Package Fuel non renomme.'
);

h2('1. Ce qui fonctionne');
table(
  ['Surface', 'Verdict'],
  [
    ['Mix 2+7+10 (defaut)', 'OK Samsung + Blackview'],
    ['Feuille Fuel (trajets / pleins / garage / budget)', 'OK — historique + trajets similaires'],
    ['Suivi libre + HUD GPS Fuel', 'OK — trajet 166, 2 km/h, Pause / Arreter / Plein'],
    ['Point bleu + halo', 'OK, lisible vs maison'],
    ['Label Maison au zoom', 'OK, texte complet'],
    ['Music dans Maps (muet)', 'OK Blackview — lecture state=3, speaker 0'],
    ['Parametres 0.1.46 + Comparer Fuel', 'OK Blackview'],
    ['Lieux enregistres', 'OK Blackview (Maison Rennes)'],
    ['Jauge 62% avatar (HUD mix)', 'OK'],
  ],
  [2.2, 1.4]
);

shot('Samsung — carte mix, peek Fuel, sans barre DEV', 'maps-046-samsung-home.png');
shot('Samsung — suivi Fuel dans Maps (trajet 166)', 'maps-046-samsung-suivi.png');
shot('Blackview — Music + Fuel peek (muet)', 'maps-046-bv-home.png');
shot('Blackview — lecture Music depuis Maps', 'maps-046-bv-music.png');
shot('Blackview — historique Fuel + similaires', 'maps-046-bv-trajets.png');
shot('Blackview — Parametres 0.1.46', 'maps-046-bv-settings.png');
shot('Blackview — lieux enregistres', 'maps-046-bv-saved.png');

h2('2. Ce qui ne fonctionne pas / a ameliorer');
bullets([
  'Nothing : ADB absent ce soir. Pas d overlay, pas de mesure batterie en fond. L OTA lui sera proposee in-app (mandatory false).',
  'Maison recouvre encore un peu le point bleu quand le GPS est pile a l adresse (Samsung). Halo bleu visible quand meme.',
  'Garage et Budget dans la feuille : apercus, pas encore la base Fuel complete.',
  'Disque limite de vitesse : parfois « - » (Overpass), parfois 30. Instable.',
  'Comparer Fuel : dans Parametres, plus de barre jaune permanente (volontaire pour la prod).',
  'Music en lecture : ~13–17 % CPU (decodage). Batterie Samsung 94 % pendant les tests GPS Fuel.',
  'Un am start Fuel depuis ADB sort encore brièvement sur l UI Fuel. Depuis Maps (HuberaFuel.control) le retour est silencieux.',
]);

h2('3. Batterie / processus (mesure, pas reset)');
table(
  ['Appareil', 'Niveau', 'Maps', 'Music', 'Fuel GPS'],
  [
    ['Samsung SM-G990B2', '94 % decharge', '3.3 % CPU', '13 % (session)', 'FGS localisation oui'],
    ['Blackview BV9700Pro', '80 % charge', '1.1 % CPU', '17 % si lecture', 'processus present'],
    ['Nothing', 'non connectee', '—', '—', '—'],
  ],
  [1.4, 1.1, 1.1, 1.2, 1.4]
);

h2('4. Prod');
bullets([
  'Feed https://maps.hubera.cloud/updates.json = 0.1.46 vc 48, mandatory false.',
  'Samsung et Blackview ont deja 0.1.46 en overlay : pas de dialogue OTA chez eux.',
  'Nothing (et tout 0.1.44) : dialogue « Installer » in-app, refus possible.',
  'Pas de forceUpdate Music. Pas de docker compose down -v.',
]);

note('Captures Samsung + Blackview 29 sept 2026 ~18h05–18h21. Volume Music 0.');

const pages = writeFooters('Hubera Maps 0.1.46 — Fuel dans Maps');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
