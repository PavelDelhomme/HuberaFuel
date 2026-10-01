'use strict';
/**
 * 1 oct 2026 ~16h00 — Maps guidage type Google Maps + logo Fuel + batterie.
 * ./scripts/reports/run-report.sh generators/2026-10-01-maps-nav-fpv.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Maps-guidage-FPV-2026-10-01.pdf';
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
  info: { Title: 'Hubera Maps guidage premiere personne', Author: 'Hubera' },
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
  'Maps : guidage premiere personne, panneaux, logo Fuel, POI.',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '1er octobre 2026 ~16h00 Europe/Paris. Le HUD disait En bout de voie a droite Rue du Guesclin, Puis en trop, barre Trajet Fuel, carte a plat, et la croix du guidage laissait Fuel tourner. Alignement sur Google Maps, avec nos specifics Fuel / Music.'
);
kvList([
  ['Maps', '0.1.64 vc 65 — SHA f6fb68e5e8db3184, overlay -r Samsung+BV, mandatory false'],
  ['Fuel APK', '1.4.163 inchange (forceUpdate=0). Source GPS 5 s / 16 m prete, pas de rebuild Fuel ce tour'],
  ['Music APK', 'p+1.3.323 inchange. Dock Maps poll 2,0 s / pont 2,5 s (avant 0,8 s / 1 s)'],
  ['Conteneur maps', 'hubera-maps inchange depuis 2026-09-29T02:01:09Z (docker cp, pas de recreate)'],
  ['Nothing', 'Pas dans adb ce tour. OTA maps.hubera.cloud/updates.json 0.1.64'],
]);
h2('1. Guidage comme Google Maps');
para(
  'Des Démarrer : carte inclinee (vue 1re personne), cap devant, zoom 17-18, puck en bas. HUD : distance + icone + nom de rue. Le Puis compact remplace la phrase OSRM En bout de voie a droite. Panneau 30 + ZONE 30 en haut a droite.'
);
table(
  ['Avant', 'Maintenant'],
  [
    ['Carte a plat, cadrage A-B pendant le trajet', 'Vue inclinee cap devant des le demarrage'],
    ['En bout de voie, a droite · Rue du Guesclin', 'Rue du Guesclin + Puis Rue Rene Jean Mailleux'],
    ['Barre Trajet Fuel Pause/Arreter/Plein', 'Logo Fuel en bas, tap = Pause / Arreter / Plein'],
    ['X = fermer le guidage, Fuel continue', 'X arrete guidage et Fuel. Tu restes dans Maps'],
  ],
  [2, 2]
);
shot('Samsung — 250 m, Rue du Guesclin, Puis, ZONE 30, logo Fuel, carte 3D', '2026-10-01-sam-nav-fpv.png');
shot('Blackview — meme HUD et panneau zone', '2026-10-01-bv-nav-fpv.png');
shot('Samsung — logo Fuel ouvert : Pause, Arreter, Plein', '2026-10-01-sam-fuel-logo.png');
shot('Samsung — Arreter : Trajet termine, Maps reste, plus de HUD Fuel', '2026-10-01-sam-fuel-stop.png');
h2('2. Villes, POI, pins perso');
bullets([
  'Noms de villes OSM selon le zoom : city gros des z6, town z9, village z12 ; masques a z16 (rues OSM).',
  'POI visibles selon le zoom : stations z14, pharmacies z14, supermarches z15, DAB z16.',
  'Clic POI : fiche nom / horaires OSM / carburant OSM si tague, bouton Itineraire.',
  'Cache local 18 min (telephone) + proxy maps.hubera.cloud/overpass. Pas de nouveau conteneur.',
  'Maison / Travail / contacts : pastilles plus petites (28 px / 22 px).',
]);
h2('3. Batterie — Maps, Music, Fuel');
para(
  'Analyse a chaud (pas de dumpsys batterystats long). Trois pompes GPS / reseau en parallele quand tu roules avec Music.'
);
table(
  ['App', 'Ce qui tirait', 'Change maintenant / conseil'],
  [
    [
      'Maps',
      'GPS idle 55 s + Overpass 8 s + dock Music 0,8 s + tuiles',
      'Idle 90 s, Overpass 12 s, dock 2 s, POI pas a chaque GPS en guidage',
    ],
    [
      'Fuel',
      'FGS High 4 s / 12 m + watch premier plan 4 s. Double GPS si Maps guide aussi',
      'Source prete 5 s / 16 m. APK Fuel non rebuild ce tour pour ne pas te forcer une 2e MAJ',
    ],
    [
      'Music',
      'WAKE_MODE_NETWORK + FGS lecture (normal) + lyrics UI 48-90 ms',
      'BatterySaver deja la. Pas touche a la lecture. Maps interroge moins le dock',
    ],
  ],
  [1, 2, 2]
);
para(
  'Le vrai cout quand tu roules : GPS Fuel (trajet) + GPS Maps (camera) + radios Music. On n a pas coupe le GPS Fuel : les km resteraient faux. Maps s arrete deja quand l ecran s eteint ; Fuel continue en fond, c est voulu.'
);
h2('4. OTA');
bullets([
  'maps.hubera.cloud/updates.json = 0.1.64 vc 65, mandatory false, Continuer possible.',
  'APK SHA f6fb68e5e8db3184aa4c71844071bd5d75ea9789631b5ddde527347c39b2fbff',
  'Nothing : pas d overlay (absent d adb). Recuperer via Continuer / install.',
]);
callout(
  'Volumes / packages',
  'Aucun docker compose down -v. Fuel com.gasoiltracking.app inchange. Maps ovh.delhomme.maps. Overlay -r Samsung+BV. Logo Fuel desactivable dans Parametres.'
);
note('Captures 1er oct 2026 ~15h53-15h55. Music laisse en lecture (Samsung Les anges de l oubli / BV Ich gebe dir mein Wort).');
const pages = writeFooters('Hubera Maps guidage FPV');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', () => process.exit(1));
