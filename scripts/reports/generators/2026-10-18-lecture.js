'use strict';
/**
 * Suite du 18 oct : quels titres jouent vraiment.
 *   REPORT_OUT=Hubera-2026-10-18-lecture.pdf ./scripts/reports/run-report.sh generators/2026-10-18-lecture.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-18-lecture.pdf';
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
  info: {
    Title: 'Hubera — lecture du 18 octobre 2026',
    Author: 'Hubera',
  },
});

const stream = fs.createWriteStream(out);
doc.pipe(stream);

const { ACCENT, DARK, LEFT, WIDTH, h2, para, note, bullets, kvList, table, writeFooters } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera — lecture du 18 octobre 2026',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para('Deux plages audio de 32 Ko, puis arrêt. Pas le morceau entier. La version installée reste 1.3.375 : le correctif est sur le serveur.');

kvList([
  ['Music', '1.3.375, pas de nouvel APK'],
  ['Sortie', 'une adresse partagée, sans cookie'],
  ['Jobs', 'updates.json toujours 404'],
]);

h2('Titres');
table(
  ['Id', 'Résultat', 'Raison', 'Temps'],
  [
    ['IKYOOJpX_7k', 'joue', 'itag 140, deux plages ftyp', '19 s'],
    ['UoQ5NEQhA-0', 'joue', 'itag 140, deux plages ftyp', '4 s'],
    ['aA_mowpNlyc', 'ne joue pas', 'YouTube : vidéo indisponible', '20 s'],
    ['83eTbLzmZzo', 'ne joue pas', 'YouTube : vidéo indisponible', '36 s'],
    ['HLCF4GW3JcU', 'ne joue pas', 'YouTube : vidéo indisponible', '33 s'],
  ],
  [1.4, 1.1, 2.4, 0.8],
);
note('Les trois refus viennent de la même sortie que les deux lectures. Le client Music confirme aA_mowpNlyc : Video unavailable.');

h2('Ce qui bloquait');
bullets([
  'Streaming data not available : l’adresse du serveur n’obtient pas de flux.',
  'No valid URL to decipher : l’itag forcé n’avait ni URL ni signature. Les itags 140 et 139 en ont une.',
  'Aucun format vidéo progressif et getAudioFormat deadline : la recherche d’un clip muxé dépassait 40 s.',
  'Le chargement en file ne précharge plus qu’un titre. Pas de rafale.',
]);

h2('Jobs');
para('L’application appelle /api/v1/mobile/releases/latest, déjà en 1.0.70, build 70, forceUpdate false. https://jobs.hubera.cloud/updates.json reste 404 : ce n’est pas le flux de l’app. La version n’a pas été baissée.');

const pages = writeFooters('Hubera — lecture 18 oct 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
