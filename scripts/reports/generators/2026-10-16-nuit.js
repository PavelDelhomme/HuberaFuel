'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-16-nuit.pdf';
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
  info: { Title: 'Hubera — lot de nuit 16 oct 2026', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, h2, h3, para, note, bullets, callout, kvList, table, writeFooters } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera — lot de nuit, 16 octobre 2026',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para('Faits du lot de nuit, tels que constatés. Rien n’a été ouvert sur le Nothing. Pas de son, pas de nouveau build, pas d’install sur le Nothing.');

callout(
  'Encore ouvert',
  'Le VPS seul ne sort pas les titres YouTube bloqués. Le tunnel maison doit rester up. Aucune APK bêta. Jobs non déployé. Le Nothing sera mis à jour par Paul depuis la prod. La grille métier longue reste à jouer.',
  ACCENT,
);

kvList([
  ['Date', '16 octobre 2026, lot de nuit'],
  ['Téléphones', 'Samsung R5CT7263YJL et Blackview EEA9700PRO0014587. Nothing absent de l’ADB'],
  ['Mail', '1.0.23, code 24. Install -r sur le Samsung seulement. Legacy 1.0.11'],
  ['Music', '1.3.372, canal prod, image locale ytmusic:search-durable, même volume'],
  ['Docs', 'Live ca8108e, anonyme 0.2.20 / 220, non forcé'],
  ['Fuel', 'Paquet Hubera 1.4.178 / 202. Anonyme API vu en 1.4.177 / 201'],
  ['Jobs', 'Non déployé. Verrou sur origin/dev seulement'],
]);

h2('1. Mail');
para('Les 3 boîtes (Candidatures, Dev, Perso OVH, ids 4, 3, 2, imap_auth_ready vrai) sont sur l’API pour le compte propriétaire. GET /mail/me/accounts les renvoie dans la forme que l’app parse. Le mobile n’en retire aucune si le secret IMAP n’est pas dans le téléphone.');
para('Le Samsung est connecté au compte labo Hubera ID : la même route renvoie []. D’où « Aucune boîte reliée ». Ce n’était pas un filtre local. Les 3 boîtes n’apparaîtront sur un téléphone que si Mail y est ouvert avec le compte propriétaire. Elles n’ont pas été copiées sur le compte labo.');
kvList([
  ['Version', 'Mail 1.0.23, code 24'],
  ['Commit app', 'b7bb27b'],
  ['Manifeste git', '5ee2939d6ad87806526ad9220e6ab4d36e140a40'],
  ['Écran', 'Vide, tiroir et avatar : adresse du compte connecté, lue au runtime, sans adresse en dur'],
  ['Flux', 'mail.hubera.cloud/updates.json : 1.0.23 / 24'],
  ['OTA', 'apkAvailable true pour un client 1.0.22. forceUpdate false. mandatory false. APK PK 504b0304'],
  ['Install', '-r sur le Samsung seulement. Legacy fr.cloudity.cloudity_mail reste en 1.0.11. Nothing non touché'],
]);

h2('2. Music');
para('YouTube bloque l’IP du VPS (LOGIN_REQUIRED, « Sign in to confirm you\'re not a bot ») même avec les cookies qui marchent depuis la maison. La passe MWEB itag 250 est dans le code, avant le balayage quotidien. ANDROID 251 et ANDROID_VR 139 n’ont pas donné d’URL depuis le VPS.');
para('Tunnel maison démarré (script déjà prévu, ALLOW_STREAM_UPSTREAM=1). Aucun proxy gratuit.');
para('L’API téléphone GET /api/stream/Bo644plDuYM, Range 64 octets : HTTP 206, audio/webm, en-tête X-YTM-Stream-Via: home. Pas de lecture, pas de son.');
h3('Correctif du relais');
bullets([
  'La maison répondait après environ 28 s. Réponse immédiate : commit 50edcd9cc11df74f72af249497967e0008011d8c.',
  'Fichier api/src/media/stream.ts, branche feat/music-drawer-open-native.',
  'Image locale ytmusic:search-durable reconstruite. Conteneur recréé sur le même volume ytmusic_ytmusic_data.',
  'En-tête cookies toujours 6126 octets. Pas de pull GHCR.',
  'GET /api/version : 1.3.372, canal prod, forceUpdate false, mandatory false.',
  'Le tunnel doit rester up : s’il tombe, le VPS est de nouveau bloqué par YouTube.',
  'Recherche durable et verrou bêta Music étaient déjà dans cette image.',
  'HUBERA_BETA_EMAILS n’est pas définie. Aucune APK bêta publiée. Un non-bêta qui demande channel=beta reçoit 404.',
]);
note('L’image GHCR ytmusic:latest du 6 octobre ne contient ni la recherche, ni la bêta, ni le relais. La prod tourne sur l’image locale. Ne pas la remplacer par GHCR.');

h2('3. Bêta, APK, cold start');
h3('Docs et Fuel');
bullets([
  'Docs live ca8108e : anonyme 0.2.20 / 220, apkAvailable true, non forcé. channel=beta sans compte = 404. Volume intact. Page d’accueil toujours le site.',
  'Fuel : paquet Hubera resté en 1.4.178 / code 202 sur fuel.hubera.cloud et gasoil-tracking.delhomme.ovh.',
  'L’anonyme côté API Fuel a été vu en 1.4.177 / 201. channel=beta sans compte = 404, forceUpdate false.',
  'Volume gasoil_api_data intact. Rien restauré.',
]);
h3('Jobs');
para('Jobs n’est pas déployé. Le verrou est sur origin/dev (d017e696). La prod Portainer est un checkout détaché 0c5d358, modifications locales, conteneurs depuis le 19 septembre. Tirer dev aurait tout déversé. Pas de merge.');
h3('OTA publiques non gatées');
para('Apps à updates.json public non gatées, sinon les autres utilisateurs perdaient les mises à jour : Mail, Notes, Photos, Drive, Calendar, Contacts, Tasks, Pass, Cook, ID, Maps, Admin.');
h3('APK prod, install -r, cold start');
para('APK prod publiées, PK, non forcées. Install -r sur le Samsung R5CT7263YJL et le Blackview EEA9700PRO0014587. Cold start am start -W -S. Pas de son. Mail non relancé dans cette passe. Nothing absent de l’ADB. Tous LaunchState COLD, install Success.');
table(
  ['App', 'Version / code', 'Samsung', 'Blackview'],
  [
    ['Notes (notes.hubera.cloud)', '0.1.14 / 15', '1516 ms', '670 ms'],
    ['Photos', '1.0.16 / 17', '677 ms', '702 ms'],
    ['Drive', '1.0.13 / 14', '554 ms', '486 ms'],
    ['Pass', '0.1.8 / 9', '786 ms', '685 ms'],
    ['Tasks', '0.1.7 / 8', '683 ms', '825 ms'],
    ['Agenda', '0.1.16 / 17', '400 ms', '810 ms'],
    ['Contacts', '0.1.11 / 12', '344 ms', '426 ms'],
    ['Cook', '0.1.9 / 10', '342 ms', '382 ms'],
    ['Admin (cloudity.delhomme.ovh)', '0.1.8 / 9', '492 ms', '682 ms'],
  ],
  [1.7, 1.1, 0.8, 0.9],
);

h2('4. Comportement vu');
bullets([
  'Premier frame Mail, Notes, Photos, Drive : le cache est peint avant le réseau.',
  'Photos : retour ferme la sélection ou l’album et revient à la bibliothèque.',
  'Tasks : un filtre ou une recherche se ferme avant de quitter l’accueil (module partagé Cloudity tasksFilterBack).',
  'Pass : la liste du coffre ne quitte pas l’app. Un coffre vide peut créer un login.',
  'Calendar et Contacts non redessinés. Pas de changement visuel Music, Maps, Fuel.',
]);
para('Compagnons Cloudity onConsumeBack et openHuberaIdInstall : commit 44502aaf sur chore/restructure-platform. Bump Tasks 0.1.7, Cook 0.1.9, Admin 0.1.8 : aa6e06e5. Le commit 3e3a76ec seul ne compilait pas.');

h2('5. Manifestes git alignés');
table(
  ['App', 'Manifeste'],
  [
    ['Notes', 'b5b4593'],
    ['Photos', '9160760'],
    ['Drive', 'e098998'],
    ['Pass', 'a41d31e'],
    ['Agenda', '644a4d8'],
    ['Contacts', '4d1f6bd'],
    ['Tasks', 'c4b8b0e'],
    ['Cook', '9907004'],
    ['Admin', 'Pas de updates.json versionné'],
  ],
  [1.2, 2.4],
);

h2('6. Commits déjà poussés (ne pas les refaire)');
table(
  ['Dépôt', 'Commits'],
  [
    ['HuberaDocs', 'ca8108e'],
    ['HuberaFuel', 'beb0efd'],
    ['HuberaJobs', 'd017e696 (dev seulement)'],
    ['HuberaMusic', '12a8bfb puis 50edcd9 (feat/music-drawer-open-native)'],
    ['Cloudity', '3e3a76ec puis 44502aaf et aa6e06e5'],
    ['HuberaMail', '1ff4407, b7bb27b, 5ee2939'],
    ['HuberaNotes', '1f44fff'],
    ['HuberaDrive', 'd7ab1cb'],
    ['HuberaPhotos', '557809a'],
    ['HuberaPass', '122e284'],
  ],
  [1.2, 2.8],
);

h2('7. Encore ouvert');
bullets([
  'Nothing non mis à jour : Paul le fera depuis la prod. Rien n’a été ouvert dessus cette nuit.',
  'Jobs : verrou bêta pas en prod.',
  'Aucune APK bêta. HUBERA_BETA_EMAILS vide : un bêta ne télécharge pas une bêta, et un non-bêta non plus. Le test « compte bêta télécharge la bêta » n’a pas pu être fait.',
  'Music : le VPS seul ne sort pas les titres bloqués. Ça marche tant que le tunnel maison tourne.',
  'Grille métier longue : gestes Mail (répondre, transférer, brouillons) impossibles sur le Samsung tant qu’il est sur le compte labo ; guidage Maps ; plein Fuel ; lecture Music sur un téléphone (interdite cette nuit, pas de son).',
  'Image GHCR ytmusic:latest du 6 octobre : ne pas remplacer l’image locale ytmusic:search-durable.',
]);

h2('8. Kanban');
para('Faites : Mail 1.0.23 (adresse du compte connecté), OTA suite (cold start Samsung et Blackview), verrou bêta Docs et Fuel, relais Music. Ouvertes : Jobs non déployé, APK bêta absente, Nothing à mettre à jour par Paul, grille métier longue.');
note('Aucun secret, cookie, jeton, mot de passe, ni URL de flux avec jeton dans ce PDF.');

const pages = writeFooters('Hubera — lot de nuit 16 oct 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
