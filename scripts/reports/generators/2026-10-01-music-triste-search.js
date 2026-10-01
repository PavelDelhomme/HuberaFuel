'use strict';
/**
 * 1 oct 2026 ~17h10 — Music recherche + Triste Nothing.
 * ./scripts/reports/run-report.sh generators/2026-10-01-music-triste-search.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Music-Triste-recherche-2026-10-01.pdf';
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
  info: { Title: 'Hubera Music — Triste et recherche', Author: 'Hubera' },
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
  const maxH = 240;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Music : Triste joue, la recherche ne crie plus « scope ».',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '1er octobre 2026 ~17h10 Europe/Paris. Sur Nothing, les recherches affichaient souvent une erreur brute (coroutine scope / Job cancelled — lu « scope machine trop »). Beaucoup de titres mettaient des minutes a charger, exemple Triste (feat. Grace Ellis) de Nick Monteiro : BUFFERING pos=0, pas de son. Overlay -r Nothing A059 + Blackview. Samsung wireless ADB offline (OTA seulement). Volume media a 0.'
);
kvList([
  ['Music', 'p+1.3.329 vc 10629 — overlay -r Nothing+BV, forceUpdate false, SHA ccb8b90fbf3c'],
  ['Maps Nothing', '0.1.65 vc 66 deja pose (points nommes, GPS idle batterie)'],
  ['Fuel Nothing', '1.4.163 vc 187 inchange'],
  ['ytmusic', 'Pas de recreate. created 2026-09-30T18:55:20Z. docker cp API + APK'],
]);
h2('1. Pourquoi ca bloquait');
table(
  ['Avant', 'Maintenant'],
  [
    ['Erreur brute coroutine scope / Job cancelled', '« Recherche interrompue — reessaie »'],
    ['Wipe / rebind toutes les 20-32 s (tue yt-dlp)', 'Attente froide ~55 s, pas de wipe au 1er stall'],
    ['LibHeads 16+8 + shuffle-heads pendant le play', 'Silence biblio tant que ca charge'],
    ['IP VPS YouTube bot-check, swarm de yt-dlp', 'Un seul resolve + cache disque ; proxy+cookies OK'],
  ],
  [2, 2]
);
h2('2. Preuve Nothing');
para(
  'Triste (feat. Grace Ellis), Nick Monteiro, id 6LaKZ9YKSs0. Media session PLAYING, position ~40 s / 5:57, buffer plein. Capture 17h08 : pause visible, file d attente derriere.'
);
shot('Nothing — Triste en lecture', '2026-10-01-nothing-triste.png');
h2('3. OTA / telephones');
bullets([
  'music.hubera.cloud/api/version = 1.3.329, forceUpdate false.',
  'music.hubera.cloud/api/install/apk-info = p+1.3.329 vc 10629.',
  'maps.hubera.cloud/updates.json = 0.1.65, mandatory false.',
  'Nothing + Blackview overlay -r. Samsung : recuperer via Continuer / install quand l ADB revient.',
]);
callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Package Music ovh.delhomme.ytmusic inchange. Maps ovh.delhomme.maps inchange. Fuel com.gasoiltracking.app inchange. Conteneur ytmusic cree 2026-09-30 18:55 UTC, pas recree.'
);
note('Capture Nothing A059 1er oct 2026 ~17h08. Volume media a 0. Maps 0.1.65 et Fuel 1.4.163 deja sur le telephone.');
const pages = writeFooters('Hubera Music — Triste et recherche');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => process.exit(1));
