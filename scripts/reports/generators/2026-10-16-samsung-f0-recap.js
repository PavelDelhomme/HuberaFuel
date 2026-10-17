'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-16-samsung-f0.pdf';
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
  info: { Title: 'Hubera — Samsung F0 16 oct 2026', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, h2, para, note, bullets, callout, kvList, table, writeFooters } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera — Samsung aligné, grille F0',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para('16 octobre 2026, fin de journée. Le Nothing n’a pas été touché. Le Blackview n’a pas été rejoué : le Samsung était branché.');

callout(
  'OTA',
  'Versions déjà en prod. forceUpdate false, mandatory false. Fichiers APK magic PK avant install -r. Aucune version plus vieille que le téléphone.',
  ACCENT,
);

kvList([
  ['Téléphone', 'Samsung SM-G990B2, série labo'],
  ['Install', '-r, pas de pm clear, pas de downgrade'],
  ['Icônes', 'Une par produit. Legacy désactivé, données gardées'],
  ['Music', 'Conteneur ytmusic:search-durable non recréé. En-tête cookies 6126 octets, non écrasé'],
  ['Cook web', 'cook.hubera.cloud HTTP 200 après arrêt du legacy'],
  ['Cloudity', 'Stack laissée en marche'],
  ['Bêta', 'Verrou Music seulement. Liste d’e-mails vide, hors git'],
]);

h2('1. Versions prod installées sur le Samsung');
table(
  ['App', 'Version', 'Code'],
  [
    ['Admin', '0.1.7', '8'],
    ['Calendar', '0.1.15', '16'],
    ['Contacts', '0.1.10', '11'],
    ['Cook', '0.1.7', '8'],
    ['Docs', '0.2.20', '220'],
    ['Drive', '1.0.12', '13'],
    ['Fuel', '1.4.178', '202'],
    ['ID', '0.1.9', '109'],
    ['Jobs', '1.0.69', '69'],
    ['Mail', '1.0.22', '23'],
    ['Maps', '0.1.104', '105'],
    ['Music', '1.3.372', '10672'],
    ['Notes', '0.1.13', '14'],
    ['Office', '0.1.1', '101'],
    ['Pass', '0.1.7', '8'],
    ['Photos', '1.0.15', '16'],
    ['Tasks', '0.1.6', '7'],
  ],
  [1.4, 1.2, 0.8],
);

h2('2. Grille F0 sur le Samsung');
para('Geste : ouvrir l’app canonique, lire l’écran, retour. PASS = pas de crash, le processus reste, pas de bandeau « Synchronisation interrompue ».');
table(
  ['App', 'F0', 'Écran vu'],
  [
    ['Admin', 'PASS', 'Choix de compte, passkey'],
    ['Calendar', 'PASS', 'Jour, heures, Aujourd’hui'],
    ['Contacts', 'PASS', 'Personnel / Professionnel, liste vide'],
    ['Cook', 'FAIL', 'Exception 401, onglets visibles'],
    ['Docs', 'PASS', 'Choix de compte'],
    ['Drive', 'PASS', 'Accueil, aucun fichier récent'],
    ['Fuel', 'PASS', 'Garage, jauge 28 L / 50 L'],
    ['ID', 'PASS', 'Choix de compte'],
    ['Jobs', 'PASS', 'Choix de compte après le démarrage'],
    ['Mail', 'PASS', 'Aucune boîte reliée, pas de bandeau'],
    ['Maps', 'PASS', 'Carte, lieux, Fuel, lecture Music'],
    ['Music', 'PASS', 'Accueil, mixes, titre récent'],
    ['Notes', 'PASS', 'Liste vide, créer'],
    ['Office', 'PASS', 'Continuer avec un compte'],
    ['Pass', 'PASS', 'Déverrouiller le coffre'],
    ['Photos', 'PASS', 'Sync désactivée, pas le bandeau coupé'],
    ['Tasks', 'PASS', 'Liste vide, créer'],
  ],
  [1.1, 0.7, 2.2],
);
note('Maps ouvert : paquet cloud.hubera.maps. Pas Organic Maps. Le retour laisse le processus vivant.');

h2('3. Une icône');
bullets([
  'Désactivés (données conservées) : Music legacy, Docs legacy, Drive legacy, Fuel legacy, Pass legacy.',
  'Music canonique : environ 3,2 Go de données après la désactivation. Le legacy faisait environ 240 Ko.',
  'Office garde trois apps distinctes : documents, tableur, diapositives.',
]);

h2('4. Prod inchangée ou confirmée');
bullets([
  'Mail 1.0.22, Docs 0.2.20, Cook 0.1.7, Admin 0.1.7, Maps 0.1.104, Fuel 1.4.178, Music 1.3.372, Jobs 1.0.69 déjà publiés. Pas de nouvelle publication dans ce lot.',
  'Cloudity toujours up. Volume hubera-docs-data intact. Pas de compose down -v.',
  'Ancien Cook (cookingrecipes) arrêté après smoke 200. Le site Hubera Cook répond encore 200.',
  'Canal bêta Music : un compte hors liste reçoit 404. La variable d’environnement reste vide. Pas d’adresse dans git. Pas étendu aux autres apps : leur OTA est un fichier public, un verrou mal branché changerait la prod.',
]);

h2('5. Encore à faire');
bullets([
  'Cook : le 401 au chargement des préférences. L’app ne tombe pas, mais les données ne s’affichent pas.',
  'Grille métier : swipes Mail, thème HTML, fil, guidage Maps, plein Fuel 20 L, titre Music inconnu sur le téléphone.',
  'Proxies Music, extraction mp4 idle, package hors-ligne, charte visuelle : plus tard.',
  'Nothing : Paul mettra à jour depuis la prod. Aucun adb sur cet appareil.',
]);

const pages = writeFooters('Hubera — Samsung F0 16 oct 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
