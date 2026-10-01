'use strict';
/**
 * Recap 28 sept 2026 — Maps Contacts, Fuel in-Maps, suite, Music.
 * Pipeline: ./scripts/reports/run-report.sh generators/2026-09-28-hubera-maps-contacts.js --mail
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME =
  process.env.REPORT_OUT || 'Hubera-Recap-2026-09-28-maps035-fuel-suite.pdf';
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
    Title: 'Hubera — Recap 28 sept 2026 Maps 0.1.35 Fuel Contacts',
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
  const maxH = 300;
  need(maxH + 14);
  const y0 = doc.y;
  doc.image(p, LEFT(), y0, { fit: [WIDTH(), maxH] });
  doc.y = y0 + maxH + 8;
  resetX();
}

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1.05);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text('Hubera', LEFT(), doc.y, {
  width: WIDTH(),
});
para(
  'Recapitulatif 28 septembre 2026, soir (Europe/Paris). Suite de la journee: Fuel n est plus l UI live, Maps est la surface Fuel, Contacts fournit les adresses Enregistres, les autres apps restent up, Music n a pas ete force. Owner Hubera ID: paul@delhomme.ovh. Tests Samsung SM-G990B2 + Blackview BV9700Pro. Aucun docker compose down -v, aucun forceUpdate Music, aucun clavier Samsung monopolise.'
);
callout(
  'Demande de ce soir',
  'Continuer d ameliorer la suite, verifier que les autres apps marchent, lier les adresses Contacts dans Maps, confirmer le compte de test Maps avec Fuel dedans, beaucoup de taf, puis ce mail PDF detaille.',
  ACCENT
);
kvList([
  ['Owner / compte Maps', 'paul@delhomme.ovh (Hubera ID, pas un faux compte)'],
  ['Maps telephones', '0.1.35 vc 37 overlay -r Samsung + Blackview'],
  ['Fuel telephones', '1.4.156 vc 180 overlay -r'],
  ['Music telephones', 'p+1.3.317 vc 10617 (source 1.3.318, overlay non force)'],
  ['Gateway LAN', 'http://192.168.1.134:6002 (JWT local)'],
  ['Public suite', 'mail/drive/contacts/calendar.hubera.cloud (OpenResty)'],
]);

h2('1. Verdict en une page');
table(
  ['Sujet', 'Resultat', 'Preuve'],
  [
    [
      'Adresses Contacts dans Maps',
      'OK',
      'Enregistres 21h07: Intermarche La Guerche (contact id 11)',
    ],
    [
      'Compte owner Maps',
      'OK',
      'JWT injecte hubera-maps://auth, avatar P, Maison Rennes',
    ],
    [
      'Fuel dans Maps',
      'OK',
      'Trajets 21h08: 9.4 / 28.4 / 43.4 km, Suivi libre, pas de hop',
    ],
    [
      'GPS Fuel a la fin',
      'OK',
      'Pas de FGS Location sur le Blackview',
    ],
    [
      'Music dock',
      'OK',
      'Signs / Tate McRae en pause, non overlay',
    ],
    [
      'Mail Drive Contacts Calendar Pass',
      'OK',
      'Health 200/302, APK 1.0.1 / 0.1.1, API :6002',
    ],
    [
      'Login web public Calendar',
      'Partiel',
      'API exige tenant_id; bundle public hashe pas encore Vite',
    ],
    [
      'Maps 0.1.35 git',
      'Local',
      'Overlay telephones fait; commit/push non demande ce soir',
    ],
  ],
  [1.5, 0.7, 2.3]
);

h2('2. Maps 0.1.35 — Hubera Contacts');
para(
  'Avant: l onglet Enregistres ne lisait que le localStorage Maps (Maison, Travail, recents Photon). Hubera Contacts n etait pas relie. Le WebView Maps charge en file:// donc un fetch JS vers contacts.hubera.cloud est bloque (CORS + pas de cookie/JWT suite).'
);
h3('Pont natif SuiteBridge (HuberaSuite)');
bullets([
  'Nouveau fichier apk/.../SuiteBridge.kt. JS interface HuberaSuite: setToken, token, email, refreshContacts, takeContacts, openContacts.',
  'GET HttpURLConnection d abord http://192.168.1.134:6002/contacts puis https://contacts.hubera.cloud/contacts, Bearer SharedPreferences.',
  'Deep link hubera-maps://auth?email=&token= (le shell ADB doit coter l URI sinon &token= est coupe).',
  'network_security_config: cleartext uniquement pour 192.168.1.134 (usesCleartextTraffic reste false).',
  'queries Android: fr.cloudity.cloudity_contacts. Tiroir: entree Hubera Contacts.',
  'web/app.js: contactPlaces() lit profile.addresses, section Adresses Hubera Contacts, geocode Photon au clic, suggestions recherche.',
]);
h3('Compte de test = owner');
para(
  'Le compte operationnel demande est bien paul@delhomme.ovh. Login API locale 200. Un contact QA a ete cree: id 11, Intermarche La Guerche, Faubourg de Vitre / 35130 La Guerche-de-Bretagne, email maps.contact.qa@delhomme.ovh. Public contacts.hubera.cloud repond 401 avec le JWT LAN (auth publique != gateway). Maps prend le LAN en premier: c est le meme chemin que Mail/Drive overlay.'
);
shot('Blackview 21h07 — Enregistres + Contacts', 'maps-contacts-2026-09-28.png');
para(
  'Visible: Maison Rennes (Place de la Gare), Adresses Hubera Contacts, Intermarche La Guerche avec Faubourg de Vitre, 35130, dock Music Signs, onglet Enregistres actif. C est exactement le lien Contacts -> Maps demande.'
);

h2('3. Fuel dans Maps (GPS toujours dans Fuel)');
para(
  'Fuel n est pas l application que tu ouvres pour rouler. Maps est la surface. Le GPS vit dans com.gasoiltracking.app via gasoiltracking://trip/control?silent=1 puis retour hubera-maps://fuel. Maps 0.1.34 avait deja: HUD live km/duree, croix qui ne cloture pas, plus de hop Fuel a chaque poll historique. 0.1.35 n a pas recasse ce flux.'
);
h3('Fuel 1.4.156 (deja overlay ce matin)');
bullets([
  'mapsTripControl emet started/km vers Maps.',
  'Ecran control: spinner encore present sur le hop start/stop (le View transparent a ete code apres le bundle 1.4.156).',
  'Historique Maps: cache local + bouton Actualiser (opt-in). Plus de fuelControl(history) toutes les 10 s.',
  'Dernier trajet Guerche -> Domicile 28.4 km toujours dans la liste (reconstruction 1.4.155).',
]);
shot('Blackview 21h08 — Trajets Fuel in-Maps', 'maps-fuel-tab-2026-09-28.png');
para(
  'Visible: Trajets Fuel, copie tu restes dans Maps, Ouvrir Fuel / Actualiser / Suivi libre, 9.4 km Thorigné, 28.4 km Guerche -> Domicile, 43.4 km Thorigné -> Guerche. Chip Maison Rennes. Guidage non lance. Fuel FGS Location absente apres les tests.'
);

h2('4. Music (volontairement non overlay)');
para(
  'Source HuberaMusic prod cf4a42a: paroles plus compactes (NowPlaying text-xl/2xl, Android FocusLyricLine 20.sp 2 lignes) et LibraryScreen utilise data.totalSongs. API serveur deja 1.3.318. Les telephones restent p+1.3.317 parce que le dock Maps montrait Signs / Tate McRae en pause: overlay -r tuerait la session. forceUpdate reste false. MusicBridge Maps non touche par SuiteBridge.'
);

h2('5. Suite Mail Drive Contacts Calendar Pass');
table(
  ['Hote', 'HTTP', 'APK BV', 'Git', 'Note'],
  [
    ['mail.hubera.cloud', '302', '1.0.1', '42406d8', 'HTML lisible, Cc SMTP, timeout 20 s'],
    ['drive.hubera.cloud', '302', '1.0.1', '6ef67a9', 'Rename, timeout 20 s'],
    ['contacts.hubera.cloud', '302', '0.1.1', '1b0537a', 'Adresses lues par Maps 0.1.35'],
    ['calendar.hubera.cloud', '302', '0.1.1', '10b0451', 'PUT COALESCE lieu/description'],
    ['pass.hubera.cloud', '302', '0.1.1', '(deja)', 'Coffre intact, crypto v1'],
    ['id.hubera.cloud', '200', '-', '-', 'Owner paul@'],
    ['maps.hubera.cloud', '200', '0.1.35', 'ef69921 + local 0.1.35', 'APK WebView ovh.delhomme.maps'],
    ['music.hubera.cloud', '200', 'p+1.3.317', 'cf4a42a', 'forceUpdate false'],
  ],
  [1.35, 0.45, 0.7, 0.9, 1.7]
);
para(
  '302 = redirection vers /app/... (login), c est le comportement sain de la suite SPA. Tests API owner sur :6002 (sans afficher de secret): login 200, calendriers, create event 201, PUT La Guerche + refetch COALESCE, delete 204. Drive dossier cree/renomme/supprime. Contacts extra emails + adresse magasin. Mail 1 compte. Calendar-service recree il y a ~3 h, healthy. Mail-directory-service ~6 h, healthy. Postgres Cloudity up 9 jours, volume intact.'
);
callout(
  'Login web public Calendar / Mail',
  'POST https://calendar.hubera.cloud/auth/login sans tenant_id -> 400 TenantID required. Avec tenant_id=1 et identifiants bidon -> 401 invalid credentials (donc le champ est bien le bloqueur). Le source Vite (localhost:6001, HMR) envoie tenant_id=1. Le bundle public OpenResty /assets/main-KeQQDRlK.js n est pas ce Vite. A republier au prochain build cloudity-web production. On n a pas recree cloudity-web (up 9 jours, volume node_modules_cache).',
  '#b45309'
);

h2('6. Git pousse vs local');
table(
  ['Repo', 'Branche', 'HEAD pousse', 'Ce soir'],
  [
    ['CloudityMaps', 'main', 'ef69921 0.1.34 HUD Fuel', '0.1.35 overlay, working tree sale'],
    ['HuberaFuel', 'prod', 'dc64d25 1.4.156', 'propre'],
    ['HuberaMusic', 'prod', 'cf4a42a paroles', 'propre, APK non force'],
    ['Cloudity', 'chore/restructure-platform', '1acdd963 PUT/Cc/rename/tenant', 'web Vite local, public hashe ancien'],
    ['HuberaMail', 'main', '42406d8', 'propre'],
    ['HuberaDrive', 'main', '6ef67a9', 'propre'],
    ['HuberaCalendar', 'main', '10b0451', 'propre'],
    ['HuberaContacts', 'main', '1b0537a', 'propre'],
  ],
  [1.2, 1.15, 1.5, 1.4]
);
note(
  'Maps 0.1.35 (SuiteBridge, network_security_config, app.js Contacts, gradle 37) est installe sur les deux telephones. Commit/push non fait: ce message ne le demandait pas. Dis-le pour add/commit/push CloudityMaps.'
);

h2('7. Appareils (dumpsys, sans clavier)');
table(
  ['Package', 'Samsung', 'Blackview'],
  [
    ['ovh.delhomme.maps', '0.1.35 vc 37', '0.1.35 vc 37'],
    ['com.gasoiltracking.app', '1.4.156 vc 180', '1.4.156 vc 180'],
    ['ovh.delhomme.ytmusic', 'p+1.3.317 (non lance)', 'p+1.3.317 dock pause'],
    ['fr.cloudity.cloudity_contacts', '(overlay 0.1.1 deja)', '0.1.1'],
    ['fr.cloudity.cloudity_mail', '(overlay 1.0.1 deja)', '1.0.1'],
    ['fr.cloudity.cloudity_drive', '(overlay 1.0.1 deja)', '1.0.1'],
    ['fr.cloudity.cloudity_calendar', '(overlay 0.1.1 deja)', '0.1.1'],
    ['com.cloudity.cloudity_pass', '(overlay 0.1.1 deja)', '0.1.1'],
  ],
  [2.1, 1.3, 1.4]
);
para(
  'Samsung: dumpsys Maps/Fuel seulement, app non relancee (clavier). Nothing non utilise. Volume media non touche. STREAM_UPSTREAM offline = normal.'
);

h2('8. Chronologie 28 sept (rappel compact)');
bullets([
  'Matin: Fuel 1.4.155 reconstruction trajet 12h43 Intermarche La Guerche -> Domicile. Puis 1.4.156 started/km.',
  'Maps 0.1.32 puis 0.1.34: suivi libre in-app, historique Trajets, TTS mute, HUD live, croix != Arreter, plus de splash Fuel sur poll.',
  'Music source paroles/totaux, git pousse, telephones 1.3.317.',
  'Suite Wave 1: health nginx, overlay Mail/Drive/Contacts/Calendar, PUT Calendar, Cc Mail, rename Drive, login tenant_id dans api.ts.',
  'Git push vague precedente: Maps ef69921, Fuel dc64d25, Music cf4a42a, Cloudity 1acdd963, Mail/Drive/Calendar/Contacts main.',
  'Soir: Maps 0.1.35 Contacts + JWT owner + preuves Enregistres/Trajets. Recap PDF ci-joint.',
]);

h2('9. Reste volontairement ouvert');
bullets([
  'Pieces jointes MIME Mail, FCM push, partage Drive, invitations Calendar (Wave 2).',
  'Republier le bundle public cloudity-web (tenant_id) sans recreer postgres / down -v.',
  'Unifier JWT public contacts.hubera.cloud vs gateway LAN, ou garder le LAN depuis Maps.',
  'Overlay Music paroles compactes quand plus rien n ecoute.',
  'Commit/push Maps 0.1.35 si tu le demandes.',
  'Spinner Fuel control.tsx transparent: code source pret, bundle APK 1.4.156 encore avec spinner sur le hop.',
]);

h2('10. Volumes, packages, signatures');
para(
  'Aucun compose down -v. Volumes gasoil_api_data, ytmusic_ytmusic_data, postgres Cloudity, node_modules_cache intacts. applicationId inchanges: Fuel com.gasoiltracking.app, Maps ovh.delhomme.maps (pas Expo cloud.hubera.maps), Music ovh.delhomme.ytmusic, suite fr.cloudity.cloudity_*, Pass com.cloudity.cloudity_pass. Maps APK signe debug.keystore 3cf6c532... Fuel EAS 13c3be90...'
);
note('Aucun mot de passe, JWT ou secret .env dans ce PDF. Token temporaire /tmp/maps-auth-token.txt supprime apres usage.');

const pages = writeFooters('Hubera — recap 28 sept 2026 Maps 0.1.35');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
