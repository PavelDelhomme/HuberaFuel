'use strict';
/**
 * 29 sept 2026 ~19h40 — Recap 2 : Maps 0.1.48 / Notes 0.1.3 / Photos 1.0.4
 * Pipeline: ./scripts/reports/run-report.sh generators/2026-09-29-recap2-resolu-restant.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Recap2-resolu-restant-2026-09-29.pdf';
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
    Title: 'Hubera suite — recap 2 : resolu / restant',
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
  const maxH = 236;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera suite — recap 2 : ce qui est resolu, ce qui reste',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para(
  '29 septembre 2026 ~19h40 Europe/Paris. Samsung SM-G990B2 + Blackview BV9700Pro uniquement. Nothing non overlaye. OTA mandatory: false. Packages inchanges (Maps ovh.delhomme.maps, Fuel com.gasoiltracking.app, Music ovh.delhomme.ytmusic). Pas de down -v. Music BV laisse en pause, pas de restart ytmusic.'
);

kvList([
  ['Maps', '0.1.48 vc 50 — pin Maison cache pres de toi + disque 30 km/h'],
  ['Fuel', '1.4.156 — GPS fond pid Samsung 7520 / BV 28538'],
  ['Music', 'p+1.3.317 — dock BV Mama Pogo Magyar, pas de nouvelle OTA'],
  ['Notes', '0.1.3 — Keep + raccourci liste a cocher'],
  ['Photos', '1.0.4 — onglet appareil si cloud vide + ORDER BY MediaStore BV'],
  ['Drive / Contacts / Agenda / Tasks / Pass', '1.0.2 / 0.1.2 / 0.1.2 / 0.1.2 / 0.1.1 (inchanges cette salve)'],
  ['Stream', 'Landing hubera + stub /app — StreamMake pas encore branche'],
]);

h2('1. Casse, puis corrige');
table(
  ['Probleme', 'Cause', 'Correctif / preuve'],
  [
    [
      'Pin Maison par-dessus le point bleu a la maison',
      '0.1.46 reculait le pin de ~24 m ; icone 44 px recouvrait encore le halo',
      '0.1.47/48 : le pin Maison/Travail se cache dans 45 m. Samsung + BV : seulement le puck bleu.',
    ],
    [
      'Disque vitesse reste « — »',
      '1) JS appelait HuberaSpeed.lookup(nombres) puis return : le pont Kotlin Double n etait pas invoque. 2) overpass-api.de renvoie 406 depuis le wifi maison. 3) file Overpass 36 s.',
      '0.1.48 : lookup(String), miroirs en parallele, proxy POST maps.hubera.cloud/overpass (VPS). Disque 30 sur Samsung et BV.',
    ],
    [
      'Notes = liste generique, pas Keep',
      'APK sans masonry / composeur / extras checklist',
      '0.1.2 grille Keep, 0.1.3 case a cocher dans « Prendre une note… ». Overlay 0.1.3 Samsung+BV.',
    ],
    [
      'Photos cloud vide, galerie pas proposee',
      'Timeline restait sur Cloud meme a 0 photo',
      '1.0.3+ : bascule auto « Cet appareil ». Samsung : permission + grille locale. BV : SQL ORDER BY vide en 1.0.3, corrige en 1.0.4.',
    ],
    [
      'tasks.hubera.cloud/updates.json en 404/SPA',
      'Next public/ + nginx taskflow ne servaient pas le JSON',
      'Corrige plus tot aujourd hui : JSON+APK sur tasks + taskflow.',
    ],
  ],
  [1.15, 1.25, 1.6]
);

shot('AVANT — Samsung 0.1.47 : pin OK, disque encore « — »', 'recap2-maps-047-samsung-dash.png');
shot('APRES — Samsung 0.1.48 : disque 30, pin Maison cache, peek Fuel', 'recap2-maps-048-samsung-30.png');
shot('APRES — Blackview 0.1.48 : disque 30 + dock Music en pause', 'recap2-maps-048-blackview-30.png');

h2('2. Notes Keep 0.1.3');
para(
  'Composeur « Prendre une note… » avec icone checklist, recherche, cartes 2 colonnes, epingles NoteQA / V toujours la. Pas de saisie clavier pendant le smoke (consigne Samsung). Dessin, images, couleurs Keep web : pas encore.'
);
shot('Samsung — Notes 0.1.3 Keep + checklist', 'recap2-notes-013-samsung.png');
shot('Blackview — Notes 0.1.3 Keep + checklist', 'recap2-notes-013-blackview.png');

h2('3. Photos : onglet appareil');
para(
  '1.0.3 ouvre « Cet appareil » si le cloud est vide (comme Google Photos sans backup). Samsung : dialogue permission puis grille locale (captures galerie non jointes : documents perso). Blackview 1.0.3 : crash SQL MediaStore « ORDER BY LIMIT » sans colonne — corrige 1.0.4 (OrderOption createDate).'
);
shot('Samsung 1.0.3 — « Cet appareil » + permission galerie', 'recap2-photos-103-samsung-perm.png');
shot('Blackview 1.0.3 — erreur SQL MediaStore (corrigee 1.0.4)', 'recap2-photos-103-blackview-sql.png');
shot('Blackview 1.0.4 — galerie appareil apres ORDER BY', 'recap2-photos-104-blackview.png');

h2('4. Ce qui marche (suite)');
table(
  ['Produit', 'Etat live'],
  [
    ['Maps + Fuel mix', 'OK — peek Fuel, GPS FGS, chips Maison/Travail, disque 30, Music dock BV'],
    ['Music pendant trajet / hors trajet', 'OK BV pause dans Maps. Samsung volume laisse. Pas de forceUpdate.'],
    ['Drive', 'OK Samsung — Sans titre.docx encore la (1.0.2)'],
    ['Contacts', 'OK BV — carnet importe'],
    ['Agenda', 'OK Samsung — bandeau semaine 29 sept'],
    ['Pass', 'OK Samsung — coffre paul@delhomme.ovh'],
    ['Tasks', 'OK app 0.1.2 — compte vide de taches (DB neuve, pas un crash)'],
    ['OTA /install', 'OK notes/photos/drive/contacts/calendar/tasks/pass/maps — mandatory false'],
  ],
  [1.4, 2.2]
);
shot('Drive Samsung (salve precedente, toujours vrai)', 'suite-drive-samsung.png');
shot('Contacts Blackview', 'suite-contacts-blackview.png');
shot('Agenda Samsung', 'suite-calendar-samsung.png');
shot('Pass Samsung coffre', 'suite-pass-samsung.png');
shot('Tasks Samsung vide (attendu)', 'suite-tasks-samsung.png');

h2('5. Pas encore resolu');
bullets([
  'StreamMake : stream.hubera.cloud/ est la landing Hubera ; /app est un stub 983 o. Le stack StreamMake (frontend Next + backend + DVD privilegie) n est PAS deploye — trop risqué (privileged, postgres) sans down -v. Feed OTA 0.0.0 sans APK.',
  'Notes Keep : pas de dessin, pieces jointes image, ni checklist riche type Keep web. Couleurs / rappels web : non.',
  'Photos cloud : toujours 0 photo sauvegardee. Backup Drive Photos a exercer pour de vrai. Galerie Samsung OK ; BV depend de 1.0.4.',
  'Tasks : zero tache sur le compte Hubera. Pas de import Google Tasks.',
  'Drive / Contacts / Agenda / Photos overlays d avant 1.0.3 n avaient pas le client OTA host Hubera (sauf Notes/Tasks rebuild). /install web marche pour tous. Photos 1.0.4 a le client recent.',
  'Nothing Phone : exclu (consigne). Feeds /install en ligne pour plus tard. Music next-song Nothing toujours casse cote session — pas touche.',
  'Fuel La Guerche : suivi GPS fond OK ; le manque de point Guerche d hier n a pas ete rejoue (pas de trajet neuf cette salve).',
  'Maison chip Samsung dit « Rue Maurice Ravel », BV « Rennes » — libelles differents, meme GPS 48.1558, -1.5869.',
]);

h2('6. Feeds OTA production');
table(
  ['Host', 'Version / SHA12'],
  [
    ['maps.hubera.cloud/updates.json', '0.1.48 · 0de52dff582d · mandatory false'],
    ['notes.hubera.cloud', '0.1.3 · cce2ef086b2f'],
    ['photos.hubera.cloud', '1.0.4 (ou 1.0.3 si le 1.0.4 n a pas fini de publier)'],
    ['drive / contacts / calendar / tasks / pass', '1.0.2 / 0.1.2 / 0.1.2 / 0.1.2 / 0.1.1'],
    ['stream.hubera.cloud', '0.0.0 apk vide'],
  ],
  [2.0, 1.6]
);

callout(
  'Proxy Overpass',
  'POST https://maps.hubera.cloud/overpass repond 200 (maxspeed 30 Avenue Gabriel Faure). Le wifi maison est bloque en 406 par overpass-api.de : sans ce proxy le disque restait « — ».'
);

h2('7. Volumes / packages');
para(
  'Aucun docker compose down -v. Fuel package com.gasoiltracking.app inchange. Maps signing debug.keystore (SHA historique). Overlay -r Samsung+BV seulement. OTA jamais mandatory true. Music pas de forceUpdate.'
);

note(
  'Captures 29 sept 2026 19:19-19:40. Samsung SM-G990B2 + Blackview EEA9700PRO0014587. PDF recap 2 apres correctifs Maps 0.1.48 / Notes 0.1.3 / Photos galerie.'
);

const pages = writeFooters('Hubera recap 2 — resolu / restant');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
