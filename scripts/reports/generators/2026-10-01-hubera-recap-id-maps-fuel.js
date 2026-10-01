'use strict';
/**
 * 1 oct 2026 ~22h20 — Recap compte Hubera ID + Maps Fuel/Music.
 * ./scripts/reports/run-report.sh generators/2026-10-01-hubera-recap-id-maps-fuel.js --mail --to pauldelhomme.pro@gmail.com
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Recap-id-maps-fuel-2026-10-01.pdf';
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
    Title: 'Hubera — compte owner + Maps Fuel/Music 1er octobre 2026',
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

function shot(title, file, maxH) {
  h3(title);
  const p = path.join(ASSETS, file);
  if (!fs.existsSync(p)) {
    note('Capture absente: ' + file);
    return;
  }
  const h = maxH || 210;
  need(h + 16);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), h] });
  doc.y = y0 + h + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera — compte principal + Maps Fuel / Music',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '1er octobre 2026 ~22h20 Europe/Paris. Destinataire: pauldelhomme.pro@gmail.com. Suite des recaps 21h25 et 21h50. Aucun mot de passe, aucun token. Zero copie de donnees, zero docker compose down -v, overlay des memes conteneurs, forceUpdate=false, pas de force-push.'
);

kvList([
  ['Compte owner', 'paul@delhomme.ovh — Hubera ID user id=1. Music c033a13e-…. Fuel 414b3d74-… (sync_data 601 kB intact).'],
  ['Telephones', 'Blackview USB overlay Maps 0.1.68. Nothing A059 wireless overlay Maps 0.1.68, Music deja paul@. Samsung: pas d ADB.'],
  ['Live', 'Music API p+1.3.335 (login Hubera ID si le compte Music existe). Maps web+APK 0.1.68 vc 69 cert 3cf6c532. Fuel dual OTA 1.4.163/1.4.164 inchange cote APK.'],
  ['Conteneurs', 'ytmusic 9f2e04884dad restart. gasoil-tracking-api 7f10a0c0da19 restart. hubera-maps docker cp static+APK. Pas de recreate.'],
]);

h2('1. Verdict');
table(
  ['Statut', 'Quoi'],
  [
    ['VERT', 'Identite: Fuel / Music / Jobs / Cloudity deja lies a paul@. Ajout maps, taskflow, budget, stream (pointeurs, pas de fusion). Alias Music gmail + pro -> meme user.'],
    ['VERT', 'Maps 0.1.68: bouton Ouvrir Hubera Fuel = pastille rouge Hubera. Lance cloud.hubera.fuel (preuve BV: focus MainActivity Fuel Hubera, pas com.gasoiltracking.app).'],
    ['VERT', 'Dock Music: next/prev en pastilles Hubera. Native: session Media3 cloud.hubera.music en premier, plus de KEYCODE_MEDIA_* si connecte (evite double skip).'],
    ['VERT', 'Auth web POST: id/mail/calendar/contacts/photos/drive/pass/notes = 400 JSON (plus 405). Music 401 allowlist email vide. Fuel 400 email requis. Inscription id/mail 400, Fuel 403 invite.'],
    ['VERT', 'Music login: mot de passe Hubera ID accepte seulement si le user Music existe deja — aucune creation silencieuse.'],
    ['ORANGE', 'Garage Maps: nom du vehicule seulement apres snapshot Fuel. Sur BV, Fuel n etait pas connecte -> « snapshot en cours ». API Fuel paul@ login 200. Saisie ADB RN a echoue.'],
    ['ORANGE', 'Nothing: screencap ADB tout noir (wireless). Music last_email=paul@. Flutter suite prefs chiffreess, pas injectees. Taches nginx /auth/login encore 405. Jobs /auth/login 404.'],
    ['ROUGE / REPORT', 'Samsung hors ADB. Jobs APK public 404. iPhone: pas d IPA. Mot de passe Hubera ID absent des .env de seed — Flutter Nothing non force-login ce tour.'],
  ],
  [0.9, 3.1]
);

h2('2. Demande vs livre');
para(
  'Demande: connecter toutes les apps Hubera (Music, Fuel, Maps, Drive, Tasks, Jobs, Cook, Contacts, Calendar, Mail, Pass, Photos, etc.) au compte principal Hubera ID, sans perte de donnees; corriger le bouton Ouvrir Hubera Fuel (design + ouverture); vehicule selectionne du compte visible/selectionnable; next/prev du lecteur Music dans Maps; Nothing = compte owner uniquement; deploy + commit/push; retester inscription/connexion; PDF email.'
);
bullets([
  'Pas de migration de bibliotheques. Les bases Fuel / Music / Cloudity restent chacune chez elles. Le lien est email + identity_app_links.',
  'Fuel API interroge maintenant id.hubera.cloud/auth/login en premier, puis calendar/contacts/mail. Si le mot de passe ID matche, on ouvre le user Fuel deja la (findUserByHuberaIdentity).',
  'Music 1.3.335: meme idee. Si le mot de passe ID est bon ET findUserByEmail trouve un compte, session Music. Sinon 401 — on ne cree pas un 2e user vide.',
  'Maps: FuelBridge.openApp preferNew=true (cloud.hubera.fuel). control() n envoie plus le broadcast aux DEUX packages (l ancien snap vide ecrasait le garage Hubera).',
  'UI Maps: classe hubera-open rouge 999px, chips garage, vehicule actif du snap Fuel par defaut, persistance localStorage, snapshot force a l ouverture de l onglet Fuel.',
  'MusicBridge: MUSIC_PKGS = Hubera puis legacy. next/prev = seekToNext/Previous uniquement si MediaController connecte.',
]);

h2('3. Preuves telephone');
shot('Maps 0.1.68 BV — dock Music (next/prev pastilles Hubera)', '2026-10-01-bv-maps3.png', 230);
shot('Onglet Fuel — bouton rouge Ouvrir Hubera Fuel (plus le ghost gris)', '2026-10-01-bv-maps-fuel.png', 230);
shot('Apres tap: Hubera Fuel (cloud.hubera.fuel) Accueil — pas l ancien package', '2026-10-01-bv-fuel-from-maps.png', 210);
callout(
  'Le garage Maps affiche « Chargement du vehicule de ce compte » tant que Fuel n a pas renvoye le snapshot. Sur ce Blackview Fuel n avait pas de session: Accueil dit « Connectez-vous avec votre compte pour recuperer automatiquement ». Les vehicules du compte paul@ sont bien en prod (sync_data 601 kB). Connexion API 200. La saisie ADB du champ mot de passe React Native n a pas rempli le state JS.'
);

h2('4. Auth / interconnexion (sondes, pas de secrets)');
table(
  ['URL', 'POST vide'],
  [
    ['id.hubera.cloud/auth/login', '400 validation Email/Password (JSON) — plus 405 nginx'],
    ['id.hubera.cloud/auth/register', '400 validation — inscription joignable'],
    ['music /api/auth/login', '401 Acces reserve (allowlist, email vide)'],
    ['fuel /api/auth/login', '400 email et password requis'],
    ['mail/calendar/contacts/photos/drive/pass/notes /auth/login', '400 JSON Hubera ID'],
    ['tasks.hubera.cloud/auth/login', '405 nginx — Flutter tape id.hubera.cloud, pas ce host'],
    ['jobs.hubera.cloud/auth/login', '404 — login Jobs via ID / jobs-api'],
  ],
  [1.6, 2.4]
);
para(
  'Fuel login avec le mot de passe perso du compte (email paul@ ou satellite gmail) -> 200, user Fuel 414b3d74 (le bon, pas un nouveau). Music login seed local paul@ -> 200, meme id c033a13e. Les mots de passe ID seed Admin1234 / Music seed ne sont PAS le mot de passe Hubera ID de production (401 attendu).'
);

h2('5. Versions production apres overlay');
table(
  ['Produit', 'Live'],
  [
    ['Music', 'appVersion p+1.3.335 forceUpdate=false. APK publique toujours p+1.3.332 vc 10632 (pas de force OTA).'],
    ['Maps', 'updates.json 0.1.68 vc 69 package cloud.hubera.maps sha256 df1e3f9e… cert 3cf6c532. APK 5 784 271 o. mandatory=false.'],
    ['Fuel', 'sans hint 1.4.163 com.gasoiltracking.app ; ?clientPackage=cloud.hubera.fuel -> 1.4.164 vc 188. forceUpdate=false.'],
    ['ID', 'sso_forced=false. identity_app_links: budget, cloudity, gasoil, jobbingtrack, maps, stream, taskflow, ytmusic.'],
  ],
  [1.0, 3.0]
);

h2('6. Garde-fous (pour ne plus casser)');
bullets([
  'Jamais down -v. Overlay + restart du MEME id conteneur (preuve: ytmusic 9f2e04884dad, fuel-api 7f10a0c0da19).',
  'Jamais preferer l ancien package Android si cloud.hubera.* est installe (Maps ouvrait Fuel legacy -> garage vide).',
  'Jamais envoyer MAPS_CONTROL aux deux Fuel a la fois (race snap vide).',
  'Jamais KEYCODE_MEDIA_NEXT global si MediaController Music est connecte (double skip / autre app).',
  'Jamais creer un user satellite « pour lier »: seulement login du user existant + alias email.',
  'OTA: mandatory=false / forceUpdate=false. Signature Maps debug 3cf6c532 verifiee apksigner sur 0.1.68.',
  'Ne pas committer .env. Ne pas force-push.',
]);

h2('7. Reste a faire (honnete)');
bullets([
  'Connecter Fuel sur le Blackview (session locale) pour que le nom du vehicule apparaisse dans Maps — les donnees sont deja en prod.',
  'Nothing: verifier visuellement Mail/Drive/Pass (screencap ADB noir). Music deja paul@.',
  'Proxy nginx tasks.hubera.cloud /auth comme id/mail (405). Jobs APK public 404.',
  'Samsung USB des que possible: overlay -r cloud.hubera.maps 0.1.68.',
  'APK Music 1.3.335 non reconstruite (forceUpdate=false, pas de force OTA).',
]);

writeFooters('Hubera ID + Maps Fuel — 1 oct 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024) }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
