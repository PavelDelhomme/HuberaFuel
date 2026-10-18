'use strict';
/**
 * Hubera — passe du 18 oct 2026.
 *   REPORT_OUT=Hubera-2026-10-18-erreurs.pdf ./scripts/reports/run-report.sh generators/2026-10-18-erreurs.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-18-erreurs.pdf';
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
    Title: 'Hubera — erreurs du 18 octobre 2026',
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
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera — erreurs du 18 octobre 2026',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para('Samsung et Blackview seulement. Le Nothing n’a pas été modifié. OTA jamais forcée.');

kvList([
  ['Music', '1.3.375 / 10675, les deux paquets'],
  ['Mail', '1.0.28 / 29'],
  ['Photos', '1.0.21 / 22'],
  ['Docs', 'health 0.2.22, pas de nouvel APK'],
  ['Garde', 'python3 scripts/guard-known-bugs.py'],
]);

h2('1. Titres Music essayés');
para('Un titre à la fois, coupé à 60 s. Pas le morceau entier. L’identifiant est dans chaque ligne.');
table(
  ['Id', 'Résultat', 'Raison', 'Temps'],
  [
    ['IKYOOJpX_7k', 'ne marche pas', 'Streaming data not available, puis deadline', '8 s puis 40 s'],
    ['UoQ5NEQhA-0', 'ne marche pas', 'No valid URL to decipher', 'non mesuré'],
    ['aA_mowpNlyc', 'ne marche pas', 'Aucun format vidéo progressif', '36 s'],
    ['83eTbLzmZzo', 'ne marche pas', 'Streaming data not available', 'non mesuré'],
    ['HLCF4GW3JcU', 'ne marche pas', 'Streaming data not available', 'non mesuré'],
  ],
  [1.3, 1.2, 2.2, 1.1],
);
note('aA_mowpNlyc : le rejet porte maintenant id=aA_mowpNlyc et trackId. Avant, le mail disait seulement generic.');

h2('2. Rejets sans titre');
para('Les server.unhandledRejection récents disaient « Aucun format vidéo progressif » sans videoId. Le handler ne lisait que [stream ID] et /api/stream/ID. getVideoFormat jetait l’erreur après qu’une course de 12 s l’avait déjà abandonnée.');
bullets([
  'L’erreur dit maintenant « Aucun format vidéo progressif id=<videoId> » et porte trackId.',
  'Le délai getAudioFormat deadline porte le même id.',
  'Le pré-diagnostic n’est plus generic seul : famille video-format, ou track si un id est lu.',
  'Un fichier cache /cache/<id>.m4a est aussi reconnu.',
  'Même chemin pour chaque compte. Pas de cookie, proxy ou tunnel réservé à un utilisateur.',
]);

h2('3. Chargement');
para('À chaud, un seul prochain titre est préparé, en préfixe, pas une rafale de fichiers entiers. Le téléphone ne précharge que le titre suivant pendant la lecture. Le temps jusqu’au premier son sur une longue file aléatoire reste à mesurer sur téléphone.');

h2('4. Applications publiées');
table(
  ['App', 'Version', 'Téléphones'],
  [
    ['Music', '1.3.375', 'Samsung les deux paquets, Blackview cloud.hubera.music'],
    ['Mail', '1.0.28', 'Samsung et Blackview, cloud.hubera.mail'],
    ['Photos', '1.0.21', 'Samsung et Blackview, cloud.hubera.photos'],
  ],
  [1, 1.2, 3],
);
bullets([
  'Paquet cloud.hubera en premier, legacy à la même version.',
  'Magic APK 504b0304. forceUpdate false. mandatory false.',
  'Music : apkAvailable true pour 1.3.374, false pour 1.3.375.',
  'Mail ne montre plus un code HTTP brut. La synchro s’arrête en arrière-plan.',
  'Photos : le tiroir affiche 1.0.21.',
]);

h2('5. Non republiées');
para('Calendar, Contacts, Drive, Cook, Fuel, ID, Jobs, Maps, Notes, Pass, Tasks et Admin n’ont pas changé de code. Docs : correctif health seulement, version 0.2.22, pas de nouvel APK. Le véhicule labo et la 206 n’ont pas été touchés.');

h2('6. Encore ouvert');
bullets([
  'Jobs : https://jobs.hubera.cloud/updates.json répond 404. La page d’accueil n’a pas 127.0.0.1. La garde échoue sur ce seul point.',
  'Trois titres sans streaming data YouTube, et UoQ5NEQhA-0 que le déchiffreur ne sait pas ouvrir.',
  'IKYOOJpX_7k : le VPS n’a pas obtenu de flux en 40 s. L’id est dans la raison.',
  'Mesurer le démarrage aléatoire sur téléphone. Tâche Docs.',
  'Admin Samsung est en 0.1.8, sous le plancher 0.1.11, sans correctif dans cette passe.',
]);

h2('7. Garde');
para('Depuis Hubera Docs : python3 scripts/guard-known-bugs.py');
para('Le 18 oct au soir : Music, Mail, Photos, Docs health et les autres flux au plancher sont OK. Jobs updates.json reste en échec.');

const pages = writeFooters('Hubera — 18 oct 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
