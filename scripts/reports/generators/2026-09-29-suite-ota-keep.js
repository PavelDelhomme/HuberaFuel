'use strict';
/**
 * 29 sept 2026 — Suite Hubera : OTA type Maps + Notes Keep + overlay Samsung/BV.
 * Pipeline: ./scripts/reports/run-report.sh generators/2026-09-29-suite-ota-keep.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Suite-OTA-Keep-2026-09-29.pdf';
const outDir = process.env.REPORT_DIR
  ? path.resolve(process.env.REPORT_DIR)
  : path.join(__dirname, '../../../dist/reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, OUT_NAME);
const ASSETS = path.join(__dirname, '../assets');

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 40, bottom: 46, left: 40, right: 40 },
  bufferPages: true,
  autoFirstPage: true,
  info: {
    Title: 'Hubera suite — OTA produit + Notes Keep',
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
  resetX,
  need,
  h2,
  h3,
  para,
  note,
  bullets,
  callout,
  kvList,
  table,
  writeFooters,
} = bindPdfHelpers(doc);

function shot(title, file) {
  h3(title);
  const p = path.join(ASSETS, file);
  if (!fs.existsSync(p)) {
    note('Capture absente: ' + file);
    return;
  }
  const maxH = 248;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(17).fillColor(DARK).text('Hubera suite — OTA + Notes Keep', LEFT(), doc.y, {
  width: WIDTH(),
});
para(
  '29 septembre 2026 ~19h15 Europe/Paris. Confirmation Maps/Fuel/Music, puis telechargements APK comme Maps (updates.json + /apk + /install) pour Notes, Photos, Drive, Contacts, Agenda, Tasks, Stream. Overlay Samsung + Blackview uniquement. Nothing plus tard. OTA mandatory false. Pas de down -v, packages inchanges.'
);

kvList([
  ['Maps', '0.1.46 vc 48 · ovh.delhomme.maps · fuel.hubera.cloud mix'],
  ['Fuel', '1.4.156 · com.gasoiltracking.app · GPS FGS Samsung+BV'],
  ['Music', 'p+1.3.317 · pas de nouvelle OTA, pas de forceUpdate'],
  ['Notes', '0.1.2 · grille type Google Keep · notes.hubera.cloud/install'],
  ['Tasks', '0.1.2 · listes type Google Tasks · tasks.hubera.cloud/install'],
  ['Drive / Contacts / Agenda / Photos', '1.0.2 / 0.1.2 / 0.1.2 / 1.0.1'],
  ['Pass', '0.1.1 deja en ligne · pass.hubera.cloud/updates.json'],
]);

callout(
  'Telechargement',
  'Chaque produit a maintenant https://<app>.hubera.cloud/updates.json + /apk/hubera-<app>.apk + /install, comme Maps. mandatory: false.'
);

h2('1. Maps / Fuel / Music');
table(
  ['Surface', 'Verdict'],
  [
    ['Maps 0.1.46 mix Fuel', 'OK Samsung + Blackview — peek Fuel, Maison/Travail, disque 30 ou « - »'],
    ['Fuel GPS fond', 'OK — pid Samsung 7520, BV relance 28538, UI Fuel pas au premier plan'],
    ['Music pendant Maps', 'OK BV — Mama Pogo Magyar en pause (state=2), dock Maps, pas de restart ytmusic'],
    ['Music Samsung', 'state=NONE, volume laisse'],
  ],
  [2.2, 1.4]
);
shot('Samsung — Maps + peek Fuel', 'suite-maps-samsung.png');
shot('Blackview — Maps + Fuel + Music pause', 'suite-maps-blackview.png');

h2('2. Notes Keep + Tasks');
para(
  'Notes mobile n etait plus une liste generique : composeur « Prendre une note… », recherche, cartes deux colonnes, pin, archives dans le tiroir. Les notes NoteQA / V sont toujours la. Tasks : libelle Google Tasks, chips de listes, recherche. Compte vide de taches — normal, DB Tasks neuve.'
);
shot('Samsung — Notes Keep', 'suite-notes-samsung.png');
shot('Blackview — Notes Keep', 'suite-notes-blackview.png');
shot('Samsung — Tasks vide', 'suite-tasks-samsung.png');
shot('Blackview — Tasks vide', 'suite-tasks-blackview.png');

h2('3. Drive, Photos, Contacts, Agenda, Pass');
table(
  ['App', 'Smoke'],
  [
    ['Drive 1.0.2', 'OK Samsung — Sans titre.docx encore la'],
    ['Photos 1.0.1', 'OK BV — cloud vide, CTA galerie + sauvegarde (comme Google Photos vide)'],
    ['Contacts 0.1.2', 'OK BV — carnet importe + recherche'],
    ['Agenda 0.1.2', 'OK Samsung — bandeau semaine 29 sept, creer evenement'],
    ['Pass 0.1.1', 'OK Samsung — coffre paul@delhomme.ovh, pas de saisie du maitre'],
  ],
  [1.6, 2.0]
);
shot('Samsung — Drive', 'suite-drive-samsung.png');
shot('Blackview — Photos cloud', 'suite-photos-blackview.png');
shot('Blackview — Contacts', 'suite-contacts-blackview.png');
shot('Samsung — Agenda', 'suite-calendar-samsung.png');
shot('Samsung — Pass coffre', 'suite-pass-samsung.png');

h2('4. Feeds OTA en production');
table(
  ['Host', 'Version / APK'],
  [
    ['notes.hubera.cloud/updates.json', '0.1.2 · sha a5e5cd3c…'],
    ['tasks.hubera.cloud + taskflow.hubera.cloud', '0.1.2 · sha 123b2f13…'],
    ['drive.hubera.cloud', '1.0.2'],
    ['contacts.hubera.cloud', '0.1.2'],
    ['calendar.hubera.cloud', '0.1.2'],
    ['photos.hubera.cloud', '1.0.1'],
    ['pass.hubera.cloud', '0.1.1 (deja)'],
    ['stream.hubera.cloud/updates.json', '0.0.0 · pas d APK (StreamMake encore landing)'],
    ['maps.hubera.cloud', '0.1.46 inchange'],
  ],
  [2.2, 1.4]
);

h2('5. Pas encore / a continuer');
bullets([
  'StreamMake : stream.hubera.cloud/app est encore la landing, pas l outil live. Feed OTA present, APK vide. A brancher le frontend StreamMake sans down -v.',
  'Photos : galerie cloud vide (deja le cas). Onglet Appareil + sauvegarde restent a exercer avec un import reel.',
  'Tasks : zero tache sur le compte — creer des listes/taches et rapprocher Taskflow web si besoin.',
  'Notes Keep : pas encore dessin / images / checklist riche du web Keep. Couleurs, pin, archives, recherche : oui.',
  'Maison recouvre encore le point bleu a l adresse exacte (Samsung). Disque limite parfois « - ».',
  'Nothing : pas d overlay, pas de test. Les feeds /install sont en ligne pour plus tard.',
  'Les APK Drive/Contacts/Agenda/Photos overlayes n ont pas le nouveau client OTA Hubera-host (seulement Notes et Tasks 0.1.2). Le telechargement web /install fonctionne pour tous.',
]);

note('Captures Samsung SM-G990B2 + Blackview BV9700Pro. 29 sept 2026 ~18h57–19h08. Music BV en pause. Nothing exclue.');

const pages = writeFooters('Hubera suite — OTA + Notes Keep');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
