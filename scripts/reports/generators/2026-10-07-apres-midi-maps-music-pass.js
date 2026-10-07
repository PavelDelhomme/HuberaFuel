'use strict';
/**
 * 7 oct 2026 après-midi — Maps GPS arrêt, Music paroles, Pass autofill.
 * ./scripts/reports/run-report.sh generators/2026-10-07-apres-midi-maps-music-pass.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-07-apres-midi-maps-music-pass.pdf';
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
    Title: 'Hubera — 7 octobre 2026 après-midi (Maps / Music / Pass)',
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
  bullets,
  callout,
  kvList,
  table,
  writeFooters,
} = bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera — 7 octobre 2026 (apres-midi)',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para(
  'Samsung reconnecte en USB. Overlay labo, pas le Nothing (Paul installe lui-meme). ' +
    'forceUpdate / mandatory = false. Pas de docker compose down -v. Pas d injection paul@ sur Nothing.'
);

kvList([
  ['Samsung', 'R5CT7263YJL USB. Maps 0.1.75 + Music p+1.3.356 dual APK.'],
  ['Blackview', 'USB MediaTek vu, ADB absent ce creneau. Pas d overlay.'],
  ['Nothing', 'Non touche.'],
  ['Maps live', '0.1.75 vc 76. OTA mandatory false. SHA apk 204141d8.'],
  ['Music live', '1.3.356 vc 10656. OTA forceUpdate false. apkAvailable true pour 1.3.355.'],
  ['Fuel tel', 'Samsung encore 1.4.165.'],
]);

h2('1. Maps — GPS a l arret');
callout(
  'Ce n etait pas des bouchons',
  'Le GPS bouge de 1-3 km/h tout seul. La voix parlait. Fuel comptait. Les 47 km / 57 min etaient le RESTE d itineraires, pas un trajet deja fait.'
);
bullets([
  'Sous 5 km/h : affichage 0, voix coupee, pas de km fantomes sur le trace.',
  'HUD : « A l arret » / « En pause » + reste km/min.',
  'Fuel ne demarre plus au tap Guidage : seulement apres quelques secondes vraiment en mouvement, ou via Fuel toi-meme.',
  'Horloge Fuel figee a l arret et en pause.',
  'Overlay Samsung cloud + legacy 0.1.75. Web maps.hubera.cloud deja 0.1.75.',
]);

h2('2. Music — paroles');
para(
  'Le karaoke 3 lignes empechait de voir avant/apres. 1.3.356 : toutes les lignes sont dans une liste scrollable. ' +
    'La ligne chantee reste en evidence. Si tu scrolle, le suivi s arrete. Sans geste pendant 8 secondes, ca revient a la ligne en cours (plus trop tot).'
);
bullets([
  'Overlay Samsung cloud + legacy p+1.3.356.',
  'OTA slots hubera-music.apk + ytmusic.apk (pas seulement ytmusic.apk).',
  'Test Samsung : Media3 a charge un titre biblio perso (UZULECEKSIN 2.0 / SNOW / Murat Boz). Session OK. Play keyevent : reste PAUSED pos=0 (pas un harnais skip).',
  'Dock Maps : pont HuberaMusic inchange (play/pause/next depuis Maps).',
]);

h2('3. Pass — remplissage auto');
para(
  'Service Autofill Android (champs identifiant / mot de passe, type Bitwarden). Cache memoire 5 min apres ouverture du coffre. ' +
    'Master key jamais sur disque. Cadenas explicite vide le cache. Code dans products/pass/mobile. APK Flutter pas encore builde ni overlay.'
);

h2('4. Suite HTTP (smoke)');
table(
  ['Service', 'HTTP', 'Note'],
  [
    ['fuel.hubera.cloud', '200', 'OK'],
    ['id.hubera.cloud', '200', 'OK'],
    ['jobs.hubera.cloud', '200', 'OK'],
    ['docs.hubera.cloud', '200', 'OK'],
    ['mail / pass / drive', '302', 'redir login Cloudity encore live'],
  ]
);

h2('5. Kanban (pas encore fait)');
bullets([
  'Blackview ADB + overlay Maps 0.1.75 et Music 1.3.356.',
  'Build/overlay Pass Autofill. Activer Remplissage auto dans Android.',
  'Fuel 1.4.166+ + budget unique (tel encore 165).',
  'Verif visuelle paroles 8 s sur un LRC.',
  'OTA GET /api/version type Music pour Maps / Mail / …',
  'Contacts / Calendar / Hubera Hub : plus tard.',
  'Watchtower Music : rester OFF.',
]);

h2('Docs');
para(
  'docs.hubera.cloud : content/products/{music,maps,fuel,pass}.md + rapport 2026-10-07-apres-midi.md. ' +
    'Taches kanban mises a jour (fait / a faire).'
);

writeFooters();
doc.end();
stream.on('finish', () => {
  process.stdout.write(JSON.stringify({ out }) + '\n');
});
