'use strict';
/**
 * 30 sept 2026 ~21h25 — Maps cadre A+B au démarrage d’un trajet.
 * ./scripts/reports/run-report.sh generators/2026-09-30-maps-fit-ab.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Maps-cadre-AB-2026-09-30.pdf';
const outDir = process.env.REPORT_DIR
  ? process.env.REPORT_DIR
  : path.join(__dirname, '../../../dist/reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, OUT_NAME);

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 40, bottom: 46, left: 40, right: 40 },
  bufferPages: true,
  autoFirstPage: true,
  info: { Title: 'Hubera Maps cadre A+B', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, para, h2, bullets, callout, kvList, table, writeFooters, note } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Maps : voir le depart et l arrivee ensemble.',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '30 septembre 2026 ~21h25 Europe/Paris. Au demarrage d un trajet, la carte ne cadrait pas le point A (position / depart) et le point B (arrivee). Leaflet prenait le padding comme un Point a 2 valeurs : le haut et le bas etaient identiques, donc un des deux points passait sous la barre transport, le bouton position ou le dock du bas.'
);
kvList([
  ['Maps', '0.1.60 vc 61 — overlay Blackview, OTA mandatory false'],
  ['Carte visible', 'Sous la barre (recherche + type de transport), a gauche du bouton position, au-dessus des onglets / Music'],
]);
h2('1. Correctif');
table(
  ['Avant', 'Maintenant'],
  [
    ['Padding Leaflet mal forme (4 chiffres ignores)', 'paddingTopLeft / paddingBottomRight mesures sur les vrais overlays'],
    ['Un seul point a l ecran', 'Marqueurs A et B + itineraire dans la fenetre libre'],
    ['Recalcul trop tot (carte encore cachee)', 'Recadrage apres affichage de la carte transport / Demarrer'],
  ],
  [2, 2]
);
h2('2. A tester');
bullets([
  'Recherche une destination (Maison / Intermarche).',
  'Tu dois voir A (toi) et B (arrivee) en meme temps, sous Voiture / Pied / Velo / Transports, sans que le bouton position les cache.',
  'Changer de mode de transport recadre encore les deux points.',
]);
callout('Volumes / packages', 'Aucun down -v. Conteneur hubera-maps inchange (docker cp). Package ovh.delhomme.maps inchange.');
note('Fuel 1.4.162 inchange ce tour.');
const pages = writeFooters('Hubera Maps cadre A+B');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => process.exit(1));
