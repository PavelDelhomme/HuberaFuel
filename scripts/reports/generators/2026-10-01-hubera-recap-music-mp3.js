'use strict';
/**
 * 1 oct 2026 ~21h50 — Recap Music import MP3 + retests prod.
 * ./scripts/reports/run-report.sh generators/2026-10-01-hubera-recap-music-mp3.js --mail --to pauldelhomme.pro@gmail.com
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Recap-music-mp3-2026-10-01.pdf';
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
    Title: 'Hubera Music — import MP3 compte utilisateur 1er octobre 2026',
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
  'Hubera Music — import MP3 + retests production',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  '1er octobre 2026 ~21h50 Europe/Paris. Destinataire: pauldelhomme.pro@gmail.com. Suite du recap 21h25. Ce PDF detaille la nouvelle fonction (MP3 stocke sur le compte), le test Jive Me - 120 BPM, le deploy overlay, puis TOUS les retests des points du mail precedent: ce qui marche, ce qui ne marche pas, les mecanismes, les garde-fous. Aucun mot de passe, aucun token.'
);

kvList([
  ['Perimetre telephones', 'Blackview USB device (pas de lecture Music, volume 0). Samsung TLS wireless vu comme device — non touche (pas d overlay APK). Nothing: non touche.'],
  ['Regle ops', 'Jamais docker compose down -v. Overlay + restart du MEME conteneur ytmusic. forceUpdate=false. Pas de force-push. Pas de commit .env.'],
  ['Owner test MP3', 'paul@delhomme.ovh (sqlite id c033a13e-4ac2-4c74-9b47-202239bcc381). Fichier sous /app/data/uploads/... sur le volume ytmusic_data existant.'],
  ['Music live', 'Web/API p+1.3.334 forceUpdate=false. APK ticket public toujours p+1.3.332 (pas de rebuild APK ce tour).'],
  ['Fuel live', 'vitest 146/146. /api/version sans hint 1.4.163 com.gasoiltracking.app ; clientPackage=cloud.hubera.fuel -> 1.4.164 vc 188 forceUpdate false.'],
]);

h2('1. Verdict en une page');
table(
  ['Statut', 'Quoi'],
  [
    ['VERT', 'Import MP3 sur le compte: fichier 3.1 Mo persisté, playlist Importes, bibliotheque, stream 206 audio/mpeg cache=user-upload (pas yt-dlp).'],
    ['VERT', 'Metadonnees YouTube auto: titre conserve "Jive Me - 120 BPM", artiste Jive Me (UCvlksLX4uH-abq3FjfLnwrg), id YT DvE0k6SDw2U, metaSource=youtube.'],
    ['VERT', 'Sans session: POST /api/import/file = 401. Invites exclus (accountRequired). Max 40 Mo / 200 titres.'],
    ['VERT', 'Health music.hubera.cloud p+1.3.334. Bundle web contient "Fichier MP3 sur ton compte" + picker. Overlay ytmusic 9f2e04884dad restart, pas de recreate.'],
    ['VERT', 'Retest recap: HTTPS 20/20 hosts 200. Fuel 146/146. Dual OTA Fuel OK. Ticket Music public package=cloud.hubera.music. ID POST /auth/login plus 405 (400 validation email).'],
    ['ORANGE', 'APK Android Music reste p+1.3.332 vc 10632 sur BV. Le picker natif est dans le source 1.3.334, pas encore dans l APK live (forceUpdate=false, pas de rebuild ce tour). Import via web connecte ou CLI serveur.'],
    ['ORANGE', 'Page /import sans session = "Compte requis" + modal connexion (voulu). Samsung ADB present mais non overlay. STREAM_UPSTREAM PC maison toujours configure, innertube 502 possibles sous charge.'],
    ['ROUGE / REPORT', 'Jobs APK public 404 inchange. iPhone: pas d IPA. Cloudity vitest 5 fail rebrand (non rejoue, deja connus). Go securetoken J+35 (non elargi).'],
  ],
  [0.9, 3.1]
);

h2('2. Ce qui a ete demande, ce qui a ete livre');
para(
  'Demande: pouvoir importer des fichiers MP3 sur le serveur, attaches au compte utilisateur, pour enregistrer une nouvelle musique; recuperer automatiquement titre / artiste / pochette depuis YouTube (metadata), sinon titre saisi / ID3 / nom de fichier; tester avec une conversion YouTube->MP3 de "Jive Me - 120 BPM"; deployer; retester tout le recap precedent; envoyer un PDF detaille.'
);
bullets([
  'POST /api/import/file (binaire audio/mpeg, query title/artist/filename). Compte requis, 20 imports / 15 min, 40 Mo, 200 fichiers / compte.',
  'Stockage /app/data/uploads/{userId}/{trackId}.mp3 — volume ytmusic_data DEJA LA, aucun volume nouveau, pas de docker compose down -v.',
  'Enrichissement: ID3v2 TIT2/TPE1/TALB + parse "Artiste - Titre.mp3" + search YouTube (songs puis videos). Si match: id = videoId YT (11 chars, compatible lecteur Android/web existant). Sinon id aleatoire 11 chars. source=upload sur le Track.',
  'Lecture: handleStream / handleStreamUrl servent le fichier local (Range 206) si le userId possede l upload. ?type=video continue le clip YouTube si l id est un vrai clip.',
  'Bibliotheque: ensureLibraryTrack + playlist systeme "Importes". GET /api/track/:id court-circuite Innertube pour un upload.',
  'UI web /import: bloc "Fichier MP3 sur ton compte" (titre/artiste optionnels + input file). UI Android YtmImportScreen: meme flux (GetContent audio/*) — source pret, APK pas reconstruite.',
  'Tests unitaires id3Meta: 5/5 (filename, query, magic MP3, ID3v2.4 TIT2/TPE1).',
  'Test reel Jive Me: yt-dlp ytsearch1 -> QNnbWWK2FWQ extrait mp3 3 219 260 octets / 199.4 s, import CLI sur paul@, YouTube Music a matche DvE0k6SDw2U (meilleur hit chanson que la video brute).',
]);

h2('3. Test Jive Me - 120 BPM (preuve complete)');
table(
  ['Etape', 'Resultat'],
  [
    ['Conversion', 'bin/yt-dlp -x --audio-format mp3 "ytsearch1:Jive Me 120 BPM" -> /tmp/jive-me-120bpm.mp3. Video brute QNnbWWK2FWQ. ffmpeg/ffprobe duration 199.402667 s, size 3219260, format mp3. Aucune lecture PC.'],
    ['Import compte', 'npx tsx importFileCli --email paul@delhomme.ovh --file /tmp/jive-me-120bpm.mp3 --title "Jive Me - 120 BPM" DANS le conteneur ytmusic (apres overlay).'],
    ['User', 'paul@delhomme.ovh / c033a13e-4ac2-4c74-9b47-202239bcc381 (sqlite /app/data/ytmusic.db, pas postgres).'],
    ['Track id', 'DvE0k6SDw2U (YouTube Music "Jive Me", artiste id UCvlksLX4uH-abq3FjfLnwrg). Titre conserve tel que saisi.'],
    ['metaSource', 'youtube (recherche interne API, timeout 12 s). youtube_id = DvE0k6SDw2U. source_query = "Jive Me - 120 BPM".'],
    ['Fichier disque', '/app/data/uploads/c033a13e-4ac2-4c74-9b47-202239bcc381/DvE0k6SDw2U.mp3 exists=true size=3219260 (egal a l upload).'],
    ['Biblio', 'library_tracks: oui. playlists: "Importes". original_name=jive-me-120bpm.mp3 mime=audio/mpeg.'],
    ['Stream auth', 'GET /api/stream/DvE0k6SDw2U Range bytes=0-1023 avec JWT owner: HTTP 206, X-PLM-Stream-Cache=user-upload, Content-Type=audio/mpeg, Content-Range=bytes 0-1023/3219260, body commence par ID3.'],
    ['Sans auth', 'POST /api/import/file -> 401 {"error":"Authentification requise"}. Le fichier d un user n est jamais servi a un autre (lookup user_id + id).'],
  ],
  [1.1, 2.9]
);
callout(
  'Pourquoi l id n est pas QNnbWWK2FWQ',
  'yt-dlp a pris le premier hit YouTube web (QNnbWWK2FWQ). L API Music cherche ensuite via Innertube/YTM et a prefere la fiche chanson Jive Me DvE0k6SDw2U (artiste + pochette + clip). L audio JOUE est bien le MP3 converti (3.1 Mo), pas un re-download yt-dlp. Le clip ?type=video peut utiliser la video officielle. C est le comportement voulu: fichier perso + metadata YouTube.'
);

h2('4. Mecanisme technique (pour ne pas recasser)');
h3('IDs 11 caracteres');
para(
  'Toute la stack (Android isPlayable, web player, compression gzip skip, stream regex) n accepte que [A-Za-z0-9_-]{11}. Un prefixe upl_ aurait rendu les imports injouables. Donc: si YouTube matche, on REUTILISE l id YT; sinon on genere 11 chars. Le fichier reste prive (cle primaire user_id + id). Deux comptes peuvent importer le meme tube: deux fichiers, meme id logique, streams separes.'
);
h3('Stream');
para(
  'Au debut de handleStream, avant yt-dlp / Innertube: si query type!=video ET getOwnedUpload(userId, id) ET fichier present -> pipe Range audio/mpeg, header X-PLM-Stream-Cache=user-upload. handleStreamUrl renvoie { url: /api/stream/id, via: upload, mimeType: audio/mpeg }. Un Range mid-piste ne relance pas yt-dlp. Le clip video n est pas le MP3 (injouable en video/mp4).'
);
h3('Volume Docker');
para(
  'DATA_DIR = /app/data (db.ts ../../../data depuis api/src/library). Volume existant ytmusic_data:/app/data. Dossier uploads/ cree a la volee. Restart du conteneur 9f2e04884dad, health starting puis p+1.3.334. Pas de nouveau volume, pas de rename, pas de down -v.'
);
h3('UI / auth');
para(
  'Layout: allowGuest=false en prod -> page /import sans session = "Compte requis" + modal Connexion (passkey / QR / email). C est voulu: on ne stocke pas de MP3 anonyme. Une fois connecte, le bloc picker apparait (bundle index-EiIkMR3-.js contient "Fichier MP3 sur ton compte"). Android: ecran Compte Google, section MP3 + GetContent; besoin d un prochain assemble prod pour BV (versionCode 10634 si 1.3.334).'
);
h3('Tests ajoutes');
para(
  'api/src/media/id3Meta.test.ts (node:test + tsx): parse "Jive Me - 120 BPM.mp3", buildMetadataQuery, isProbablyMp3 ID3/MPEG, parseId3Tags TIT2/TPE1. 5/5. A rejouer a chaque overlay: npx tsx --test api/src/media/id3Meta.test.ts.'
);

h2('5. Deploy effectue');
table(
  ['Quoi', 'Comment'],
  [
    ['Fichiers API', 'docker cp dans ytmusic:/app/api/src/{media,library,youtube,index.ts} + migrations/001_init.sql + importFileCli.ts'],
    ['Web', 'npm run build -w web (1.3.334), docker cp web-dist -> /app/web/dist (PWA generateSW).'],
    ['VERSION', '/app/VERSION et VERSION_NOTES.json 1.3.334 "Import MP3 sur le compte", forceUpdate inchange (false).'],
    ['Restart', 'docker restart ytmusic (meme ID). Health p+1.3.334 ytdlp=true canonicalHost music.hubera.cloud.'],
    ['APK', 'NON reconstruite. Ticket POST /api/install/apk-ticket -> package=cloud.hubera.music versionName p+1.3.332 size 50645013. BV dumpsys versionName=p+1.3.332 versionCode=10632.'],
  ],
  [1.0, 3.0]
);

h2('6. Retests du recap 21h25 (ce qui etait orange/rouge)');
table(
  ['Sujet recap', 'Retest 21h45-21h50', 'Statut'],
  [
    ['HTTPS *.hubera.cloud', 'www music fuel maps id photos mail drive pass calendar contacts notes tasks cook jobs press stream budget office vtcbuilder = 200. jobs-api health 200.', 'VERT'],
    ['Fuel vitest', '24 files, 146/146, 953 ms.', 'VERT'],
    ['Fuel dual OTA', 'sans hint 1.4.163 com.gasoiltracking.app ; ?clientPackage=cloud.hubera.fuel 1.4.164 vc 188 forceUpdate false.', 'VERT'],
    ['Music ticket public', 'POST /api/install/apk-ticket 200 url .../api/deploy/apk?t=...&package=cloud.hubera.music (plus le legacy par defaut).', 'VERT'],
    ['Music bandeau version', 'Web p+1.3.334 visible (bouton Version). Pas de boucle recharge observee sur /import.', 'VERT'],
    ['ID POST /auth/login', 'plus 405. POST JSON -> 400 validation Email (champ vide/invalide). Proxy /auth OK.', 'VERT'],
    ['Maps updates.json', 'version 0.1.67 package cloud.hubera.maps.', 'VERT'],
    ['Jobs APK public', 'https://jobs.hubera.cloud/apk/hubera-jobs.apk 404. App toujours installable par overlay BV seulement.', 'ROUGE inchange'],
    ['Samsung ADB', 'device wireless adb-00145153K001434 present. NON overlay, NON media, NON volume. USB BV reste EEA9700PRO0014587.', 'ORANGE (dispo mais consigne: pas toucher sans USB owner)'],
    ['Nothing', 'non liste / non touche.', 'OK consigne'],
    ['Stream 502 / STREAM_UPSTREAM', 'Toujours http://172.17.0.1:18788. Import local ne depend PAS d innertube pour l audio. Les titres YouTube purs peuvent encore 502 sous charge.', 'ORANGE inchange pour YT; VERT pour MP3 importes'],
    ['Cloudity 5 vitest / Go J+35', 'non rejoues (deja documentes, hors Music MP3). Ne pas elargir la fenetre sliding.', 'REPORT'],
    ['iPhone IPA', 'toujours pas signe depuis Linux.', 'REPORT'],
  ],
  [1.15, 2.05, 0.8]
);

h2('7. Captures');
shot('Music /import — compte requis (prod p+1.3.334, inscription fermee)', '2026-10-01-recap2-music-import-login.png', 230);
para(
  'Sans session, le Layout bloque l Outlet: modal Connexion (passkey, QR appareil, email). C est le garde-fou: le MP3 n existe que pour un compte. Une fois connecte (paul@ / passkey telephone), le picker "Choisir un MP3" est dans la page Importer. Preuve bundle live: index-EiIkMR3-.js contient le libelle "Fichier MP3 sur ton compte".'
);
shot('Music native BV (session precedente, p+1.3.332 — picker MP3 pas encore dans cet APK)', '2026-10-01-recap-music.png', 190);
shot('hubera.cloud maison des apps', '2026-10-01-recap-web-home.png', 180);
shot('Fuel /install dual package (inchange, reteste ce soir)', '2026-10-01-recap-web-fuel-install.png', 170);

h2('8. Versions live vs telephone');
table(
  ['App', 'Telephone BV', 'Prod feed / web', 'Note'],
  [
    ['Music', 'p+1.3.332 / 10632 cloud.hubera.music', 'web 1.3.334 ; ticket APK 1.3.332', 'Import MP3 = API/web. Prochain APK 1.3.334 vc 10634, forceUpdate=false, overlay -r.'],
    ['Fuel', '1.4.164 / 188', 'Hubera 1.4.164 / legacy 1.4.163', '146 tests, isolation package OK'],
    ['Maps', '0.1.67 / 68', 'updates.json 0.1.67 cloud.hubera.maps', 'inchange'],
    ['Jobs', '1.0.57 installe', 'APK URL 404', 'camarades: overlay seulement'],
  ],
  [0.8, 1.3, 1.3, 0.6]
);

h2('9. Ce qui ne marche pas encore (honnete)');
bullets([
  'Picker MP3 dans l APK Hubera Music du telephone: le code Kotlin est pret (YtmImportScreen + Retrofit importFile) mais l APK publiee est encore 1.3.332. Workaround: music.hubera.cloud/import une fois connecte, ou le CLI serveur pour l owner.',
  'Page /import anonyme: pas le formulaire MP3 (Layout "Compte requis"). Voulu. Ne pas ouvrir l upload aux invites.',
  'Jobs APK public 404 — identique au recap 21h25.',
  'iPhone: pas d IPA.',
  'SSO ID: nginx ne proxy que /auth et /photos. Mail/Drive via id.hubera.cloud = HTML.',
  'Titres YouTube non-importees: 502 innertube possibles. Les MP3 user-upload ne passent plus par cette voie.',
  'Samsung: ADB wireless reapparu; aucun overlay ni test son (consigne).',
  'Deux ids YouTube pour le meme morceau de test (QNnbWWK2FWQ vs DvE0k6SDw2U): l audio est le fichier converti; les metadata/clip sont la fiche YTM. Documente, pas un bug de perte de fichier.',
]);

h2('10. Comment on evite de recasser');
bullets([
  'Ne jamais recreer ytmusic ni down -v: les MP3 sont DANS ytmusic_data/uploads/. Perdre le volume = perdre les imports utilisateurs.',
  'Ne jamais servir un upload sans verifier user_id (getOwnedUpload). Un id YT partage ne donne pas le MP3 du voisin.',
  'Garder des ids 11 chars sinon Android isPlayable() refuse la piste.',
  'forceUpdate=false tant que l APK n a pas le picker: sinon on forcerait 1.3.334 web-only vers des telephones sans le bouton.',
  'Ticket Music public: continuer d appendre &package=cloud.hubera.music.',
  'Fuel: continuer pickLatestRelease(package_name). 146 tests avant tout upload CI.',
  'Rejouer npx tsx --test api/src/media/id3Meta.test.ts + un import CLI smoke apres chaque overlay Music.',
  'Pas de lecture audio pendant les tests telephones (mute + pas de media keys).',
]);

callout(
  'Pour toi (owner) pour voir le MP3 dans l app',
  'Web: music.hubera.cloud -> Connexion (passkey ou QR depuis le telephone deja logge) -> Importer -> Choisir un MP3. Le titre "Jive Me - 120 BPM" est deja dans ta playlist Importes et ta bibliotheque, lecture = ton fichier. Telephone: tant que l APK est 1.3.332, ouvre le meme /import dans le navigateur, ou attends le prochain overlay -r 1.3.334 (on ne force pas OTA).'
);

note(
  'Pipeline scripts/reports (pdfkit-safe + verify-overflow) --mail. Captures 1 oct 2026 ~21h47. Conteneur ytmusic 9f2e04884dad. Test Jive Me sans playback. Blackview EEA9700PRO0014587 muet. Nothing non touche.'
);

const pages = writeFooters('Hubera Music MP3 — 1 oct 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
