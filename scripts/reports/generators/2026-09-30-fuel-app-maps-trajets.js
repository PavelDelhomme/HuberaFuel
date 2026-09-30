'use strict';
/**
 * 30 sept 2026 ~14h00 — Maps = trajets ; Fuel = l app metier. Jauge 806 = 26 %.
 * ./scripts/reports/run-report.sh generators/2026-09-30-fuel-app-maps-trajets.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Fuel-app-Maps-trajets-2026-09-30.pdf';
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
  info: { Title: 'Hubera — Fuel app / Maps trajets', Author: 'Hubera' },
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
  'Fuel redevient l app. Maps ne fait que le trajet.',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para(
  '30 septembre 2026 ~14h00 Europe/Paris. Samsung + Blackview overlay -r. Nothing : lecture seule (pas d overlay). Volume media 0. OTA Maps mandatory false.'
);

kvList([
  ['Maps', '0.1.54 vc 56 — overlay Samsung+BV, SHA 47f7e9adfbcd2c45'],
  ['Fuel app', '1.4.157 inchangee, com.gasoiltracking.app'],
  ['806 jauge (compte, Nothing)', '26 % = 20,7 L / 80 L. Samsung affichait 52 % (copie locale perimee)'],
]);

h2('1. Repartition');
table(
  ['App', 'Role'],
  [
    ['Hubera Maps', 'Choisir le vehicule, demarrer / pause / arreter le suivi GPS, voir les trajets sur la carte.'],
    ['Hubera Fuel', 'Garage, pleins, budget, conso, jauge. C est l ancienne Gasoil Tracking.'],
  ],
  [1.2, 2.8]
);
para(
  'L onglet Maps s appelle Trajets. Plus de clone Accueil / Pleins / Garage / Budget dans Maps. Le bouton Ouvrir Hubera Fuel lance l app dediee et y reste.'
);
shot('Samsung — onglet Trajets, plus Fuel', 'm54-sam-home.png');
shot('Samsung — demarrer un trajet + ouvrir Fuel, pas de jauge clone', 'm54-sam-trips.png');
shot('Blackview — meme ecran Trajets', 'm54-bv-trips.png');

h2('2. Jauge 806 = 26 % (tu avais raison)');
para(
  'Sur le Nothing, Fuel (ton compte) affiche Peugeot 806 Roland Garros : 20,7 L / 80 L = 26 %. Residuel ~21 L, autonomie ~257 km. Le 52 % vu dans Maps Samsung venait de la base Fuel locale du Samsung, pas du compte a jour. Cloud Fuel bloque au 27 sept (34,1 L / 42,6 %) : la sync n a pas pousse le telephone.'
);
shot('Nothing — Fuel Accueil, jauge 26 %, 53,1 km aujourd hui', 'noth-fuel-home.png');

h2('3. Trajet d aujourd hui (deja dans Fuel sur le Nothing)');
para(
  'Enregistre en GPS Fuel, pas besoin de le recreer : Domicile → Intermarche La Guerche (Fbg de Vitre), aujourd hui 04:13, 53,1 km, 3,9 L, 9,30 EUR, 26 L → 21 L, 4 h 49. Similarites : -5,8 L/100 vs habitude.'
);
shot('Nothing — historique du jour, carte Domicile → La Guerche', 'noth-fuel-today-list.png');

h2('4. Google Maps (verification rapide)');
para(
  'Google Maps sur le Nothing est encore sur « Arrivee a Domicile » (Thorigné-Fouillard, rue Camille Saint-Saens). C est le retour guidage Google, pas le trajet Fuel du matin. Ce retour n est pas dans Fuel. Je ne l invente pas (pas de km / origine dans l ecran Google). Le plein diesel d aujourd hui n est pas dans Fuel : dernier plein app = 21/09/2026 (124,45 EUR, quasi-plein). Si tu as fait le plein a l Intermarche, il faut Nouveau plein dans Hubera Fuel (litres + euros).'
);
shot('Nothing — Google Maps arrivee Domicile', 'noth-gmaps.png');

h2('5. Production');
table(
  ['Host', 'Etat'],
  [
    ['maps.hubera.cloud/updates.json', '0.1.54 vc 56 · sha256 47f7e9adfbcd · mandatory false'],
    ['hubera-maps container', 'Inchange depuis 29 sept 02:01 UTC. docker cp seulement.'],
    ['Fuel cloud paul@delhomme.ovh', 'Toujours updated_at 2026-09-27. Trajet du jour pas sur le serveur.'],
    ['Nothing', 'Pas d overlay. Fuel local a jour. OTA Maps 0.1.54 en ligne si tu l installes.'],
  ],
  [1.6, 2.0]
);

h2('6. Pas encore resolu');
bullets([
  'Sync Fuel cloud bloquee au 27 sept : Samsung / Blackview n ont pas le trajet 53,1 km ni la jauge 26 %.',
  'Retour Google Maps vers Domicile : pas importe dans Fuel (ecran Google sans origine ni km).',
  'Plein diesel du jour : pas dans l app. Dernier plein = 21/09.',
  'Demarrage GPS Maps : hop silencieux ~8 s vers Fuel puis retour Maps.',
  'StreamMake, Notes dessin, Photos cloud, Tasks vides — inchanges.',
]);

callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Fuel com.gasoiltracking.app inchange. Maps debug.keystore 3cf6c532. Overlay -r Samsung+BV seulement. Nothing exclue. OTA jamais mandatory true.'
);

note('Captures 30 sept 2026 13:48-13:56. Nothing A059 lecture seule. Samsung SM-G990B2 + Blackview overlay 0.1.54.');

const pages = writeFooters('Hubera Fuel app / Maps trajets');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  process.exit(1);
});
