'use strict';
/**
 * 30 sept 2026 ~20h20 — Maps onglet Fuel HUD, plus de flash MAJ.
 * ./scripts/reports/run-report.sh generators/2026-09-30-maps-fuel-hud.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Maps-Fuel-HUD-2026-09-30.pdf';
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
  info: { Title: 'Hubera — Maps Fuel HUD', Author: 'Hubera' },
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
  'Maps reste Maps. Fuel dedans : jauge, demarrer, plein.',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para(
  '30 septembre 2026 ~20h20 Europe/Paris. Samsung + Blackview overlay -r. Nothing : pas d overlay. Volume media 0. OTA jamais forcee.'
);

kvList([
  ['Maps', '0.1.56 vc 57 — SHA 076a95e74cff8cf8, mandatory false'],
  ['Fuel', '1.4.159 vc 183 — SHA 14066667ca41598f, forceUpdate=0'],
]);

h2('1. Ce qui clignotait');
para(
  'Quand Maps parlait a Fuel en silencieux (snapshot + historique), Fuel passait devant : splash (le logo) puis parfois la fenetre « Nouvelle version ». Maps revenait, puis recommencait. Ca s affiche / se desaffiche. En plus, ouvrir Trajets recouvrait toute la carte comme une 2e application, avec une liste de trajets a scroller et la barre Maps cachee.'
);
table(
  ['Correctif', 'Detail'],
  [
    ['Maps 0.1.56', 'Onglet Fuel = carte + carte jauge. Plus d historique. Plus de hop history. Snapshot au plus toutes les 45 s. Plus de check MAJ a chaque onResume.'],
    ['Fuel 1.4.159', 'Splash cache et dialogue MAJ ignore pendant silent=1.'],
  ],
  [1.3, 2.7]
);

h2('2. Ce que tu as dans Maps maintenant');
para(
  'Onglet Fuel (plus « Trajets »). La carte reste. Selection du vehicule, jauge, Demarrer un trajet, Ajouter un plein. L historique des trajets n est plus ici : il reste dans l app Hubera Fuel.'
);
shot('Samsung — carte + jauge 100 % + demarrer + plein, onglets Maps visibles', 'sam-m56-fuel.png');
shot('Blackview — meme HUD Fuel', 'bv-m56-fuel.png');
shot('Samsung — ajouter un plein sans quitter Maps', 'sam-m56-fill.png');

h2('3. Production');
table(
  ['Host', 'Etat'],
  [
    ['maps.hubera.cloud/updates.json', '0.1.56 vc 57 · sha256 076a95e74cff · mandatory false'],
    ['hubera-maps container', 'Inchange depuis 29 sept 02:01 UTC. docker cp seulement.'],
    ['Fuel APK', '1.4.159 vc 183 · forceUpdate 0'],
    ['Nothing', 'Pas d overlay. OTA en ligne.'],
  ],
  [1.6, 2.0]
);

h2('4. Pas encore resolu');
bullets([
  'Dock Music prend encore de la hauteur sous la jauge (ce n est plus un ecran Fuel plein pot).',
  'Formulaire plein un peu sous l horloge Samsung + clavier.',
  'Demarrer un trajet parle encore a Fuel en silencieux (GPS) : splash cache, Maps doit revenir.',
  'StreamMake, Notes dessin, Photos cloud, Tasks vides — inchanges.',
]);

callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Fuel com.gasoiltracking.app inchange. Overlay -r Samsung+BV seulement. Nothing exclue. OTA jamais mandatory / forceUpdate true.'
);

note('Captures 30 sept 2026 20:15. Samsung SM-G990B2 + Blackview overlay 0.1.56 / 1.4.159.');

const pages = writeFooters('Hubera Maps Fuel HUD');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => {
  process.exit(1);
});
