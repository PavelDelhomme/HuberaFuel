'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-17-retours.pdf';
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
  info: { Title: 'Hubera — retours du 17 octobre 2026', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, h2, para, note, bullets, callout, kvList, table, writeFooters } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(17).fillColor(DARK).text('Hubera — retours du 17 octobre', LEFT(), doc.y, {
  width: WIDTH(),
});
para('Vingt-huit retours lus dans Docs. Vingt-six tâches passées en fait. Le coffre Pass reste ouvert. La note du 8 octobre n’est pas un bug.');
callout(
  'OTA',
  'Jamais forcée. Paquet cloud.hubera.* en premier. APK PK 504b0304. Versions au-dessus de celles déjà en ligne.',
  ACCENT
);
kvList([
  ['Téléphones', 'Nothing 192.168.1.44:5555 et Samsung R5CT7263YJL, install -r'],
  ['Blackview', 'Absent d’adb. Non testé.'],
  ['Pass', '0.1.11 déployé, retour laissé ouvert'],
]);

h2('1. Versions déployées');
table(
  ['App', 'Version', 'Preuve'],
  [
    ['Mail', '1.0.27 / 28', 'Flux + téléphones'],
    ['Drive', '1.0.16 / 17', 'Flux + téléphones'],
    ['Photos', '1.0.20 / 21', 'Flux + téléphones'],
    ['Contacts', '0.1.14 / 15', 'Flux + téléphones'],
    ['Agenda', '0.1.20 / 21', 'Flux + téléphones'],
    ['Pass', '0.1.11 / 12', 'Flux + téléphones, retour ouvert'],
    ['Notes', '0.1.17 / 18', 'Flux + téléphones'],
    ['Cook', '0.1.13 / 14', 'Flux + téléphones'],
    ['Tasks', '0.1.10 / 11', 'Flux + téléphones'],
    ['Docs', '0.2.22 / 222', 'N-1 vrai, N faux'],
    ['Maps', '0.1.108 / 109', 'N-1 vrai, N faux'],
    ['ID', '0.1.13 / 113', 'Flux + téléphones'],
    ['Music', '1.3.374 / 10674', 'N-1 vrai, N faux'],
    ['Jobs', '1.0.70 / 70', 'Flux public, non forcé'],
  ],
  [1.2, 1.4, 2.2]
);

h2('2. Ce qui est clos');
bullets([
  'Drive : liste en cache, puis réseau. Paramètres du tiroir ouvrent les réglages.',
  'Mise à jour : le fichier déjà téléchargé s’installe au retour du réglage, sur les apps Flutter et sur Music.',
  'Tiroirs : les autres apps Hubera sont retirées (suite, Cook, Jobs, Music, Maps, Docs).',
  'Cook : recette en page, favoris, traduction avec correction réutilisée, bouton relevé, connexion visible.',
  'Agenda : vues jour, 3 jours et semaine. L’événement créé est inséré tout de suite.',
  'Contacts : plus d’onglet Sélection. Barre du bas collée au bord.',
  'Photos : reprend un compte Hubera ID déjà présent sur l’appareil. Aucun mot de passe saisi.',
  'Mail : boîtes dans l’ordre d’ajout. Un 401 avec copie en cache ne s’affiche pas brut (test unitaire).',
  'Jobs : l’APK release parle à jobs.hubera.cloud. Le checkout prod de septembre n’a pas été fusionné.',
  'ID : logos des apps installées, réglages globaux, données mobiles, bouton de mise à jour.',
  'Docs : le bouton des autres apps est retiré. Le test du brouillon de tâche passe. Le tiroir Docs était déjà clos.',
]);

h2('3. Encore ouvert');
para('Pass, tâche 57ef25f7aae6842c. L’APK 0.1.11 crée un coffre Principal si la liste est vide, et l’empreinte existait déjà. Le téléphone n’a pas servi à coller un mot de passe ni à rouvrir un coffre verrouillé. Aucun mot de passe Bitwarden n’a été généré. Le retour reste à faire.');
para('La note « Lab 8 oct — édition retours OK » reste une note, pas un correctif.');
note('Blackview EEA9700PRO0014587 absent d’adb. Un périphérique MediaTek était branché sans ce numéro de série. Rien n’a été inventé pour lui.');

const pages = writeFooters('Hubera — retours 17 octobre 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
