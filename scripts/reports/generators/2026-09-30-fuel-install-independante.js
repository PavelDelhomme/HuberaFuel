'use strict';
/**
 * 30 sept 2026 ~20h50 — Fuel app indépendante, MAJ plus bloquante, Maps 0.1.58.
 * ./scripts/reports/run-report.sh generators/2026-09-30-fuel-install-independante.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Fuel-install-independante-2026-09-30.pdf';
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
  info: { Title: 'Hubera — Fuel app independante', Author: 'Hubera' },
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
  'Hubera Fuel s installe toute seule. La mise a jour ne bloque plus l app.',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para(
  '30 septembre 2026 ~20h50 Europe/Paris. Tu ne pouvais plus ouvrir les apps a cause d une MAJ, et Fuel n etait pas installable comme une vraie application. Page /install Fuel etait le site Expo (juste le mot « Fuel »). Le dialogue MAJ cachait Continuer pendant le telechargement 45 Mo. Le launcher s appelait Fuel, pas Hubera Fuel. Overlay -r Blackview. Samsung ADB coupe ce tour. Nothing hors reseau : OTA en ligne, pas d overlay.'
);

kvList([
  ['Maps', '0.1.58 vc 59 — SHA 4e7e9499124073c3, mandatory false'],
  ['Fuel', '1.4.160 vc 184 — SHA dc2336265ccb9a61, forceUpdate=0, launcher Hubera Fuel'],
]);

h2('1. Ce qui cassait');
table(
  ['Probleme', 'Cause', 'Correctif'],
  [
    ['Pas d install Fuel independante', 'fuel.hubera.cloud/install = SPA Expo. Android refusait d ouvrir le site APK.', '/install = page APK. Nom launcher Hubera Fuel. Bouton Ouvrir l app dans Maps.'],
    ['MAJ, rien ne s ouvre', 'Dialogue sans Continuer pendant le DL. Maps /install disait « jamais Chrome » et 0.1.32.', 'Continuer toujours visible (annule le DL). Maps : Continuer + Site web. Jamais force.'],
    ['Nothing / Samsung', 'Nothing hors Wi-Fi. Samsung ADB perdu (disconnect plus tot).', 'OTA live. Nothing : ouvrir fuel.hubera.cloud/install puis Continuer dans l app.'],
  ],
  [1.2, 1.4, 1.4]
);

h2('2. Preuves Blackview');
shot('Fuel 1.4.160 Accueil independant — 806 100 %, 53,1 km, pas de MAJ', 'bv-fuel-160-accueil.png');
shot('Maps 0.1.58 onglet Fuel — Ouvrir l app Hubera Fuel', 'bv-maps-058-fuel-hud.png');
shot('Apres le bouton : vraie app Fuel Accueil (plus un clone Maps)', 'bv-from-maps-open-fuel.png');

h2('3. Production');
table(
  ['Host', 'Etat'],
  [
    ['fuel.hubera.cloud/install', 'Page APK Hubera Fuel. docker cp nginx, pas de recreate'],
    ['fuel /api/version', '1.4.160 vc 184 · forceUpdate false'],
    ['maps.hubera.cloud/updates.json', '0.1.58 vc 59 · sha256 4e7e9499 · mandatory false'],
    ['maps.hubera.cloud/install', '0.1.58 + lien Fuel. Plus le texte 0.1.32 / jamais Chrome'],
    ['hubera-maps container', 'Inchange depuis 29 sept 02:01 UTC'],
    ['Nothing / Samsung', 'Pas d overlay ce tour. Telechargement web + Continuer'],
  ],
  [1.6, 2.0]
);

h2('4. Pas encore resolu');
bullets([
  'Samsung et Nothing non connectes ADB ce tour : overlay seulement Blackview.',
  'Si Nothing affiche encore une ancienne MAJ : Continuer, ou Chrome → fuel.hubera.cloud/install.',
  'Dock Music recouvre encore le bas du HUD Fuel.',
  'Plein litres/prix du 30/09 est estime (104,31 EUR).',
  'StreamMake, Notes dessin, Photos cloud, Tasks — inchanges.',
]);

callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Fuel com.gasoiltracking.app inchange. Overlay -r Blackview. OTA jamais mandatory / forceUpdate true.'
);

note('Captures 30 sept 2026 20:45. Blackview BV9700Pro overlay 0.1.58 / 1.4.160.');

const pages = writeFooters('Hubera Fuel install independante');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => {
  process.exit(1);
});
