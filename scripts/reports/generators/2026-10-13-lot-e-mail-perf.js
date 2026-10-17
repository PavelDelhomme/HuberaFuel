'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-13-lot-E-mail-perf.pdf';
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
    Title: 'Hubera — Lot E 13 oct — Mail / IMAP / suite',
    Author: 'Hubera',
  },
});

const stream = fs.createWriteStream(out);
doc.pipe(stream);

const {
  ACCENT,
  DARK,
  LEFT,
  WIDTH,
  h2,
  para,
  note,
  bullets,
  callout,
  kvList,
  table,
  writeFooters,
} = bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(17).fillColor(DARK).text('Hubera Cloud — Lot E', LEFT(), doc.y, {
  width: WIDTH(),
});
para('13 octobre 2026, soir. Mail trop lent, OTA au boot, IMAP OVH, accueil Notes / Photos / Drive. Plan unique : docs.hubera.cloud → PLAN.md. Aucun secret dans ce PDF.');
callout(
  'IMAP paul@delhomme.ovh',
  'Le mot de passe NIC Manager et le mot de passe Hubera ID sont refuses par IMAP OVH. Copier une fois le mot de passe de la boite (Manager OVH → E-mails → cette adresse) dans Hubera Mail. Ensuite il est chiffre cote serveur.',
  ACCENT,
);
kvList([
  ['Candidatures@', 'IMAP pret (deja persisté)'],
  ['paul@ / dev@', 'identifiants refuses — mdp boite manquant'],
  ['OTA', 'forceUpdate: false / mandatory: false'],
  ['Nothing', 'pas d’ADB — sideload / OTA'],
]);
h2('1. Pourquoi chaque tap Mail prenait un temps infini');
bullets([
  'Sync IMAP sequentielle de toutes les boites, timeout 45 s par boite sans secret.',
  'Le client envoyait un mot de passe vide si aucun n’etait fourni.',
  'OTA + prefs + notifs sur le chemin du premier ecran (deja recule : OTA ≥ 20 s).',
]);
h2('2. Correctifs code (ce soir)');
table(
  ['App', 'Version', 'Changement'],
  [
    ['Mail', '1.0.6', 'Skip IMAP non pret, sync parallele, liste DB, FAB actif'],
    ['Photos', '1.0.13', 'Cache accueil + Workmanager apres 1er frame'],
    ['Notes', '0.1.7', 'FAB Keep note / liste / rappel'],
    ['Drive', '1.0.7', 'Accueil sans vider la liste'],
    ['Calendar', '0.1.8', 'Chrome drawer / FAB'],
  ],
  [1.2, 0.8, 3],
);
h2('3. Overlay labo (E6)');
bullets([
  'Dual APK cloud.hubera.* + legacy fr.cloudity.*',
  'Samsung R5CT7263YJL et Blackview EEA9700PRO0014587, overlay -r',
  'Pas de docker compose down -v, Watchtower OFF, pas de force-push',
]);
h2('4. A retester sur le telephone');
bullets([
  'Mail : inbox visible tout de suite, pas de popup OTA au splash, refresh rapide.',
  'Boites deja pretes (candidatures@) : lecture sans demander de mot de passe.',
  'paul@ : bandeau MDP une fois, puis disparait.',
  'Notes : bouton + → note / liste / rappel.',
  'Photos / Drive : accueil avec le contenu precedent, pas un spinner plein ecran.',
]);
note('Genere via scripts/reports (pdfkit-safe). Aucun mot de passe / JWT / NIC dans ce PDF.');

const pages = writeFooters('Hubera — Lot E 13 oct');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
