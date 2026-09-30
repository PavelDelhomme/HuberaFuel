'use strict';
/**
 * 30 sept 2026 ~03h50 — Precedent Maps enfin le titre d avant
 * ./scripts/reports/run-report.sh generators/2026-09-30-maps-music-prev.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Maps-Music-precedent-2026-09-30.pdf';
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
  info: { Title: 'Hubera Maps + Music — bouton precedent', Author: 'Hubera' },
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
  'Maps + Music — le precedent change vraiment de titre',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para(
  '30 septembre 2026 ~03h50 Europe/Paris. Samsung SM-G990B2 + Blackview BV9700Pro. Volume media a 0. Nothing non overlaye. Pas de recreate ytmusic (API toujours up depuis le 29). OTA mandatory false, pas de forceUpdate Music.'
);

kvList([
  ['Maps', '0.1.51 vc 53 — overlay -r Samsung+BV, maps.hubera.cloud/updates.json'],
  ['Music', 'p+1.3.322 vc 10622 — overlay -r Samsung+BV, /install live, SHA 39af1e19ae16'],
  ['Fuel', '1.4.156 fond, peek mix inchange, package com.gasoiltracking.app'],
]);

h2('1. Casse, puis corrige');
table(
  ['Probleme', 'Cause', 'Correctif / preuve'],
  [
    [
      'Precedent Maps / notif restartait la piste apres 3 s',
      'Media3 seekToPreviousMediaItem restart si position > 3 s. skipPrev rappait ce seek via MediaController = boucle ou restart.',
      '1.3.322 : skipPrev appelle skipToPreviousFromExternal (seek index-1, 0 ms). Samsung PARISIENNE -> Blinding Lights (10 s) -> PARISIENNE. BV Cote Noir -> Welcome to The Internet -> Cote Noir.',
    ],
    [
      'Dock Maps « Rien en cours » alors que Music joue',
      'Apres overlay Music, MediaController Maps restait connecte a une session morte. Tick ne reconnectait que si controller == null.',
      '0.1.51 : liveController() droppe isConnected=false puis connect(). Dock PARISIENNE / Cote Noir au relance.',
    ],
  ],
  [1.1, 1.25, 1.65]
);

h2('2. Avant (session morte, 1.3.321)');
para(
  'Apres l overlay 1.3.321, Music jouait (shuffle) mais Maps restait sur « Rien en cours ». Impossible de tester le precedent depuis le dock.'
);
shot('Samsung — dock vide, Music pourtant en lecture', 'prev-322-avant-sam-vide.png');
shot('Blackview — dock vide, Music pourtant en lecture', 'prev-322-avant-bv-vide.png');

h2('3. Samsung — suivant puis precedent (> 5 s)');
para(
  'Position initiale PARISIENNE ~98 s (largement au-dela de 3 s). Suivant Maps : Blinding Lights, The Weeknd, item 4, 10 s. Precedent Maps : retour PARISIENNE item 3. Ce n est plus un restart de Blinding Lights.'
);
shot('Samsung 0.1.51 — dock reconnecte, PARISIENNE, Fuel, disque 30', 'prev-322-sam-dock.png');
shot('Samsung — suivant : Blinding Lights (piste a 10 s)', 'prev-322-sam-next.png');
shot('Samsung — precedent : retour PARISIENNE', 'prev-322-sam-prev.png');

h2('4. Blackview — meme scenario');
para(
  'Cote Noir feat. Leto ~132 s. Suivant : Welcome to The Internet, Bo Burnham. Precedent : retour Cote Noir. File item 4 -> 3.'
);
shot('Blackview 0.1.51 — dock Cote Noir, Fuel, disque 30', 'prev-322-bv-dock.png');
shot('Blackview — suivant : Welcome to The Internet', 'prev-322-bv-next.png');
shot('Blackview — precedent : retour Cote Noir', 'prev-322-bv-prev.png');

h2('5. Verdict');
table(
  ['Geste', 'Samsung', 'Blackview'],
  [
    ['Dock titre reel apres overlay Music', 'OK PARISIENNE', 'OK Cote Noir'],
    ['Play / pause Maps', 'OK (deja 0.1.50)', 'OK'],
    ['Suivant Maps', 'OK Blinding Lights', 'OK Welcome to The Internet'],
    ['Precedent apres > 5 s', 'OK PARISIENNE', 'OK Cote Noir'],
    ['Disque 30 + Fuel pendant Music', 'OK', 'OK'],
  ],
  [1.6, 1.2, 1.2]
);

h2('6. Production');
table(
  ['Host', 'Version'],
  [
    ['maps.hubera.cloud/updates.json', '0.1.51 vc 53 · sha256 29cac2d9665d · mandatory false'],
    ['music.hubera.cloud/api/install/apk-info', 'p+1.3.322 vc 10622 · 49 Mo · pas de forceUpdate'],
    ['ytmusic container', 'Inchange (up depuis 29 sept 00:04 UTC). docker cp APK seulement.'],
    ['hubera-maps container', 'Inchange (up depuis 29 sept). docker cp APK + updates.json.'],
  ],
  [1.8, 1.8]
);

h2('7. Pas encore resolu');
bullets([
  'StreamMake : stream.hubera.cloud reste landing + stub /app. Pas de deploy privilegie DVD.',
  'Nothing Phone : toujours exclu. /install en ligne (Maps 0.1.51, Music 1.3.322) pour plus tard.',
  'Notes Keep : pas de dessin, pieces jointes image, checklist riche type Keep web.',
  'Photos cloud : 0 photo sauvegardee. Galerie appareil OK depuis 1.0.4.',
  'Tasks : compte vide de taches (DB neuve).',
  'Fuel La Guerche : GPS fond OK, trajet neuf non rejoue cette nuit.',
  'Precedent si file d un seul titre : reste un seek a 0 (pas de titre d avant).',
]);

callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Fuel com.gasoiltracking.app inchange. Maps signing debug.keystore 3cf6c532. Music ovh.delhomme.ytmusic. Overlay -r Samsung+BV seulement. OTA jamais mandatory true.'
);

note('Captures 30 sept 2026 03:32-03:46. Samsung SM-G990B2 + Blackview EEA9700PRO0014587. Music pause en fin de test.');

const pages = writeFooters('Hubera Maps + Music — precedent');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
