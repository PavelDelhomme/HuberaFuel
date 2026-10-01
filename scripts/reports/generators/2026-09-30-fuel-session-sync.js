'use strict';
/**
 * 30 sept 2026 ~21h20 — session Fuel + sync Nothing + plein 806.
 * ./scripts/reports/run-report.sh generators/2026-09-30-fuel-session-sync.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Fuel-session-sync-2026-09-30.pdf';
const outDir = process.env.REPORT_DIR
  ? process.env.REPORT_DIR
  : path.join(__dirname, '../../../dist/reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, OUT_NAME);

const CONNECT = process.env.FUEL_CONNECT_URL || 'https://fuel.hubera.cloud/install';

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 40, bottom: 46, left: 40, right: 40 },
  bufferPages: true,
  autoFirstPage: true,
  info: { Title: 'Hubera Fuel session et sync', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, para, h2, bullets, callout, kvList, table, writeFooters, note } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Fuel : rester connecte, sync automatique, plein 806.',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '30 septembre 2026 ~21h20 Europe/Paris. Le Nothing n etait jamais vraiment connecte a Fuel : mot de passe Hubera ID refuse, QR web inutile, jeton JWT de 20 minutes, et un refresh en course deconnectait le telephone. Sans compte, le plein saisi dans Maps restait local et n allait pas dans le cloud.'
);
kvList([
  ['Fuel', '1.4.162 vc 186 — session 7 jours, sync a la connexion, forceUpdate=0'],
  ['Maps', '0.1.59 — plein memorise si Fuel n est pas pret, hop plus long'],
  ['Plein 806 cloud', '30/09 Intermarche La Guerche : 59,3 L · 104,31 EUR · jauge 80 L / 100 %'],
  ['Lien Nothing 24 h', CONNECT],
]);
h2('1. Sur le Nothing maintenant');
bullets([
  'Chrome : ' + CONNECT,
  'Ouvrir Hubera Fuel. Tu arrives sur paul@delhomme.ovh, le cloud se telecharge (806, 53,1 km, plein).',
  'Si l app n est pas la : fuel.hubera.cloud/install puis reviens sur le lien.',
  'Ensuite la session reste : plus de deconnexion toutes les 20 minutes.',
]);
h2('2. Ce qui cassait');
table(
  ['Cause', 'Correctif'],
  [
    ['JWT 20 min + 2 refresh en meme temps', 'Access 7 jours. Course refresh : plus de deconnexion de tous les appareils.'],
    ['QR / lien connect sans sync', 'Apres connexion, Fuel tire le cloud (vehicules, trajets, pleins).'],
    ['Plein Maps perdu si Fuel deconnecte', 'Le plein est memorise dans Maps et renvoye. Fuel pousse le cloud des qu il y a un compte.'],
    ['Plein local ecrase par le cloud', 'Les pleins uniques du telephone sont fusionnes, pas jetes.'],
  ],
  [1.4, 2.6]
);
h2('3. Plein 806');
bullets([
  'Deja dans le cloud depuis 16:28 UTC : Intermarche La Guerche, 59,3 L, 104,31 EUR, 806 a 80 L.',
  'Tickets litres/prix estimes (21 L restants -> plein). Si le ticket caisse dit autre chose, on le corrige dans Fuel sans toucher aux km.',
  'Trajet du matin 53,1 km conserve. 103 trajets, ~3965 km.',
]);
callout('Volumes / packages', 'Aucun down -v. Package com.gasoiltracking.app inchange. OTA jamais forcee. Overlay Blackview seulement.');
note('Lien valable jusqu au 1er octobre 2026 ~21h12 Europe/Paris.');
const pages = writeFooters('Hubera Fuel session et sync');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => process.exit(1));
