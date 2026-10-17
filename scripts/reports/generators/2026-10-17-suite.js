'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-17-suite.pdf';
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
  info: { Title: 'Hubera — suite du 17 octobre 2026', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, h2, h3, para, note, bullets, callout, kvList, table, writeFooters } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera — suite du 17 octobre 2026',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para('Faits lus sur les flux publics, puis le code poussé. Aucun téléphone ouvert. Pas de son. Pas de requête YouTube. Rien installé sur le Nothing.');

callout(
  'Encore ouvert',
  'Bitwarden : coffre verrouillé, non fait. Jobs non republié. Grille métier longue. Aucune APK bêta. Le Nothing sera mis à jour par Paul depuis la prod.',
  ACCENT,
);

h2('1. Flux');
para('Chaque ligne est la version lue. forceUpdate et mandatory sont faux partout. L’APK canonique commence par 504b0304, sauf Docs : le téléchargement sans session répond 401, et le fichier du volume commence par 504b0304.');
table(
  ['App', 'Version / code', 'Client d’avant', 'apkAvailable'],
  [
    ['Mail', '1.0.25 / 26', 'legacy 1.0.11 code 12', 'true dans le JSON'],
    ['Contacts', '0.1.12 / 13', '0.1.11', 'true dans le JSON'],
    ['Notes', '0.1.16 / 17', '0.1.15', 'true dans le JSON'],
    ['Cook', '0.1.11 / 12', '0.1.10', 'true dans le JSON'],
    ['Drive', '1.0.14 / 15', '1.0.13', 'true dans le JSON'],
    ['ID', '0.1.12 / 112', '0.1.11', 'true dans le JSON'],
    ['Tasks', '0.1.8 / 9', '0.1.7', 'true dans le JSON'],
    ['Admin', '0.1.10 / 11', '0.1.9', 'true dans le JSON'],
    ['Docs', '0.2.21 / 221', '0.2.20 code 220', 'true, puis false'],
    ['Calendar', '0.1.18 / 19', '0.1.17', 'true dans le JSON'],
    ['Photos', '1.0.19 / 20', '1.0.18', 'true dans le JSON'],
    ['Pass', '0.1.10 / 11', '0.1.9', 'true dans le JSON'],
    ['Fuel', '1.4.180 / 204', '1.4.179 code 203', 'true, et encore true'],
    ['Maps', '0.1.106 / 107', '0.1.105', 'true dans le JSON'],
    ['Music', '1.3.373 / 10673', '1.3.372', 'true, puis false'],
  ],
  [1.15, 1.35, 1.45, 1.35],
);

h3('Ce qui colle');
bullets([
  'Les quinze versions ci-dessus répondent. Mail web mail.hubera.cloud répond en HTML, c’est l’application.',
  'Docs : un client 0.2.20 voit apkAvailable true. Un client déjà en 0.2.21 le voit false.',
  'Music, canal prod : un client 1.3.372 voit apkAvailable true. Un client déjà en 1.3.373 le voit false. L’APK /api/deploy/apk commence par 504b0304.',
  'Fuel updates.json est du JSON, pas du HTML. Un client 1.4.179 voit apkAvailable true. L’APK commence par 504b0304.',
  'Les APK canoniques et legacy des autres apps commencent par 504b0304.',
]);

h3('Ce qui ment, ou qui ne calcule pas');
bullets([
  'Les updates.json statiques annoncent apkAvailable true sans lire la version du téléphone. Un téléphone déjà à jour voit encore true. Ça vaut pour Mail, Contacts, Notes, Cook, Drive, ID, Tasks, Admin, Calendar, Photos, Pass et Maps.',
  'Fuel GET /api/version fait pareil : un client déjà en 1.4.180 code 204 reçoit encore apkAvailable true. Le fichier est bon. Le drapeau ne s’éteint pas.',
  'Music /updates.json renvoyait le HTML du site. Un fichier JSON a été déposé dans le conteneur ytmusic, sans le recréer, sans toucher au tunnel ni aux cookies. Ce fichier est statique : apkAvailable y reste true. Le calcul par téléphone reste GET /api/version.',
  'Docs GET /api/apk sans session répond 401. Ce n’est pas une APK. Le fichier sur le volume hubera-docs-data commence par 504b0304.',
  'Mail legacy : le nom est 1.0.11, le code publié est 12.',
  'La note Maps 0.1.106 parle du popup de mise à jour, pas de Bison Futé. La note Admin 0.1.10 parle du compte, de l’affichage et de la recherche manuelle.',
]);

h2('2. Mail 1.0.25');
para('Nouveau message, choix de boîte, Favoris, Tous, Indésirables, Envoyés, Programmée. Le report est silencieux. Un 401 sert le cache ou rouvre le message. Le web a Sombre et Clair, et les pièces jointes. Legacy 1.0.11. Rien sur le Nothing.');

h2('3. Contacts, Notes, Agenda, Photos, Pass');
bullets([
  'Contacts 0.1.12 : personnel et professionnel, corbeille, archive, autorisation, réglages du carnet.',
  'Notes 0.1.16 : enregistrement automatique, couleurs, cases, libellés.',
  'Calendar 0.1.18 : journée, ligne rouge, bouton plus, fiche. Les réglages n’ont pas de lien vers id.hubera.cloud.',
  'Photos 1.0.19 : le tiroir ne liste plus les autres apps. Le retour revient sur Photos.',
  'Pass 0.1.10 : création du mot de passe maître, puis un PIN. L’empreinte n’est pas stockée. Bitwarden n’est pas fait.',
]);

h2('4. Cook, Drive, ID, Tasks, Admin, Docs');
para('Cook 0.1.11, Drive 1.0.14, ID 0.1.12, Tasks 0.1.8, Admin 0.1.10, Docs 0.2.21. Réglages propres. La recherche de mise à jour est manuelle. Elle n’est pas forcée.');

h2('5. Fuel 1.4.180');
para('Le tiroir ne liste plus les autres apps. updates.json a été réparé : il renvoie du JSON. La 206 grise est inchangée : 6,3 L et 744,1 km. Ces deux chiffres ne sont pas écrits en dur dans l’application.');

h2('6. Maps 0.1.106');
para('Le popup de mise à jour est celui de Fuel. La circulation vient de Bison Futé. « Évite le bouchon » n’apparaît que si le détour gagne au moins 5 minutes.');

h2('7. Music 1.3.373');
bullets([
  'Pas de reprise si l’utilisateur avait mis pause.',
  'Canal prod. forceUpdate false. mandatory false.',
  'Le relais YouTube reste limité au conteneur. La rafale yt-dlp est arrêtée.',
  'Aucun proxy sur le téléphone. Le conteneur ytmusic n’a pas été recréé.',
]);

h2('8. Budget');
para('La saisie d’une dépense est dans le dépôt Budget. Elle n’est pas mélangée à Fuel.');

h2('9. Encore ouvert');
bullets([
  'Bitwarden : coffre verrouillé, non branché.',
  'Jobs : non republié.',
  'Grille métier longue : pas rejouée. Aucun téléphone dans cette passe.',
  'Aucune APK bêta.',
  'Nothing : Paul le met à jour depuis la prod. Rien n’y a été installé.',
  'Fuel : le drapeau apkAvailable reste true pour un téléphone déjà en 1.4.180.',
  'Admin : le clic qui ouvre un rapport lisible n’est pas dans la note publique. La carte reste ouverte.',
  'La 206 grise n’a pas été réassignée.',
]);
note('Aucun secret, cookie, jeton ni mot de passe dans ce PDF.');

const pages = writeFooters('Hubera — suite du 17 octobre 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
