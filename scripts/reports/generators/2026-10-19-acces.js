'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-19-acces.pdf';
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
  info: { Title: 'Hubera — accès du 19 octobre 2026', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, h2, para, bullets, callout, table, writeFooters } = bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(0.6);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text('Hubera — accès du 19 octobre 2026', LEFT(), doc.y, { width: WIDTH() });
para('Docs sur le Nothing est reconnecté. Le téléphone n’a pas été touché ensuite. Une mise à jour est proposée, jamais verrouillée.');
callout('Nothing', 'Hubera Docs p+0.2.30, code 230. Compte principal, cockpit ouvert, pas d’erreur rouge. Hubera ID 0.1.16, code 116, session tenue.');

h2('Docs servi');
bullets([
  'cloud.hubera.docs en premier. Code 230. Magic APK 504b0304. Lanceur Hubera Docs.',
  'Un client en 0.2.29, code 229, voit apkAvailable true vers 0.2.30. forceUpdate false. mandatory false.',
  'Un client déjà en 0.2.30, code 230, voit la même version, pas une APK plus vieille. apkAvailable false.',
  'Le paquet legacy ovh.delhomme.hubera.docs reste annoncé en 0.2.29, code 229. Il n’a pas été reconstruit.',
  '193 tâches après le redémarrage du conteneur. Pas de down -v.',
]);

h2('Hubera ID');
bullets([
  'Le plus ancien code publié est 0.1.3, code 103. Ce client reçoit 0.1.16, code 116. apkAvailable true.',
  'L’APK servie est cloud.hubera.id, magic 504b0304, plus récente que 103. forceUpdate false. mandatory false.',
  'Un client déjà en 0.1.16, code 116, voit apkAvailable false.',
  'Android ne peut pas installer un second paquet en silence. L’app propose l’APK officielle sur id.hubera.cloud, et seulement après un geste.',
  'Si ID est là et au moins en 0.1.12, code 112, l’app reprend le compte. Une mise à jour n’efface pas cette session.',
  'ID 0.1.3, code 103, est trop ancien pour cette reprise : la proposition s’affiche, sans installation silencieuse.',
  'Pas de binaire iOS dans les dépôts. Pas de fiche App Store.',
]);

h2('Samsung');
para('Samsung SM-G990B2, Android 16, SDK 36. Hubera ID 0.1.16 code 116. Notes 0.1.17 code 18 s’ouvre sur la liste, sans mot de passe et sans installeur. L’APK Notes contient déjà le texte « Installer Hubera ID » et l’hôte id.hubera.cloud. Le code nouveau du module commun n’est pas encore dans cette APK installée : il part avec la prochaine mise à jour des apps Flutter.');
bullets([
  'Docs cloud sur ce Samsung : p+0.2.29, code 229. Docs legacy : p+0.2.27, code 227.',
  'Les AVD Cloudity et JobbingTrack visent Android 34, mais l’image système n’est pas sur le disque. Ils n’ont pas été démarrés.',
  'Blackview : une tentative, appareil absent.',
]);

h2('Accès Docs, recontrôlé');
table(
  ['Appel', 'Réponse'],
  [
    ['SSO sans jeton', '400 champs'],
    ['Tableau de bord sans session', '401 auth'],
    ['Tâches sans session', '401 auth'],
    ['Compte sans session', '401 auth'],
    ['Autre compte, exemple', '403 allowlist'],
  ],
  [2.4, 1.2]
);
para('Un jeton forgé n’a pas été rejoué dans ce passage. Le refus d’un jeton invalide avait déjà été vu plus tôt dans la journée.');

const pages = writeFooters('Hubera — 19 octobre 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
