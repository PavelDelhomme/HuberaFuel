'use strict';
/**
 * 30 sept 2026 ~18h50 — ecran blanc Fuel corrige ; plein diesel + km dans le cloud.
 * ./scripts/reports/run-report.sh generators/2026-09-30-fuel-ecran-blanc-cloud.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Fuel-ecran-blanc-cloud-2026-09-30.pdf';
const outDir = process.env.REPORT_DIR
  ? process.env.REPORT_DIR
  : path.join(__dirname, '../../../dist/reports');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, OUT_NAME);
const ASSETS = path.join(__dirname, '../assets');

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 40, bottom: 46, left: 40, right: 40 },
  bufferPages: true,
  autoFirstPage: true,
  info: { Title: 'Hubera — Fuel ecran blanc + cloud', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);

const { ACCENT, DARK, LEFT, WIDTH, resetX, need, h2, h3, para, note, bullets, callout, kvList, table, writeFooters } =
  bindPdfHelpers(doc);

function shot(title, file) {
  h3(title);
  const p = path.join(ASSETS, file);
  if (!fs.existsSync(p)) {
    note('Capture absente: ' + file);
    return;
  }
  const maxH = 228;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Fuel affiche l Accueil. Le plein et les km sont dans le cloud.',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para(
  '30 septembre 2026 ~18h50 Europe/Paris. Samsung + Blackview overlay -r. Nothing : pas d overlay, plus connecte. Volume media 0. OTA jamais forcee.'
);

kvList([
  ['Fuel', '1.4.158 vc 182 — SHA f5a71145e1888eef, forceUpdate=0'],
  ['Maps', '0.1.55 vc 56 — SHA 6d29b291f5976f12, mandatory false'],
  ['Compte', 'paul@delhomme.ovh — 103 trajets, 3964,8 km, 806 a 80 L'],
]);

h2('1. Ce qui cassait (ecran blanc partout)');
para(
  'Quand Maps parlait a Fuel en silencieux (snapshot GPS), l app Fuel restait lancee sur l URL gasoiltracking://trip/control?silent=1. Au prochain « Ouvrir Hubera Fuel » (ou icone launcher), Android renvoyait cette meme tache : ecran transparent / blanc, sur Samsung, Blackview et Nothing.'
);
table(
  ['Correctif', 'Detail'],
  [
    ['Fuel 1.4.158', 'MainActivity remplace l Intent silent par MAIN/LAUNCHER. trip/control redirige vers Accueil.'],
    ['Maps 0.1.55', 'openApp() : NEW_TASK + CLEAR_TASK + CLEAR_TOP, pour ouvrir l Accueil pas le residual silent.'],
  ],
  [1.3, 2.7]
);
shot('Samsung — Maps Trajets, bouton Ouvrir Hubera Fuel', 'sam-maps-trips-ok.png');
shot('Samsung — Accueil Fuel apres Ouvrir Hubera Fuel (plus blanc)', 'sam-from-maps-ok.png');
shot('Blackview — meme Accueil depuis Maps (copie locale encore a 0 % avant sync)', 'bv-from-maps-ok.png');

h2('2. Plein diesel + kilometres (cloud, puis telephones)');
para(
  'Le Nothing n etant plus branche, la source de verite est le cloud paul@delhomme.ovh. Snapshot updated_at 2026-09-30T16:28:36Z. Rien n a ete ecrase par Samsung/BV : ils ont tire, pas pousse.'
);
table(
  ['Donnee', 'Valeur'],
  [
    ['Trajet du matin', 'Domicile → Intermarche La Guerche, 04:13–09:02, 53,1 km'],
    ['Plein diesel', '59,3 L × 1,759 EUR/L = 104,31 EUR, plein, 16:30'],
    ['Jauge 806', '80,0 L / 80 L = 100 %, autonomie ~993 km'],
    ['Historique', '103 trajets, 3964,8 km au total, 11 pleins'],
  ],
  [1.4, 2.6]
);
para(
  'Les litres et le prix du plein sont estimes : 21 L restants sur Nothing → 59,3 L pour remplir 80 L, prix 1,759 EUR/L. Si le ticket Intermarche dit autre chose, on corrigera le plein dans Fuel (sans toucher aux km).'
);
shot('Samsung — Accueil apres pull cloud : 100 %, 53,1 km aujourd hui', 'sam-fuel-cloud.png');
shot('Samsung — Pleins : aujourd hui 104,31 EUR, 59,30 L', 'sam-fuel-pleins.png');
shot('Blackview — meme Accueil cloud (100 %, 53,1 km)', 'bv-fuel-cloud.png');

h2('3. Production');
table(
  ['Host', 'Etat'],
  [
    ['Fuel APK', '1.4.158 vc 182 · sha256 f5a71145e1888eef · forceUpdate 0'],
    ['maps.hubera.cloud/updates.json', '0.1.55 vc 56 · sha256 6d29b291f5976f12 · mandatory false'],
    ['hubera-maps container', 'Inchange depuis 29 sept 02:01 UTC. docker cp seulement.'],
    ['Fuel cloud', 'paul@delhomme.ovh, 16:28Z, 103 trajets + plein du jour'],
    ['Nothing', 'Pas d overlay. OTA en ligne. Local Nothing peut encore afficher 26 % tant qu il n a pas tire.'],
  ],
  [1.6, 2.0]
);

h2('4. Pas encore resolu');
bullets([
  'Nothing deconnecte : sa copie locale (26 %) n a pas recu le pull. Quand tu le rebranches, Actualiser depuis le cloud — ne pas « Pousser cet appareil » sinon ca peut ecraser le plein 100 %.',
  'Litres / prix du plein : estimes, pas lus sur un ticket. Km 53,1 et historique 3964,8 km sont ceux de Fuel.',
  'Hop GPS Maps → Fuel silencieux ~8 s puis retour carte : inchange.',
  'StreamMake, Notes dessin, Photos cloud, Tasks vides — inchanges.',
]);

callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Fuel com.gasoiltracking.app inchange. Overlay -r Samsung+BV seulement. Nothing exclue. OTA jamais mandatory / forceUpdate true.'
);

note('Captures 30 sept 2026 18:33-18:47. Samsung SM-G990B2 + Blackview overlay 1.4.158 / 0.1.55.');

const pages = writeFooters('Hubera Fuel ecran blanc / cloud');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => {
  process.exit(1);
});
