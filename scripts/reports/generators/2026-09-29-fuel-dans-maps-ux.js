'use strict';
/**
 * 29 sept 2026 — 10 propositions d integration Fuel dans Maps (brouillon).
 * Pipeline: ./scripts/reports/run-report.sh generators/2026-09-29-fuel-dans-maps-ux.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME =
  process.env.REPORT_OUT || 'Hubera-Fuel-dans-Maps-10-propositions-2026-09-29.pdf';
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
    Title: 'Hubera — Fuel dans Maps, 10 propositions (brouillon)',
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
  const maxH = 268;
  need(maxH + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

const PROPS = [
  {
    n: 1,
    title: 'Categorie Fuel a 4 onglets',
    file: 'fuel-ux-p1.png',
    how: 'Onglets Maps, Fuel, Enregistres, Moi. L onglet Fuel devient l accueil Fuel (jauge, conso, autonomie, FAB Demarrer / Plein) avec sous-onglets Trajets, Pleins, Garage, Budget. Plus de bouton Ouvrir Fuel.',
    mech: 'Le GPS reste dans Fuel en silencieux. Maps affiche tout. Tu ne quittes plus Maps pour un plein ou l historique.',
    cov: 'Garage, pleins, budget, CT, trajets: dans l onglet Fuel. La carte reste l onglet 1.',
    plus: 'Peu de rupture. Tu retrouves Fuel d un tap.',
    minus: 'Deux apps dans une barre. L onglet Fuel n est pas la carte.',
  },
  {
    n: 2,
    title: 'Feuille sous la carte (recommandee)',
    file: 'fuel-ux-p2.png',
    how: 'Plus d onglet Fuel. Une poignee en bas: jauge + km du jour. On tire a mi-hauteur = trajets du jour. On tire a fond = Garage / Pleins / Budget. Pendant un trajet, la feuille devient Pause / Plein / Arreter, colle au dock Music.',
    mech: 'Un geste (glisser) au lieu d un changement d app. Maison / Travail / contacts restent sur la carte. Les pleins se posent comme stations.',
    cov: 'Toutes les fonctions Fuel, empilees dans la feuille, pas dans une 2e application.',
    plus: 'Le plus discret. Conduite et carnet sur le meme ecran. Coherent avec Maps.',
    minus: 'La feuille pleine cache la carte. Il faut hierarchiser jauge vs budget.',
  },
  {
    n: 3,
    title: 'Cinq onglets metier (Fuel absorbe)',
    file: 'fuel-ux-p3.png',
    how: 'Barre: Maps, Trajets, Pleins, Garage, Budget. Enregistres passe dans le tiroir. L icone Fuel du tiroir disparait.',
    mech: 'Chaque ecran Fuel actuel a un onglet. Le suivi GPS s enclenche depuis Maps ou depuis Trajets.',
    cov: 'Couverture 1:1 de Fuel. Rien n est oublie.',
    plus: 'Tout est trouvable. Clair pour un nouvel utilisateur.',
    minus: 'Barre trop chargee avec Music. Maps n est plus une carte, c est un tableau de bord auto.',
  },
  {
    n: 4,
    title: 'Deux modes: Conduite / Carnet',
    file: 'fuel-ux-p4.png',
    how: 'Interrupteur dans la recherche. Conduite = carte + HUD. Carnet = l UI Fuel actuelle sans carte. Un tap pour basculer. Le trajet continue en fond.',
    mech: 'Deux skins, une app. Reversible: on peut laisser l APK Fuel un moment.',
    cov: 'Carnet = copie fidele de Fuel. Conduite = Maps.',
    plus: 'Zero fonction perdue.',
    minus: 'Ca reste deux applications collees. Peu elegant si le mode Carnet est juste Fuel dans Maps.',
  },
  {
    n: 5,
    title: 'Tout est un calque sur la carte',
    file: 'fuel-ux-p5.png',
    how: 'Lignes colorees = trajets. Pompe = plein. Tap sur une ligne = ce matin 43,4 km, moy. similaires 41 km. Budget = pastille du mois pres de la recherche.',
    mech: 'On consulte Fuel en tapant le monde, comme les contacts. Les listes restent en fiche detail.',
    cov: 'Trajets et stations excellents. Garage / CT / exports moins naturels sur une carte.',
    plus: 'Le plus Maps. Compare les trajets Guerche d un coup d oeil.',
    minus: 'Plus long a bien faire. Garage et budget restent des pages.',
  },
  {
    n: 6,
    title: 'FAB pompe + ecrans overlay',
    file: 'fuel-ux-p6.png',
    how: 'FAB bas-droite. Appui long = Demarrer, Plein, Historique, Garage, Budget. Chaque action ouvre une page par-dessus la carte, fermable par X.',
    mech: 'Rien de permanent dans la barre. Fuel n apparait que quand tu t en sers.',
    cov: 'Toutes les pages Fuel en overlay.',
    plus: 'Tres discret au repos. Un geste pour demarrer un suivi.',
    minus: 'CT, budget annuel caches. Facile d oublier qu ils existent.',
  },
  {
    n: 7,
    title: 'HUD conduite d abord',
    file: 'fuel-ux-p7.png',
    how: 'Au repos: petite jauge a cote de l avatar. En trajet: HUD vitesse + litres restants + cout + vs trajets similaires. A l arret: carte recap, puis historique.',
    mech: 'Le carnet (garage, pleins, budget) est dans l avatar / Parametres Fuel. La carte reste roi.',
    cov: 'Le live est parfait. Le metier (CT, exports) est un cran plus loin.',
    plus: 'Ideal sur la route La Guerche. Zero friction pendant le guidage.',
    minus: 'Moins bon pour enregistrer un plein a la maison sans rouler.',
  },
  {
    n: 8,
    title: 'Ecran partage carte + tableau',
    file: 'fuel-ux-p8.png',
    how: 'Haut: carte (~55 %). Bas: jauge, km du jour, 2 derniers trajets, bouton Demarrer. Music reste en dessous.',
    mech: 'Le trace GPS se dessine au-dessus pendant que les km bougent en bas. Comparer un trajet a l habitude sans quitter la vue.',
    cov: 'Dashboard Accueil Fuel visible en permanence. Garage/budget via tap Plus.',
    plus: 'Le plus lisible pour km vs conso.',
    minus: 'Carte trop petite en ville. Beaucoup de chrome avec Music.',
  },
  {
    n: 9,
    title: 'Onglet Fuel = l app Fuel telle quelle',
    file: 'fuel-ux-p9.png',
    how: 'L onglet Fuel embarque l UI actuelle de Fuel (Accueil, Garage, Pleins, Budget) dans Maps. On enleve seulement le hop d application.',
    mech: 'WebView / ecran Fuel recadre. GPS inchange. En 1 version tu as 100 % des fonctions.',
    cov: 'Complete le jour 1, y compris admin, QR, exports.',
    plus: 'Zero oubli fonctionnel. Reversible: on retire l onglet.',
    minus: 'Deux designs colles. Ce n est pas une integration, c est un emboitement.',
  },
  {
    n: 10,
    title: 'Fuel invisible (moteur GPS) + UI 100 % Maps',
    file: 'fuel-ux-p10.png',
    how: 'Visuellement: la feuille de la n 2 + le HUD de la n 7. Techniquement: le package Fuel garde le GPS de fond, SQLite, sync cloud. Maps est la seule UI.',
    mech: 'Les deep links silencieux actuels s etendent a garage/pleins/budget. Si Maps casse, Fuel peut encore s ouvrir. Reversible a 100 %. Package inchange: com.gasoiltracking.app.',
    cov: 'Toutes les fonctions Fuel, affichees par Maps, stockees par Fuel.',
    plus: 'Aucun risque GPS. Pas de rename. Donnees intactes.',
    minus: 'Deux APK a maintenir jusqu a ce que le moteur GPS vive dans Maps — plus tard, pas maintenant.',
  },
];

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1.05);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text('Hubera', LEFT(), doc.y, {
  width: WIDTH(),
});
para(
  '29 septembre 2026, fin d apres-midi (Europe/Paris). Brouillon: 10 facons d integrer completement Hubera Fuel dans Hubera Maps, comme une categorie, sans app a part. Rien n est definitif. L APK Fuel n a pas ete fusionnee, ni renommee, ni supprimee. L APK Maps 0.1.44 n a pas change pour ces maquettes. Galerie interactive: https://maps.hubera.cloud/fuel-ux/  (parametre ?p=1 a ?p=10).'
);
callout(
  'Reponse attendue',
  'Un numero (1 a 10), ou un mix (exemple 2+7+10). Ensuite seulement on code cette piste dans Maps, de facon encore reversible. Owner: paul@delhomme.ovh. Tests toujours Samsung + Blackview, pas de overlay Nothing.',
  ACCENT
);

h2('1. Avis — par quoi partir');
para(
  'Aujourd hui l onglet Trajets Fuel dans Maps n est pas ouf: c est une telecommande (Ouvrir Fuel, Actualiser, Suivi libre, liste courte). Le vrai Fuel (jauge, garage, pleins, budget, CT, trajets reguliers, GPS de fond) vit encore dans l autre application. Le hop Fuel / Maps casse le geste de conduite. Tes trajets Maison -> Intermarche La Guerche sont d abord un objet geographique: ils devraient se lire sur la carte, pas dans une 2e icone.'
);
para(
  'Je recommande de combiner trois pistes, pas d en choisir une seule a l extreme:'
);
bullets([
  'UX quotidienne: n 2 Feuille sous la carte. La carte ne disparait jamais. Fuel se tire comme Google Maps. C est le plus coherent avec Maps, le plus discret, et ca remplace l onglet mort actuel.',
  'UX en roulant: n 7 HUD conduite. Jauge tiny au repos, gros HUD (vitesse, litres, cout, vs similaires Guerche) pendant le trajet, recap a l arret. Ca colle a l usage reel (4h / 7h20 / retour).',
  'Socle technique: n 10 Fuel moteur invisible. On ne tue pas l APK Fuel. Elle garde GPS, SQLite, sync, package com.gasoiltracking.app. Maps devient la seule UI. Si ca casse, on reouvre Fuel. Zero perte de donnees, zero rename, zero down -v.',
]);
para(
  'A eviter en premier jet: n 3 (cinq onglets, Maps n est plus une carte), n 9 seule (emboitement laid, utile seulement comme pont d une version si tu veux tout le jour 1). La n 5 (calques) est la plus belle a long terme mais plus longue a bien faire: on peut l ajouter ensuite, une fois la feuille en place.'
);
para(
  'Reversible: galerie web seulement, pas dans l APK. On peut tout jeter. Quand tu choisis, on n implemente que la piste, derriere un flag si tu veux encore comparer.'
);

h2('2. Inventaire Fuel a reprendre dans Maps');
para(
  'Onglets Fuel actuels: Accueil (jauge, conso, autonomie, depense, distance, FAB trajet/plein), Mon Garage, Pleins (export CSV/PDF), Maps interne Fuel, Budget (lieux, trajets reguliers, prix stations). Ecran Trajet masque: live GPS + historique + similaires. Plus: entretien/CT, notifs bas reservoir, saisie manuelle, import Google Maps, compte, sync cloud.'
);
table(
  ['Dans Maps aujourd hui', 'Encore seulement dans Fuel'],
  [
    ['Suivi libre, pause, stop, plein rapide', 'Garage, physique conso, jauge apprise'],
    ['HUD km, historique compact, similaires', 'Pleins detailles + export CSV/PDF'],
    ['Chips Maison/Travail/Stations', 'Budget, lieux Fuel, trajets reguliers'],
    ['Pont silencieux HuberaFuel.control', 'Entretien/CT + notifs, FGS GPS, sync SQLite'],
  ]
);
note(
  'Fusionner l UI ne veut pas dire tuer le moteur. Le GPS de fond Android (FGS) dans Fuel est ce qui a permis le suivi pendant que Maps etait casse ce matin. On le garde.'
);

h2('3. Mecanique ciblee (mix 2 + 7 + 10)');
h3('Au repos');
para(
  'Carte Maps pleine. Poignee Fuel: jauge + km du jour. Contacts, maison, travail restent des icones. Pas d onglet Fuel. Music inchange.'
);
h3('En roulant');
para(
  'La feuille devient HUD: vitesse, litres restants, cout, ecart vs trajets similaires Guerche. Pause / Plein / Arreter colles au dock Music. Le GPS tourne dans Fuel sans ecran Fuel. Le guidage Maps et le suivi Fuel ne se marchent plus dessus.'
);
h3('Apres le trajet');
para(
  'Carte recap quelques secondes (km vs moyenne), puis la ligne rejoint l historique dans la feuille. Un plein peut se lier au trajet. Plus de hop vers l app Fuel.'
);
h3('Carnet');
para(
  'Feuille tiree a fond, ou avatar: garage, CT, budget, exports. Les ecritures vont dans la base Fuel existante. L icone Fuel peut disparaitre du tiroir Maps, l APK peut rester installee et cachee.'
);

h2('4. Mix 2+7+10 — ce qui est sur les telephones (dev, pas OTA)');
para(
  'Maps 0.1.45 overlay Samsung + Blackview seulement. Le feed prod reste 0.1.44: pas de mise a jour forcee. En bas: barre DEV + bouton Comparer. Au repos: feuille Fuel (jauge + km). Enregistres reste. L onglet Fuel ouvre la feuille, il n ouvre plus l app Fuel. GPS + SQLite restent dans Fuel. Point bleu + halo pour ta position, maison decalee si tu es dessus, libelles complets au zoom.'
);
shot('Mix 2+7+10 — trois etats (repos / conduite / carnet)', 'fuel-ux-p11.png');
shot('Samsung 0.1.45 dev (barre Comparer en bas)', 'fuel-ux-samsung-dev.png');
para(
  'Parametres -> Comparer Fuel (dev), ou le bouton Comparer, pour passer a Actuel, 1, 2, ... 10. Dis ce que tu gardes de chaque piste.'
);

h2('5. Les 10 propositions (captures + detail)');
for (const p of PROPS) {
  h2('Proposition ' + p.n + ' — ' + p.title);
  para('Comment ca marche. ' + p.how);
  para('Mecanique. ' + p.mech);
  para('Fonctions Fuel. ' + p.cov);
  para('Pour. ' + p.plus + ' Contre. ' + p.minus);
  shot('Maquettes (3 ecrans): carte, coeur Fuel, autre ecran', p.file);
}

h2('6. Ce qui n a pas change');
bullets([
  'APK Fuel: package com.gasoiltracking.app inchange, GPS + SQLite conserves.',
  'Maps 0.1.45 overlay Samsung + Blackview seulement. Feed OTA prod toujours 0.1.44.',
  'Galerie: https://maps.hubera.cloud/fuel-ux/?p=11 (mix) et ?p=1 a 10.',
  'Aucun docker compose down -v. Aucun overlay Nothing. Aucun forceUpdate Music.',
]);

h2('7. Comment te repondre');
para(
  'Sur le telephone: barre DEV -> Comparer, ou Parametres -> Comparer Fuel. Teste le mix, puis les autres. Reponds avec ce que tu gardes (ex. feuille oui, 5 onglets non). Samsung et Blackview, pas la Nothing.'
);

const pages = writeFooters('Hubera — Fuel dans Maps, 10 propositions 29 sept 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
