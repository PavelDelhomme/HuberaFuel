'use strict';
/**
 * 1 oct 2026 ~16h25 — Maps carte départ/arrivée type Google Maps.
 * ./scripts/reports/run-report.sh generators/2026-10-01-maps-route-io.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Maps-depart-arrivee-2026-10-01.pdf';
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
  info: { Title: 'Hubera Maps depart arrivee Google-like', Author: 'Hubera' },
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
  const maxH = 210;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Maps : points nommes, champs depart / arrivee, inverser.',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '1er octobre 2026 ~16h25 Europe/Paris. Le cadrage entre les deux bouts etait bon. Les pins A/B disaient Depart / Arrivee. Il manquait une carte type Google Maps : depart au-dessus, arrivee en dessous, inversion, noms sous les points.'
);
kvList([
  ['Maps', '0.1.65 vc 66 — SHA cd97dbd51852db17, overlay -r Blackview, mandatory false'],
  ['Samsung', 'ADB wireless tombe (TLS 192.168.1.177:40115 offline). Pas d overlay ce tour. OTA 0.1.65'],
  ['Nothing', 'Present en adb (A059) mais NON overlay : tu l utilises. OTA seulement'],
  ['Conteneur maps', 'hubera-maps inchange depuis 2026-09-29T02:01:09Z (docker cp, pas de recreate)'],
  ['Fuel / Music APK', 'Inchanges'],
]);
h2('1. Carte type Google Maps');
table(
  ['Avant (0.1.64)', 'Maintenant (0.1.65)'],
  [
    ['Pins lettres A / B, labels Depart / Arrivee', 'Points ronds + nom en dessous (Intermarche, Domicile, rue)'],
    ['Titre unique de destination', 'Champ depart (nom + ville) au-dessus du champ arrivee'],
    ['Pas d inversion', 'Bouton inverser ⇅ a droite, comme Google Maps'],
    ['Depart = GPS sans nom', 'GPS → rue (Photon) ou Domicile si on est a la maison'],
  ],
  [2, 2]
);
shot(
  'Blackview — Rue Maurice Ravel / Thorigné-Fouillard → Intermarché, Faubourg de Vitré, La Guerche. Points nommés, zoom A-B.',
  '2026-10-01-bv-route-io.png'
);
h2('2. Comportement');
bullets([
  'Mission lancee sans choisir un depart : le champ du haut prend la position GPS (rue + commune). Si le GPS est sur la maison enregistree : Domicile + adresse.',
  'Arrivee : nom du lieu (Intermarche) et adresse en dessous. Sinon numero + rue.',
  'Tap sur un champ : recherche pour changer ce bout. Tap ⇅ : on inverse les deux et on recalcule.',
  'Le zoom entre les deux points ne change pas. Recherche masquee pendant l itineraires, reapparait a la croix.',
]);
h2('3. OTA');
bullets([
  'maps.hubera.cloud/updates.json = 0.1.65 vc 66, mandatory false, Continuer possible.',
  'APK SHA cd97dbd51852db173aec4b00e350459a5e24c4df91f4f861da27b874a8fdce95',
  'Samsung : a reprendre des que le wireless ADB est revenu. Nothing : a toi, pas touche.',
]);
callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Fuel com.gasoiltracking.app inchange. Maps ovh.delhomme.maps. Overlay -r Blackview seulement ce tour.'
);
note('Capture Blackview 1er oct 2026 ~16h18. Music laisse en lecture (Ich gebe dir mein Wort).');
const pages = writeFooters('Hubera Maps depart arrivee');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => process.exit(1));
