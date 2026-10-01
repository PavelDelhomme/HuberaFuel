'use strict';
/**
 * 1 oct 2026 ~21h25 — Recap complet Hubera Cloud (prod, signatures, tests).
 * ./scripts/reports/run-report.sh generators/2026-10-01-hubera-recap-prod-complet.js --mail --to pauldelhomme.pro@gmail.com
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Recap-prod-complet-2026-10-01.pdf';
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
    Title: 'Hubera Cloud — recap production 1er octobre 2026',
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
  'Hubera Cloud — recap production complet',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '1er octobre 2026 ~21h25 Europe/Paris. Destinataire: pauldelhomme.pro@gmail.com. Ce PDF resume ce qui a ete deploye aujourd hui, ce qui marche, ce qui ne marche pas, les mecanismes techniques (OTA, signatures, packages), les tests, et comment on evite de recasser l install Android. Aucun mot de passe, aucun token.'
);

kvList([
  ['Perimetre telephones', 'Blackview BV9700Pro USB (tests + install -r). Samsung Wi-Fi ADB offline. Nothing: non touche (owner). Volume media = 0.'],
  ['Regle ops', 'Jamais docker compose down -v. Overlay -r. forceUpdate=false / mandatory=false. Pas de force-push. Pas de commit .env.'],
  ['Owner', 'paul@delhomme.ovh (Hubera ID). Music/PLM admin = meme identite via dev@delhomme.ovh. QA lab: qa.lab@maily.ovh (galerie vide attendue).'],
  ['Music live', 'Web p+1.3.333, APK p+1.3.332 vc 10632, forceUpdate=false'],
  ['Fuel live', 'APK cloud.hubera.fuel 1.4.164 vc 188 (EAS). API /version sans hint: 1.4.163 legacy.'],
  ['Maps live', 'cloud.hubera.maps 0.1.67 vc 68, updates.json aligne'],
]);

h2('1. Verdict en une page');
table(
  ['Statut', 'Quoi'],
  [
    ['VERT', 'Tous les * .hubera.cloud HTTPS 200. ID POST /auth/login JSON (plus 405). Fuel QA 1 vehicule / 4 trajets. Photos QA timeline vide. Launch BV 11 apps cloud.hubera.*.'],
    ['VERT', 'APK prod installables: adb install -r depuis le site = Success x12 sur Blackview (meme signature que l app deja installee).'],
    ['VERT', 'Fuel vitest 146/146. Canal OTA Fuel separe par package (plus d APK Hubera colle sur com.gasoiltracking.app).'],
    ['ORANGE', 'Samsung: ping OK, ADB TLS wireless offline — pas d overlay ce soir. Brancher USB, sans adb kill-server.'],
    ['ORANGE', 'Bandeau Music "Serveur en p+..." corrige (1.3.333 SW). Stream 502 innertube sous charge. STREAM_UPSTREAM offline = normal (PC maison).'],
    ['ROUGE / REPORT', 'Jobs APK public 404. iPhone: pas d IPA depuis Linux (EAS/TestFlight). Nothing: tests owner. SSO ID encore ask, nginx ID ne proxy que /auth et /photos.'],
  ],
  [0.9, 3.1]
);

h2('2. Le probleme de signature (et pourquoi ca n arrivera plus)');
para(
  'Android n accepte une mise a jour que si (1) le nom de package est identique et (2) le certificat de signature est identique. Aujourd hui deux familles coexistent sur les telephones owner: anciens ids (fr.cloudity.*, ovh.delhomme.*, com.gasoiltracking.app) et nouveaux ids (cloud.hubera.*). Les deux familles sont signees, mais ce sont DEUX applications differentes. Coller un APK cloud.hubera.photos sur une install fr.cloudity.cloudity_photos = INSTALL_FAILED_UPDATE_INCOMPATIBLE. C etait la source des echecs "signature / package non valide".'
);
table(
  ['Famille', 'Certificat SHA-256', 'Usage'],
  [
    ['Suite Maps/Music/Flutter/Jobs', '3cf6c5321da1517e79940c9e25514a639b2c449e3eff7df7476876cbf6f4c11f (Android Debug)', 'Deja sur BV. Les APK prod doivent rester cette cle tant que ces installs existent.'],
    ['Fuel (EAS)', '13c3be90a99fb1a9... (keystore EAS)', 'cloud.hubera.fuel ET com.gasoiltracking.app. Ne jamais signer Fuel avec le debug.keystore.'],
  ],
  [1.1, 1.6, 1.3]
);
para(
  'Mecanisme deploye ce soir: deux canaux. (A) Page /install = APK canonical cloud.hubera.* pour les camarades et les nouvelles installs. (B) updates.json Flutter = encore la version LEGACY + fichier /apk/legacy/ pour ne pas proposer un binaire du mauvais package aux anciennes apps. Bloc JSON "canonical" pour le prochain client OTA. Fuel: GET /api/version?clientPackage=cloud.hubera.fuel sert 1.4.164; sans hint sert 1.4.163. Music: ticket public /api/install/apk-ticket ajoute package=cloud.hubera.music (avant, le ticket sans query retombait sur ytmusic.apk legacy).'
);
callout(
  'Garde-fous code',
  'Fuel assertApkIdentity refuse un APK dont le package != attendu (vitest 146). pickLatestRelease filtre par package_name (test: Hubera ne fuit pas vers gasoiltracking). OTA Dart: si package du feed != package installe, on ignore (ou on prend canonical). Maps InAppUpdate.kt: meme garde. Ces gardes Dart/Kotlin seront actives au prochain rebuild; les feeds actuels ne poussent deja plus le mauvais binaire.'
);

h2('3. Ce qui marche — matrice produits');
table(
  ['Produit', 'Web / API', 'Android BV', 'Install camarades'],
  [
    ['www hubera.cloud', '200 catalogue', 'navigateur', 'site'],
    ['Music', 'p+1.3.333 health, search 401 sans session, ticket APK public', 'cloud.hubera.music + ovh.delhomme.ytmusic p+1.3.332', 'music.hubera.cloud/install'],
    ['Fuel', 'health ok, QA login, /api/maps/vehicles=1 trips=4', '1.4.164 vc 188 + legacy 1.4.163', 'fuel.hubera.cloud/install -> 1.4.164'],
    ['Maps', 'itineraire OSRM walk Cesson-Rennes 200, updates 0.1.67', '0.1.67 vc 68 dual package', 'maps.hubera.cloud/install'],
    ['ID', 'sso_forced=false, login 401 JSON faux mdp, /auth et /photos proxies', 'pas d APK ID', 'id.hubera.cloud'],
    ['Photos', 'timeline QA items=[], health healthy', '1.0.6 cloud.hubera.photos', 'photos.hubera.cloud/install'],
    ['Mail / Drive / Calendar / Contacts / Notes / Tasks / Pass / Cook', 'SPA 200, listes QA vides', 'versions BV canonical, install -r Success', '/install de chaque host'],
    ['Jobs', 'jobs-api health 200, app 1.0.57 sur BV', 'launch OK', 'APK public 404 — rester sur overlay'],
    ['Press / Budget / Stream / Office / VTC', 'landings 200', 'N/A ou stub', 'pas d APK metier'],
  ],
  [1.15, 1.35, 1.1, 0.9]
);

h2('4. Tests executes aujourd hui (avant et apres deploy)');
bullets([
  'Matrice HTTPS tous les * .hubera.cloud: 200.',
  'Fuel vitest: 144 puis 146/146 (apkMeta + isolation package OTA).',
  'Cloudity-web vitest: 420 pass / 5 fail (rebrand: lien "Cloudity", plusieurs "Mot de passe", Tasks "productivite", payload register). Non bloquant pour l APK.',
  'Go auth-service: FAIL TestVerifyUserPathToken_AcceptsPreviousEpoch (J+35 sliding) — ne pas elargir la secu a l aveugle.',
  'Flutter cloudity_shared: snapshot SDK hote != CI (pas un bug produit).',
  'Music / Maps: 0 fichier de test unitaire — dette 1.3.334 / 0.1.70.',
  'QA Fuel: login 200, sync 200, maps vehicles/trips/places/stats. Aucun POST start trajet.',
  'QA Photos via id.hubera.cloud/photos/timeline: 200 items=[].',
  'Music QA allowlist 401 attendu. Search sans session 401 attendu.',
  'BV launch Status ok: maps fuel photos mail notes calendar contacts drive pass tasks cook jobs music (music force-stop, volume 0).',
  'adb install -r des APK telechargees depuis la prod: Success Maps Photos Mail Drive Calendar Contacts Notes Tasks Pass Cook Fuel Music.',
]);

h2('5. Technologie et mecanismes (comment c est cable)');
h3('Packages Android');
para(
  'applicationId Gradle = identite installable. Music Kotlin reste en classes ovh.delhomme.ytmusic.* a l interieur de l APK cloud.hubera.music (PlaybackService). Fuel scheme gasoiltracking:// + action MAPS_CONTROL inchanges pour que Maps parle encore a Fuel. Deux icones (ancien + nouveau) tant qu on n a pas desinstalle l ancien — zero perte locale.'
);
h3('OTA dual');
para(
  'Music: deux fichiers sur le volume ytmusic (ytmusic.apk legacy, hubera-music.apk). GET /api/deploy/apk?package=... choisit le slot. Ticket public force le slot Hubera. Fuel: table app_releases.package_name + pickLatestRelease(rows, pkg). Flutter: updates.json version legacy + canonical. Maps: un seul package deja cloud.hubera.maps, feed 0.1.67.'
);
h3('PWA / bandeau version');
para(
  'Le bandeau infini "Serveur en p+1.3.329 recharge la page" venait de Workbox qui precache index.html + /api/health en NetworkFirst 24h. location.reload() rechargeait la vieille coquille. Correctif 1.3.333: globIgnores index.html, navigateFallback vide, NetworkOnly navigations+health, hardReload (unregister SW, caches.delete, location.replace avec cache-buster), /refresh.html, Cache-Control no-store sur index/sw/health. Fuel SW etait deja NetworkOnly pour le HTML.'
);
h3('ID / gateway');
para(
  'id.hubera.cloud nginx proxy /auth et /photos vers cloudity-api-gateway:8000. Le reste de la suite via ID host rend encore le HTML statique (pas un Google Account API unique). SSO mode ask, local_login_kept=true, sso_forced=false. Flutter release gateway = https://id.hubera.cloud (plus 127.0.0.1:6002).'
);
h3('Maps + Fuel + Music');
para(
  'Maps appelle Photon, OSRM / routing.openstreetmap.de, Overpass (proxy VPS). Fuel expose /api/maps/vehicles|trips|places|stats + start/pause/stop. Handshake JWT Fuel dans Maps. Dock Music sur la carte. STREAM_UPSTREAM PC maison offline = normal; innertube + yt-dlp sur le VPS. Pas de lecture audio pendant les tests (mute + force-stop Music).'
);

h2('6. Captures — web');
shot('hubera.cloud — maison des apps', '2026-10-01-recap-web-home.png', 200);
shot('Maps web — Cesson a pied, onglet Fuel, dock Music (muet)', '2026-10-01-recap-web-maps.png', 220);
shot('Music web — connexion (passkey / QR / mot de passe), inscription fermee', '2026-10-01-recap-web-music.png', 200);
shot('Fuel /install — APK 1.4.164 vc 188, package cloud.hubera.fuel, signature EAS', '2026-10-01-recap-web-fuel-install.png', 190);
shot('Maps web — itineraires Rennes (session precedente)', 'maps-route-rennes.png', 200);

h2('7. Captures — Blackview (volume 0, pas de lecture Music)');
shot('Maps native BV', '2026-10-01-recap-maps.png', 200);
shot('Fuel native BV', '2026-10-01-recap-fuel.png', 200);
shot('Music native BV (ouverte puis stoppee, aucun son)', '2026-10-01-recap-music.png', 200);
shot('Jobs native BV', '2026-10-01-recap-jobs.png', 200);
para(
  'Suite Flutter (Photos Mail Notes Calendar Contacts Drive Pass Tasks Cook): lancement OK (pid + Status complete) puis splash Hubera ~quelques secondes sur BV. Preuve install: adb install -r Success sur les APK telechargees. Web Photos QA (compte qa.lab): albums vides, 4.35 Mo, nav Photos/Albums/Archive/Corbeille/Verrouille — comportement Google Photos, galerie vide attendue.'
);

h2('8. Versions live vs telephone vs feed');
table(
  ['App', 'APK BV cloud.hubera.*', 'Feed / install prod', 'Cert'],
  [
    ['Music', 'p+1.3.332 / 10632', 'ticket -> meme APK; web 1.3.333', 'debug 3cf6c532'],
    ['Fuel', '1.4.164 / 188', '/install 1.4.164; legacy OTA 1.4.163', 'EAS 13c3be90'],
    ['Maps', '0.1.67 / 68', 'updates.json 0.1.67', 'debug'],
    ['Photos', '1.0.6 / 7', '/install 1.0.6; feed legacy 1.0.5', 'debug'],
    ['Mail', '1.0.4 / 5', '/install 1.0.4; feed 1.0.3', 'debug'],
    ['Drive', '1.0.4 / 5', '/install 1.0.4; feed 1.0.2', 'debug'],
    ['Calendar', '0.1.4 / 5', '/install 0.1.4; feed 0.1.3', 'debug'],
    ['Contacts', '0.1.3 / 4', '/install 0.1.3; feed 0.1.2', 'debug'],
    ['Notes', '0.1.5 / 6', '/install 0.1.5; feed 0.1.4', 'debug'],
    ['Tasks', '0.1.3 / 4', 'conteneur taskflow nginx 0.1.3 (corrige: pas seulement hubera-taskflow-web)', 'debug'],
    ['Pass / Cook', '0.1.1 / 2', '/install aligne', 'debug'],
    ['Jobs', '1.0.57', 'APK URL publique 404', 'debug'],
  ],
  [0.85, 1.15, 1.5, 0.7]
);

h2('9. Ce qui ne marche pas / reste a faire');
table(
  ['Item', 'Detail', 'Prochaine version notee'],
  [
    ['Samsung ADB', '192.168.1.177 ping, port 40115 parfois open, session TLS morte. USB en parallele pour recoller le wireless debugging.', 'overlay -r des que USB'],
    ['Nothing', 'Laisse tourner. Owner installe via /install.', 'tests owner'],
    ['iPhone IPA', 'Expo/Flutter packagés cloud.hubera.*, iOS 15.1, eas.json. Linux ne signe pas d IPA.', 'TestFlight Mac/EAS'],
    ['ID proxy suite', 'Seul /auth et /photos vers le gateway. Mail/Drive/Pass via ID = HTML.', 'proxy suite, SSO ask'],
    ['Music stream 502', 'innertube "Streaming data not available", yt-dlp timeout, budget disque app (pas le disque VPS).', '1.3.334 tests stream'],
    ['Vitest Cloudity 5 ko', 'Rebrand Hubera vs anciens libelles de test.', 'aligner tests'],
    ['Go securetoken J+35', 'Fenetre sliding plus courte que le test.', 'ne pas relacher la sécu'],
    ['Jobs APK public', '404 sur jobs.hubera.cloud/apk/', 'publier dual package'],
    ['Interconnexions Google-like', 'Maps<->Fuel et dock Music live. Reste: fichiers partout, RSVP Mail->Calendar, Pass autofill, recherche unique.', 'voir RESTE-A-FAIRE 0b/0c'],
    ['Admin mobile', '0.1.1 installe, pas sur le site public.', 'hors scope public'],
  ],
  [1.0, 2.0, 1.0]
);

h2('10. Ecosystème type Google — deja la vs backlog');
para(
  'Deja en prod (ne pas casser): Maps <-> Fuel JWT /api/maps/* ; Maps dock Music ; Mail autocomplete Contacts ; Calendar invites Contacts + points Tasks ; Photos albums = noeuds Drive share_token ; Cook prefs sur Hubera ID ; ID ask (jamais force). Backlog (une version chacun, seulement apres tests verts): compte unique ID ; PJ Mail <-> Drive ; Photos share Mail ; Contacts -> destination Maps ; RSVP Mail -> Calendar ; Pass autofill + TOTP ; fusion Taskflow / Cloudity Tasks. RESTE-A-FAIRE.md section 0b numerote Music 1.3.334, Fuel 1.4.165 (aligner image API 1.4.155/163 vs APK 1.4.164), Maps 0.1.68, etc.'
);

h2('11. Comment on evite les erreurs a l avenir');
bullets([
  'Ne jamais servir un APK d un autre package sur le meme feed OTA.',
  'Ne jamais changer de keystore sur un package deja installe (debug 3cf6c532 / EAS Fuel).',
  'assertApkIdentity + pickLatestRelease(package) + tests unitaires avant upload CI Fuel.',
  'Ticket Music public = package Hubera ; OTA Android existante envoie encore ?package=ovh.delhomme.ytmusic.',
  'install -r sur Blackview des APK telechargees depuis le domaine public, pas depuis /data/app, avant d annoncer "prod installable".',
  'Tasks: le host public est le conteneur nginx "taskflow", pas seulement hubera-taskflow-web (/app/public).',
  'Pas de down -v, pas de recreate ytmusic/fuel pour un overlay fichier, restart du MEME conteneur si le process Node doit relire le TS.',
  'forceUpdate toujours false. Mute + aucune touche media pendant les tests. Nothing hors perimetre agent.',
  'Ne pas login QA Music allowlist. Ne pas reset paul@.',
]);

callout(
  'Pages d install a envoyer aux camarades',
  'https://music.hubera.cloud/install  https://fuel.hubera.cloud/install  https://maps.hubera.cloud/install  https://photos.hubera.cloud/install  et /install sur mail drive calendar contacts notes tasks pass cook. Android: telecharger l APK, autoriser sources inconnues. iPhone: TestFlight pas encore signe depuis ce Linux.'
);

note(
  'PDF pipeline scripts/reports (pdfkit-safe + verify-overflow) --mail. Captures 1 oct 2026 ~21h23-21h25. Blackview EEA9700PRO0014587. Samsung non photographié (ADB offline). Nothing non photographié. Music non lue (volume 0, force-stop).'
);

const pages = writeFooters('Hubera recap prod — 1 oct 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
