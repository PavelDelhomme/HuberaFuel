'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-15-plan-unique.pdf';
const outDir = process.env.REPORT_DIR
  ? path.resolve(process.env.REPORT_DIR)
  : path.join(__dirname, '../../../dist/reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, OUT_NAME);

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 40, bottom: 46, left: 40, right: 40 },
  bufferPages: true,
  autoFirstPage: true,
  info: { Title: 'Hubera — plan unique 15 oct 2026', Author: 'Hubera' },
});
doc.pipe(fs.createWriteStream(out));
const { ACCENT, DARK, LEFT, WIDTH, h2, para, callout, kvList, table, writeFooters } = bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text('Hubera — plan unique', LEFT(), doc.y, { width: WIDTH() });
para('15 octobre 2026. Un seul plan Cursor. Ce PDF reprend ce qui est livré et ce qui reste à cocher.');
callout('Nothing', 'Paul teste le Nothing. Samsung et Blackview ont reçu les overlays de ce lot.', ACCENT);
kvList([
  ['Music', 'p+1.3.370 code 10670, deux paquets, overlay + copie serveur'],
  ['Maps', '0.1.98 code 99, tableau de bord jauge clim chauffage'],
  ['Docs', 'p+0.2.12 code 212, barres transparentes, overlay deux paquets'],
  ['OTA', 'Jamais forcée'],
]);

h2('Encore ouvert');
table(
  ['Sujet', 'État'],
  [
    ['Landings CMS', 'Commande VTCBuilder, hubera.cloud ajouté. Pas exécutée en prod.'],
    ['Erreurs Admin', 'Groupement par signature dans le code web Music. Pas déployé.'],
    ['Lots A à F', 'Pas rejoués geste par geste.'],
  ],
  [1.2, 2.4],
);
para('Tu coches dans Hubera Docs. Un geste non rejoué reste à faire.');
writeFooters();
doc.end();
console.log(JSON.stringify({ out }));
