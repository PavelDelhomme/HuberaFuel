'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-26-lot-maps-music-fuel.pdf';
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
    Title: 'Hubera — lot Maps / Music / Fuel 26 octobre 2026',
    Author: 'Hubera',
  },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, h2, h3, para, note, bullets, callout, kvList, table, writeFooters } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text(
  'Hubera — lot Maps / Music / Fuel',
  LEFT(),
  doc.y,
  { width: WIDTH() },
);
para('26 octobre 2026 · Europe/Paris. Déploiements prod web + dual APK. Overlay Samsung lab + Blackview (-r). Pas Nothing. OTA forceUpdate false / mandatory false. Colonnes Cockpit : À valider (pas Fait).');

callout(
  'Prod lue juste avant ce PDF',
  'Maps 0.1.131 vc 132 · Music 1.3.398 (APK p+1.3.398 vc 10698) · Fuel 1.4.194 vc 220. apkAvailable true pour un client N-1. Tunnel Music maison hors périmètre de ce lot.',
  ACCENT,
);

h2('1. Versions déployées');
table(
  ['App', 'Version / code', 'Client N-1', 'apkAvailable'],
  [
    ['Maps', '0.1.131 / 132', '0.1.130 / 131', 'true'],
    ['Music', '1.3.398 / 10698', '1.3.397 / 10697', 'true'],
    ['Fuel', '1.4.194 / 220', '1.4.193 / 219', 'true'],
  ],
  [1.2, 1.5, 1.5, 1.1],
);

h3('Surfaces');
bullets([
  'Maps web : maps.hubera.cloud (app.js + index.html + updates.json + APK nginx).',
  'Music API + web dist : conteneur ytmusic (mappers, searchRank, VERSION, VERSION_NOTES, /app/web/dist, APK volume).',
  'Fuel : fuel.hubera.cloud + gasoil-tracking.delhomme.ovh (upload-release-apk hubera + legacy).',
  'Overlay ADB -r : EEA9700PRO0014587 (BV) + R5CT7263YJL (Samsung lab).',
]);

h2('2. Contenu du lot (retours Cockpit)');
h3('Maps 0.1.131');
bullets([
  'Adresses enregistrées : petites cartes, swipe Modifier / Supprimer (confirmation), édition d’une adresse saved (pendingSavedEditIndex).',
  'Limite de vitesse de zone aussi sans conduite (pingIdleGeo + refreshRoad).',
  'Bouger / zoomer la carte ne ferme plus la sélection d’itinéraire (pointerdown ignore #map).',
  'POI stations : ways OSM + centre (évite un nœud d’angle type Total ZA Portain). Pas de coordonnées inventées.',
  'Fuel UI seulement voiture / suivi libre ; Maison/Travail « Modifier » ; notes de version drawer (lots précédents du jour).',
]);

h3('Music 1.3.398');
bullets([
  'prettifyArtistName : AronChupa → Aron Chupa ; split « Artiste - Titre » si artistes vides.',
  'Reprise lecture : plus de comparaison fragile à location.pathname (SPA).',
  'Typo « je vais bine ostromae » : repair déjà en place ; pénalité si le titre colle sans l’artiste Stromae (Ridsa descend). Pas de titre officiel YTM « Je vais bien » Stromae.',
  'Recherche artistes récents / multi-versions (lot 1.3.397 déjà en prod).',
  'Classe titres LOGIN_REQUIRED (TeddyBear / Formidable) : reste dépendant du tunnel maison — noté, pas « fait ».',
]);

h3('Fuel 1.4.194');
bullets([
  'Terminer : clearLivePointsAfterFinish synchrone + cooldown 4 s — le bouton Pause/Terminer ne ressuscite plus via peekLiveTripId.',
  'Suivi libre ouvre Maps une seule fois (lot 1.4.193 déjà en prod).',
]);

h2('3. Git (working tree, non poussé dans ce mail)');
para('Diffs locaux au moment du rapport. Pas de commit automatique dans ce lot.');

h3('Maps (main)');
note('14 fichiers · +1838 / −338 — VERSION, build.gradle, web/app.js, web/index.html, updates.json, assets APK, VERSIONS.md, InAppUpdate/MainActivity/SuiteBridge (lots du jour).');

h3('YTMusic (feat/music-drawer-open-native)');
note('18 fichiers · +789 / −51 — VERSION, VERSION_NOTES, mappers.ts, searchRank.ts, yt.ts, player.ts, AuthModal, shuffleHeads, etc.');

h3('GasoilTracking (prod)');
note('10 fichiers · +143 / −58 — app.json 1.4.194, maps.tsx, startFreeTrip.ts, trip/control, mapsControlFromNative, api index.');

h2('4. Cockpit');
bullets([
  'Cartes Maps swipe / vitesse / itinéraire → review (À valider).',
  'Music flux SPA + split AronChupa / typo Stromae → review.',
  'Fuel double Terminer → review.',
  'Maps Total Portain → review (fix OSM ways).',
  'Music titres LOGIN_REQUIRED → todo (tunnel).',
]);

h2('5. À valider sur téléphone');
bullets([
  'Samsung + Blackview : OTA Maps 0.1.131, Music 1.3.398, Fuel 1.4.194 (ou overlay déjà posé).',
  'Maps : swipe Modifier sur une adresse saved ; pan carte avec carte d’itinéraire ouverte ; panneau limite sans démarrer.',
  'Maps : zoom station Total ZA Portain — position sur la nationale.',
  'Music : recherche « je vais bine ostromae » / fiche AronChupa ; lecture après navigation album.',
  'Fuel : un seul « Oui, terminer » ferme vraiment le suivi.',
  'Nothing : OTA non forcée uniquement — pas d’overlay ADB.',
]);

callout(
  'Hors lot',
  'Contacts / Calendar / Photos / Cook / Hub / DA unifiée : backlog, pas ce sprint Music → Maps → Fuel.',
  ACCENT,
);

writeFooters('Hubera — lot 2026-10-26 Maps / Music / Fuel');

stream.on('finish', () => {
  console.log(JSON.stringify({ out, pages: doc.bufferedPageRange().count }));
});
doc.end();
