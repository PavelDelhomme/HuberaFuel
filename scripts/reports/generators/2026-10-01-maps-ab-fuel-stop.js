'use strict';
/**
 * 1 oct 2026 ~03h50 — Maps A+B visibles + Arrêter Fuel sans hop d'app.
 * ./scripts/reports/run-report.sh generators/2026-10-01-maps-ab-fuel-stop.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Maps-AB-Fuel-stop-2026-10-01.pdf';
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
  info: { Title: 'Hubera Maps A+B et Arreter Fuel', Author: 'Hubera' },
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
  'Maps : A et B visibles. Arrêter Fuel sans quitter la carte.',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '1er octobre 2026 ~03h50 Europe/Paris. L itineraires cadrait le milieu du tracé (forêt, rien a voir). Arrêter ouvrait Hubera Fuel puis la refermait. Correctif testé sur Samsung SM-G990B2 et Blackview BV9700Pro. Nothing : OTA seulement, pas d overlay.'
);
kvList([
  ['Maps', '0.1.62 vc 63 — SHA 59ffd41eaa9618, overlay -r Samsung+BV, mandatory false'],
  ['Fuel', '1.4.163 vc 187 — SHA 124c9baa592d, overlay -r Samsung+BV, forceUpdate=0'],
  ['Conteneur maps', 'hubera-maps inchange depuis 2026-09-29T02:01:09Z (docker cp, pas de recreate)'],
]);
h2('1. Itineraire : depart A et arrivee B');
para(
  'La carte dezoome et centre entre ta position (Depart) et la destination (B Arrivée), dans le trou libre sous la barre Voiture / Pied / Velo / Transports et au-dessus du dock Music. Plus le barycentre du polygone de route.'
);
table(
  ['Avant', 'Maintenant'],
  [
    ['Milieu du tracé, A et B hors ecran', 'A Depart + B Arrivee visibles ensemble'],
    ['Arrêter ouvre / ferme Fuel', 'Broadcast Fuel, Maps reste au premier plan'],
  ],
  [2, 2]
);
shot('Blackview — Rennes vers Intermarche La Guerche, A et B dans la carte', '2026-10-01-bv-ab.png');
shot('Samsung — mêmes points Depart / Arrivee', '2026-10-01-ss-ab.png');
h2('2. Arrêter sans casser Maps');
para(
  'Demarrer un trajet allume le HUD Fuel (Pause, Arrêter, Plein) sans ouvrir l app Fuel. Arrêter envoie un broadcast headless. Log : FuelBridge control stop broadcast, pas d Activity. ResumedActivity reste ovh.delhomme.maps sur les deux telephones.'
);
shot('Blackview — guidage + HUD Fuel, toujours dans Maps', '2026-10-01-bv-live.png');
shot('Blackview — après Arrêter : Fuel disparu, Maps toujours là, A et B encore visibles', '2026-10-01-bv-stop.png');
h2('3. OTA');
bullets([
  'maps.hubera.cloud/updates.json = 0.1.62 vc 63, mandatory false, Continuer possible.',
  'fuel.hubera.cloud/api/version = 1.4.163 vc 187, forceUpdate false.',
  'Nothing : pas d overlay. Recuperer plus tard via Continuer / install.',
]);
callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Fuel com.gasoiltracking.app inchange. Maps ovh.delhomme.maps debug.keystore historique. Overlay -r Samsung+BV seulement.'
);
note('Captures 1er oct 2026 ~03h44-03h48. Volume media a 0. Music laisse en lecture (BV Babylon / Samsung Parisienne).');
const pages = writeFooters('Hubera Maps A+B Fuel stop');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => process.exit(1));
