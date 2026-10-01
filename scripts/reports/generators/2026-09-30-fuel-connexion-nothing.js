'use strict';
/**
 * 30 sept 2026 ~21h00 — Nothing : connexion Hubera Fuel.
 * ./scripts/reports/run-report.sh generators/2026-09-30-fuel-connexion-nothing.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Fuel-connexion-Nothing-2026-09-30.pdf';
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
  info: { Title: 'Hubera Fuel connexion Nothing', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, para, h2, bullets, callout, kvList, table, writeFooters, note } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Nothing : connecter Hubera Fuel avec le compte Hubera.',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '30 septembre 2026 ~21h00 Europe/Paris. Sur le Nothing tu ne pouvais pas te connecter a Hubera Fuel. Le formulaire etait pre-rempli gmail, le QR affiche etait celui du site web (pas pour le telephone), et le mot de passe Hubera ID n etait pas accepte (Fuel a le sien). Nothing hors ADB : pas d overlay. Lien 24 h ci-dessous.'
);
kvList([
  ['Fuel', '1.4.161 vc 185 — forceUpdate=0, launcher Hubera Fuel'],
  ['Compte', 'paul@delhomme.ovh (gmail paveldelhomme@gmail.com = le meme compte)'],
  ['Lien Nothing 24 h', CONNECT],
]);
h2('1. Sur le Nothing maintenant');
bullets([
  'Chrome : ' + CONNECT,
  'Bouton Ouvrir Hubera Fuel. Si l app n est pas la : fuel.hubera.cloud/install puis reviens sur le lien.',
  'Sinon dans l app : Connexion, email paul@delhomme.ovh. Le mot de passe Hubera ID est maintenant accepte (repli vers id.hubera / Cloudity). Sinon le mot de passe Fuel.',
  'Scanner un QR depuis Mon compte sur Blackview / le site si tu es deja connecte ailleurs.',
]);
h2('2. Technique');
table(
  ['Correctif', 'Detail'],
  [
    ['Login', 'Si le mot de passe Fuel echoue, l API teste Hubera ID (calendar/mail/contacts/api.cloudity).'],
    ['Email par defaut', 'paul@delhomme.ovh au lieu de gmail'],
    ['QR login', 'Sur telephone : scanner pour connecter CET appareil. Le QR web n apparait plus sur le login mobile.'],
    ['/connect 24 h', 'Pair d appareil valable 24 h, page HTML + deep link gasoiltracking://'],
  ],
  [1.2, 2.8]
);
h2('3. Pas encore resolu');
bullets([
  'Nothing toujours hors ADB : je n ai pas pu overlay ni voir l ecran.',
  'Samsung ADB toujours coupe.',
  'Si le mot de passe Hubera ID est refuse, c est encore le mot de passe Fuel (Gasoil Tracking).',
]);
callout('Volumes / packages', 'Aucun down -v. Package com.gasoiltracking.app inchange. OTA jamais forcee.');
note('Lien valable jusqu au 1er octobre 2026 ~20h57 Europe/Paris.');
const pages = writeFooters('Hubera Fuel connexion Nothing');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => process.exit(1));
