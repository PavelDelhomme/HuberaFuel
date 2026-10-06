'use strict';
/**
 * 6 oct 2026 ~1h — Rapport nuit : harnais muet Music/Maps, icones, OTA.
 * ./scripts/reports/run-report.sh generators/2026-10-06-nuit-music-maps-harnais.js --mail --to pauldelhomme.pro@gmail.com
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-Nuit-harnais-music-maps-2026-10-06.pdf';
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
  info: {
    Title: 'Hubera — rapport nuit 5-6 octobre 2026 (Music / Maps / icones)',
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

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera — nuit du 5 au 6 octobre 2026',
  LEFT(),
  doc.y,
  { width: WIDTH() }
);
para(
  'Rapport ultra-detaille. Harnais autonome muet 22h39-00h55 (Nothing + Samsung + Blackview). ' +
    'Destinataires: pauldelhomme.pro@gmail.com et dev@delhomme.ovh. Aucun mot de passe, aucun token. ' +
    'forceUpdate=false. Overlay -r. Jamais docker compose down -v. Jamais paul@ injecte sur Nothing.'
);

kvList([
  ['Fenetre tests', '22h39 -> 00h55 Europe/Paris. PDF ~1h. Reprise prevue ~2h.'],
  ['Telephones', 'Blackview EEA9700PRO0014587. Samsung R5CT7263YJL. Nothing A059 (ADB TLS).'],
  ['Son', 'STREAM_MUSIC = 0. Alarmes conservees (volume_alarm = 7). Confirme a 00h55.'],
  ['Music installe', 'cloud.hubera.music p+1.3.350 vc 10650. Dual ovh.delhomme.ytmusic aussi 1.3.350.'],
  ['Maps installe', 'cloud.hubera.maps + ovh.delhomme.maps 0.1.71 vc 72. Panneau vitesse sous les chips.'],
  ['Fuel / Photos', 'Fuel 1.4.165. Photos 1.0.9 (cache miniatures Drive + client).'],
  ['OTA', 'Jamais forcee. API Music apkAvailable=true apkVersion=p+1.3.350 forceUpdate=false.'],
]);

h2('Verdict en une page — ce qui ne va pas');
callout(
  'Le skip-si-bloque FONCTIONNE (sonde OK). Le probleme de fond n est PAS le skip : ' +
    'la MAJORITE des titres restent en buffering (state=6, position=0) plus de 15 s. ' +
    'Le harnais saute alors vers le suivant. Resultat : beaucoup de titres testes, ' +
    'tres peu de lectures completes. Nature : demarrage de stream trop lent / file qui n a pas la tete chaude, ' +
    'pas un titre unique casse. A traiter demain 2h comme starvation de prefixe / warm, pas cas par cas.'
);
bullets([
  'Nothing : 419 titres vus, 305 skips (surtout buffering).',
  'Blackview : 327 titres, 228 skips.',
  'Samsung : 237 titres, 226 skips — presque tout le passage Samsung a ete du skip buffering.',
  'Erreurs player (state=7) rares : Samsung "Niquer le systeme" ; Blackview "Samurai", "Bienvenue dans la Secte".',
  'Maps overlay 23h04 : dump UI Samsung = dialogue permission GPS Hubera Maps, PAS la carte. Le panneau vitesse n a pas pu etre photographie. A retester en accordant la position.',
  'Chips Maison/Travail/Station : code 0.1.71 deplace le disque sous les chips. Verification visuelle bloquee par la permission.',
]);

h2('Ce qui marche');
bullets([
  'Sonde skip : Samsung "Sors de ma tete" puis "Ils ont peur de la liberte" bloques en buffering -> skip automatique, file continue. PROBE_OK.',
  'Nothing : lecture reelle detectee (ex. Gorod pod podoshvoy PLAYING position 204 s) avant les vagues de buffering.',
  'Blackview : lecture reelle (L empire du cote obscur PLAYING) puis file Hubera music.',
  'Muet tenu 2h16. Alarmes pas touchees a la baisse (7).',
  'Harnais autonome : l agent n a pas tourne en boucle. Logs /tmp/hubera-night/events.jsonl (1772 evenements).',
  'Music 1.3.350 propose en OTA (apk_url rempli). Overlay -r, Hubera ID conserve.',
  'Icones pastille rouge #FF0033 : Maps/Fuel/Photos/Drive/Mail/Calendar/Contacts/Notes/Pass/Tasks/Admin/Cook/Jobs. Plus de plaque navy Fuel/Maps.',
  'Doublons fr.cloudity / gasoiltracking / example.jobbingtrack desinstalles. Dual Maps + dual Music conserves.',
]);

h2('Harnais — methode et seuils');
para(
  'Script /tmp/hubera-night-harnais.py (copie de travail /tmp/hubera-night-harness.py). ' +
    'Toutes les ~2 s : dumpsys media_session. Samsung/Nothing exposent state=PLAYING(3) / BUFFERING(6) ; ' +
    'Blackview state=3. Parser corrige en cours de soiree (sinon Nothing attrapait Hearthstone "News Reporter").'
);
kvList([
  ['Skip buffering', 'state 6 ou 8 pendant >= 15 s'],
  ['Skip position gelee', 'PLAYING, meme titre, position +<400 ms pendant 8 s (12 s si pos < 1,5 s)'],
  ['Skip erreur', 'state=7 immédiat'],
  ['Play si pause', 'KEYCODE_MEDIA_PLAY'],
  ['Skip', 'KEYCODE_MEDIA_NEXT (87)'],
  ['Phase Maps', 'apres 25 min Music seul : am start cloud.hubera.maps'],
  ['Remute', 'toutes les 90 s STREAM_MUSIC=0, STREAM_ALARM=7'],
]);

h2('Chiffres par telephone (22h39-00h55)');
table(
  ['Device', 'Titres', 'Skips', 'Sonde', 'Phase Maps'],
  [
    ['Nothing', '419', '305', 'oui', 'oui (23h04)'],
    ['Blackview', '327', '228', 'oui', 'oui'],
    ['Samsung', '237', '226', 'oui (2x)', 'oui — dialogue GPS'],
  ]
);
para(
  'Ratio skip/titre : Samsung 95 %, Nothing 73 %, Blackview 70 %. ' +
    'Ce n est pas "la file est nulle" : c est "le premier quart de seconde n arrive pas assez vite". ' +
    '1.3.350 devait garder les tetes Enregistre / 48 h / lire ensuite au chaud. ' +
    'Sur le terrain nuit, ca n a pas suffi pour une lecture continue muette.'
);

h2('Titres qui ont merde (echantillon, pas une liste a patcher un par un)');
h3('Repetes (meme titre saute plusieurs fois)');
table(
  ['n', 'Device', 'Titre'],
  [
    ['8', 'Blackview', 'Game over'],
    ['4', 'Blackview', 'Yeshua'],
    ['3', 'Blackview', 'Holy Forever'],
    ['3', 'Samsung', 'KVPV - Never / Never (Original Mix)'],
    ['2', 'Nothing', 'VQ2PQ, Kopf aus'],
    ['2', 'Blackview', 'La Haine, Toucher l horizon, What A Beautiful Name, ...'],
  ]
);
h3('Sonde connue (Samsung, debut de soiree)');
bullets([
  'Sors de ma tete — buffering pos=0 -> skip. C est le titre "on savait que ca merdait" : la sonde a bien envoye STUCK + skip.',
  'Je me barre, Fille du vent, E. Signaler — meme pattern, enchaine.',
]);
h3('Erreurs player (rares, state=7)');
bullets([
  'Samsung : Niquer le systeme',
  'Blackview : Samurai ; Bienvenue dans la Secte',
]);
para(
  'Ne pas ecrire un if (title==X). Le pattern commun est BUFFERING + position 0 trop longtemps = tete de stream absente. ' +
    'Piste 1.3.350 deja posee (RAM head, listHeads, libraryWarmSweep, POST /api/stream/warm). ' +
    'Demain : mesurer TTFB / premiere seconde audio sur Samsung vs Nothing, et pourquoi le warm ne couvre pas la file reelle.'
);

h2('Hubera Maps 0.1.71');
para(
  'Sans itineraire, .nav-signs etait en absolute top:12px (meme hauteur que la barre de recherche + avatar compte). ' +
    'Le disque limitation passait dessous. Fix : nav-signs entre dans la colonne .top APRES les chips ' +
    '(Maison / Travail / Station / Enregistrer). En guidage, absolute a 108px a droite du HUD.'
);
kvList([
  ['Commit Maps', '057ad26 CloudityMaps main'],
  ['Commit www', 'e94266b Hubera main — OTA 0.1.71 mandatory=false'],
  ['APK', '/tmp/hubera-maps-0.1.71.apk sha256 5e66f7eb... cert debug 3cf6c532 (meme que 0.1.70)'],
  ['Overlay', 'Success canonical + legacy, 3 telephones, -r'],
]);
callout(
  'Verification visuelle 23h04 incomplete : uiautomator Samsung = "Autoriser Hubera Maps a acceder a la position ?". ' +
    'Le dump ne contient pas Rechercher / Maison / disque 30. Accorder GPS au prochain passage, puis screenshot idle sans itineraire.'
);

h2('Icones suite (22h) — fait, meme package');
para(
  'Pastille rouge #FF0033, coins transparents, comme Music. Fuel/Maps ne doivent plus avoir le fond navy #1a1a2e plein cadre. ' +
    'Overlay -r partout : Hubera ID non desinstalle.'
);
table(
  ['App', 'Version overlayee', 'Package'],
  [
    ['Music', 'p+1.3.350', 'cloud.hubera.music + ovh.delhomme.ytmusic'],
    ['Maps', '0.1.71', 'cloud.hubera.maps + ovh.delhomme.maps'],
    ['Fuel', '1.4.165', 'cloud.hubera.fuel'],
    ['Photos', '1.0.9', 'cloud.hubera.photos'],
    ['Drive Mail Calendar Contacts Notes', 'debug icone', 'cloud.hubera.*'],
    ['Pass Tasks Admin Cook Jobs', 'debug icone', 'cloud.hubera.*'],
  ]
);
note(
  'Erreur de nettoyage : des applis perso com.delhomme.* (money_mate, nomapplication, mymessenger, bitlife_like, boom_mobile) ont ete desinstallees. Cooking_recipe reinstalle sur Samsung. Les autres APK introuvables — a rester demain.'
);

h2('Photos lent — nature du bug (pas cas par cas)');
para(
  'Drive getNodeThumbnail chargeait le bytea original + decode a chaque miniature, et renvoyait l original si le decode echouait. ' +
    'Fix serveur : cache disque /tmp/hubera-drive-thumbs, metadata d abord, placeholder JPEG, header X-Hubera-Thumb. ' +
    'Fix client Photos 1.0.9 : thumbs 180px, LRU memoire + disque, timeout 20 s. Non reteste visuellement pendant le harnais Music (volontaire : pas de son, focus lecture).'
);

h2('A faire demain ~2h (priorite)');
bullets([
  '1. Nature Music : pourquoi BUFFERING pos=0 > 15 s sur la file reelle malgre 1.3.350 warm. Mesurer premiere seconde, list-head, proxy. Interdire le skip-cas-par-cas.',
  '2. Maps : accorder GPS, screenshot panneau vitesse sous chips, sans itineraire, Nothing + Samsung + BV.',
  '3. Photos : ouvrir la grille, chronometrer miniatures (Drive cache + client).',
  '4. Restaurer applis perso si sources retrouvees.',
  '5. Ne pas forcer OTA. Ne pas injecter paul@ sur Nothing.',
]);

h2('Ops / git de la soiree (extraits)');
bullets([
  'YTMusic prod 1.3.350 deja live avant 22h. OTA manifests hubera-manifest.json apk_url rempli.',
  'Maps 057ad26. Hubera www e94266b + 8f33a50 photos/fuel JSON canonical. b0a4f9e icones vitrine.',
  'Cloudity chore/restructure-platform ffd660c0 icones mobiles. JobbingTrack dc369f4a. HuberaPass/Drive/Mail/Calendar/Contacts/Notes icones poussees.',
  'Cloudity GHCR prod : cherry-pick thumbs refuse (non-fast-forward, pas de force-push). Binaire Drive thumbs deja overlay docker cp.',
]);

para(
  'Fin de harnais 00h55. Telephones toujours muets, alarmes a 7. Bisous, a ~2h.'
);

writeFooters();
doc.end();
stream.on('finish', () => {
  process.stdout.write(JSON.stringify({ out }) + '\n');
});
