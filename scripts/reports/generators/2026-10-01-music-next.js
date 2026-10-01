'use strict';
/**
 * 1 oct 2026 ~04h05 — bouton Suivant Music (app + Maps).
 * ./scripts/reports/run-report.sh generators/2026-10-01-music-next.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Music-suivant-2026-10-01.pdf';
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
  info: { Title: 'Hubera Music bouton suivant', Author: 'Hubera' },
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
  const maxH = 210;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Music : un clic Suivant passe au titre suivant.',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '1er octobre 2026 ~04h05 Europe/Paris. Dans Music et dans le dock Maps, Suivant relancait souvent le titre en cours a 0, ou il fallait cliquer plusieurs fois. Cause : seekToNext() sur un flux YouTube DASH. Correctif : avance par index de file, comme le bouton Precedent. Teste Samsung SM-G990B2 + Blackview BV9700Pro. Nothing : OTA seulement.'
);
kvList([
  ['Music', 'p+1.3.323 vc 10623 — overlay -r Samsung+BV, forceUpdate false'],
  ['Maps', '0.1.63 vc 64 — overlay -r Samsung+BV, mandatory false'],
  ['ytmusic', 'Pas de recreate (docker cp APK). Conteneur maps inchange depuis 29/09 02:01 UTC'],
]);
h2('1. Correctif');
table(
  ['Avant', 'Maintenant'],
  [
    ['seekToNext() relance le titre a 0', 'seek a l index suivant de la file'],
    ['Plusieurs clics pour changer', 'Un clic = un titre (app, notif, Maps)'],
  ],
  [2, 2]
);
h2('2. Preuves telephone');
para(
  'Samsung : PARISIENNE -> Blinding Lights (app) puis dock Maps -> LA LA LA, un clic. Blackview : Babylon -> Solange ich lebe -> Sera -> Ich gebe dir mein Wort, un clic a chaque fois.'
);
shot('Samsung Maps — Blinding Lights avant Suivant', '2026-10-01-ss-music-dock.png');
shot('Samsung Maps — titre suivant apres un clic', '2026-10-01-ss-music-next.png');
shot('Blackview Maps — encore un titre different, un clic', '2026-10-01-bv-music-next.png');
h2('3. OTA');
bullets([
  'music.hubera.cloud/api/version = 1.3.323, forceUpdate false.',
  'maps.hubera.cloud/updates.json = 0.1.63, mandatory false.',
  'Nothing : recuperer plus tard via Continuer / install.',
]);
callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Package Music ovh.delhomme.ytmusic inchange. Maps ovh.delhomme.maps inchange. Overlay -r Samsung+BV seulement.'
);
note('Captures 1er oct 2026 ~04h00. Volume media a 0. Overlay Music interrompt la lecture le temps de l install -r.');
const pages = writeFooters('Hubera Music bouton suivant');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => process.exit(1));
