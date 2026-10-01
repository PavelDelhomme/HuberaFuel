'use strict';
/**
 * 29 sept 2026 ~19h55 — Maps + Music interactions
 * ./scripts/reports/run-report.sh generators/2026-09-29-maps-music-interactions.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Maps-Music-interactions-2026-09-29.pdf';
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
  info: { Title: 'Hubera Maps + Music — interactions', Author: 'Hubera' },
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
  const maxH = 232;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text('Maps + Music — test interactions', LEFT(), doc.y, {
  width: WIDTH(),
});
para(
  '29 septembre 2026 ~19h55 Europe/Paris. Samsung SM-G990B2 + Blackview BV9700Pro. Volume media a 0. Nothing non overlaye. Pas de restart API ytmusic. OTA mandatory false, pas de forceUpdate Music.'
);

kvList([
  ['Maps', '0.1.50 vc 52 — overlay -r Samsung+BV'],
  ['Music', 'p+1.3.320 vc 10620 — overlay -r Samsung+BV, /install live'],
  ['Fuel', '1.4.156 fond, peek mix inchange'],
]);

h2('1. Ce qui ne marchait pas, corrige');
table(
  ['Probleme', 'Correctif'],
  [
    [
      'Samsung : barre Music absente (X + Fuel cachait le bouton ♪)',
      '0.1.49/50 : ♪ a gauche du recentrer. Tap = dock « Rien en cours ». Lecture Music => dock auto.',
    ],
    [
      'Dialogue Music « Mise a jour disponible » + « A jour — 1.3.317 »',
      '1.3.320 : plus de message « A jour » si une version serveur est dispo. Accueil 320 sans popup parasite.',
    ],
    [
      'Precedent Maps restartait la piste (> 3 s)',
      '0.1.50 : seekToPreviousMediaItem. Sur BV la file Media3 n a parfois pas de titre d avant (reste).',
    ],
  ],
  [1.7, 1.9]
);

h2('2. Blackview — dock Maps');
para(
  'Play / pause / suivant depuis Maps, lecteur in-Maps (tap titre), Fuel peek, disque 30. Titres : Mama Pogo Magyar -> L.E.J -> Orelsan -> Puttin On the Ritz. Pause finale OK.'
);
shot('BV play — Excuses ou mensonges, Orelsan, icone pause', 'mm-13-bv-play.png');
shot('BV suivant — Puttin On the Ritz', 'mm-14-bv-next.png');
shot('BV lecteur dans Maps (sans ouvrir l app)', 'mm-05-bv-sheet.png');
shot('BV pause depuis Maps', 'mm-23-bv-paused.png');

h2('3. Samsung — dock + Music 1.3.320');
para(
  'Avant : pas de dock. 0.1.49 : ♪ visible (un moment sur le recentrer, corrige 0.1.50). Tap ♪ => dock vide. Lecture mini-player Music => dock auto avec titre. Froid : toast « Toujours en chargement » puis PLAYING. Suivant Maps : J irai cracher -> La securite de l emploi (Fatals Picards). Notif media coherente.'
);
shot('Samsung avant — pas de dock Music', 'mm-01-sam-sans-dock.png');
shot('Samsung Music 1.3.320 — accueil, mini-player, plus de popup MAJ contradictoire', 'mm-16-sam-music-320.png');
shot('Samsung Maps — lecture J irai cracher, disque 30, Fuel, recentrer', 'mm-19-sam-playing.png');
shot('Samsung Maps — suivant La securite de l em… Fatals Picards', 'mm-22-sam-next.png');

h2('4. Verdict');
table(
  ['Geste', 'Samsung', 'Blackview'],
  [
    ['Dock visible / restaurable', 'OK ♪ puis auto si play', 'OK (deja on)'],
    ['Play / pause Maps', 'OK', 'OK'],
    ['Suivant Maps', 'OK autre titre', 'OK autre titre'],
    ['Lecteur in-Maps (tap titre)', 'non rejoue', 'OK'],
    ['Ouvrir app Music', 'OK accueil 320', 'splash overlay puis Maps'],
    ['Disque 30 + Fuel pendant Music', 'OK', 'OK'],
    ['Precedent = titre d avant', 'non rejoue', 'file parfois 1 titre — KO'],
  ],
  [1.5, 1.2, 1.3]
);

callout(
  'Reste',
  'Precedent Maps depend de la file Music (Media3). Nothing non teste. StreamMake toujours landing. Notes/Photos inchanges cette salve.'
);

note('Captures 19h39-19h55. Volume 0. Packages ovh.delhomme.maps / ovh.delhomme.ytmusic inchanges.');

const pages = writeFooters('Hubera Maps + Music — interactions');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
