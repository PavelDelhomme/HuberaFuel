'use strict';
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { bindPdfHelpers } = require('../pdfkit-safe');

const OUT_NAME = process.env.REPORT_OUT || 'Hubera-2026-10-13-validation-manuelle.pdf';
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
  info: { Title: 'Hubera — validation manuelle 13 oct 2026', Author: 'Hubera' },
});
const stream = fs.createWriteStream(out);
doc.pipe(stream);
const { ACCENT, DARK, LEFT, WIDTH, h2, para, note, bullets, callout, kvList, table, writeFooters } =
  bindPdfHelpers(doc);

doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
doc.moveDown(1);
doc.font('Helvetica-Bold').fontSize(16).fillColor(DARK).text('Hubera — à valider', LEFT(), doc.y, { width: WIDTH() });
para('13 octobre 2026. Tu coches dans Hubera Docs (kanban). Fait = geste réel OK. À faire = pas encore, ou non.');
callout('Pas clos par l’agent', 'Le relevé ADB donne les versions installées. Il ne remplace pas un geste dans l’app.', ACCENT);
kvList([
  ['Où cocher', 'docs.hubera.cloud — colonne À faire → Fait'],
  ['Téléphones', 'Samsung R5CT7263YJL et Blackview BV9700'],
  ['Nothing', 'Pas d’ADB. Sideload seulement.'],
  ['OTA', 'Jamais forcée'],
]);

h2('1. Versions vues sur les téléphones');
table(
  ['App', 'Samsung', 'Blackview'],
  [
    ['Music', '10669', '10669'],
    ['Maps', '95', '95'],
    ['Fuel', '197', '197'],
    ['Notes', '7', '7'],
    ['Photos', '13', '13'],
    ['Tasks', '5', '5'],
    ['Contacts', '5', '5'],
    ['Mail', '6', '5'],
    ['Drive', '7', '5'],
    ['Pass', '5', '3'],
    ['Calendar', '8', '5'],
    ['Cook', '5', '4'],
    ['Docs', '210', '209'],
    ['Jobs', '60', '58'],
    ['ID', '103', 'absent'],
    ['Office', '101', 'absent'],
    ['Stream', 'absent', 'absent'],
  ],
  [1.2, 1, 1],
);

h2('2. Mail — lenteur');
para('Correctif dans le code : la dernière liste s’affiche avant le réseau, la synchro IMAP attend 8 secondes et ne vide pas l’écran. Le premier lancement sans cache attend encore le serveur. Rien n’est installé sur le Nothing ni reconstruit en APK. À cocher seulement après une nouvelle installation.');
bullets([
  'Deuxième ouverture : liste précédente tout de suite.',
  'Changement de dossier et rafraîchissement : la liste ne disparaît pas.',
  'Ouvrir un mail puis revenir : pas un rechargement complet.',
  'Mot de passe IMAP une seule fois. Nom du contact. Envoi hors-ligne unique.',
]);

h2('3. Music, Maps, Fuel');
bullets([
  'Music : lecture, pause, suivant, file, titre chaud en avion, notif verrouillée, OTA Plus tard, chip compte.',
  'Maps : guidage sombre, voix au retour, duck Music, lieu Contacts, GPS refusé, retour ne quitte pas.',
  'Fuel 206 grise : 50,12 EUR, environ 20 L, 1,990 EUR/L n’est pas un plein. Bouchon décoché.',
  'Fuel : litres au-dessus de la capacité → Corriger, Réajuster, ou Jauge = litres saisis.',
  'Fuel : arrêt trajet retire la notif. Essence basse : encore N allers-retours Domicile / Travail.',
]);

h2('4. Drive, Calendar, Photos, Tasks, Jobs');
bullets([
  'Drive : liste tout de suite, upload repris sans doublon, partage Hubera ou lien, corbeille.',
  'Calendar : bouton +, vues dans le menu, lieu Maps et Contacts, rappel, journée vide.',
  'Photos : import, album, corbeille, partage, recherche, permission refusée sans boucle.',
  'Tasks : créer, cocher, échéance, rappel à 1 minute, hors-ligne sans doublon.',
  'Jobs : notif, import Contacts, créer un contact depuis un candidat.',
]);

h2('5. Notes, Office, Pass, ID, Docs');
bullets([
  'Notes : note, liste, rappel, recherche, épingle, archive, brouillon après kill.',
  'Office : Samsung seulement. Créer, quitter sans sauver, un seul brouillon hors-ligne.',
  'Pass : empreinte ou PIN 6 chiffres, mot de passe complet périodique, copie discrète.',
  'ID : connexion, passkey, pas les réglages des autres apps. Absent du Blackview.',
  'Docs : passer une carte À faire vers Fait, puis la remettre. Ouvrir ce rapport.',
]);

h2('6. Grille commune');
para('Pour chaque app : deuxième compte, jeton expiré, OTA Plus tard, retour qui ne quitte pas, hors-ligne sans doublon, permission refusée sans boucle, liste vide et liste longue.');

h2('7. Ancien relevé Mail Drive Notes Pass Photos');
bullets([
  'Mail : liste tout de suite, mot de passe IMAP une fois, pas de spinner plein écran, nom du contact.',
  'Drive : upload repris sans doublon, partage Hubera ou lien, corbeille.',
  'Notes : FAB note / liste / rappel, notif à 1 minute, hors-ligne sans doublon.',
  'Pass : empreinte ou PIN 6 chiffres, mot de passe complet de temps en temps, copie discrète.',
  'Photos : import, album, corbeille, partage, recherche, permission refusée sans boucle.',
]);

h2('8. Office, Stream, Taskflow, reste');
bullets([
  'Office : Samsung seulement. Créer, quitter sans sauver, export, un seul brouillon hors-ligne.',
  'Stream : pas installé. Lecture, cache, coupure réseau, focus audio avec Music.',
  'Taskflow : créer, cocher, échéance, rappel, filtre faites.',
  'Contacts, Calendar (FAB, drawer), Cook en français, Jobs, Budget, ID, Docs.',
]);

h2('9. Blackview avant de cocher');
para('Aligner Mail, Drive, Pass, Calendar, Cook, Docs, Jobs. Installer ID, Office et Stream. Overlay -r. OTA jamais forcée.');
h2('10. Mesures am start -W (APK déjà installés, pas le code de ce soir)');
para('TotalTime au froid après force-stop. Le chaud ne renvoie pas TotalTime : l’activité est déjà devant. Ce n’est pas le temps jusqu’à la liste.');
table(
  ['App', 'Samsung froid', 'Blackview froid'],
  [
    ['Mail', '0 ms (déjà là)', '359 ms'],
    ['Drive', '364 ms', '420 ms'],
    ['Photos', '872 ms', '527 ms'],
    ['Calendar', '383 ms', '496 ms'],
    ['Contacts', '757 ms', '547 ms'],
    ['Notes', '425 ms', '521 ms'],
    ['Tasks', '1873 ms', '5086 ms'],
    ['Pass', '845 ms', '5895 ms'],
    ['Cook', '772 ms', '557 ms'],
    ['Admin', '461 ms', '561 ms'],
    ['Fuel', '1092 ms', '2410 ms'],
    ['Maps', '754 ms', '1571 ms'],
    ['Music', '2641 ms', '9613 ms'],
  ],
  [1.2, 1, 1],
);
h2('11. Ce que l’écran montrait (Samsung)');
bullets([
  'Mail : dialogue notifications (Autoriser / Ne pas autoriser), pas la liste. L’APK installé demande encore la permission tout de suite.',
  'Drive et Photos : dump UI en échec (pont accessibilité null) juste après Mail.',
  'Calendar : menu, Agenda, Vue, Aujourd’hui, mois précédent.',
  'Contacts : menu, Contacts, Créer.',
  'Notes : menu, Rechercher, aucune note, Créer.',
  'Tasks : aucune tâche, Créer.',
  'Pass : Déverrouiller le coffre, Se déconnecter.',
  'Cook : frigo vide, Ajouter.',
  'Admin et Maps : presque aucun libellé (WebView ou écran vide).',
  'Fuel : trajet, Peugeot 208, synchro, jauge, conso 5.6 L/100.',
]);
h2('12. Correctifs poussés, pas encore sur les téléphones');
bullets([
  'Cloudity 419bfbbc : session locale sans refresh bloquant, cache liste Notes / Contacts / Calendar / Tasks.',
  'HuberaMail 5b405c9 : cache liste, IMAP après 8 s.',
  'HuberaDrive 28b8721 : cache racine.',
  'Photos avait déjà un cache timeline dans le source. Pas de nouvel APK. Nothing : pas d’ADB.',
]);
note('Les boutons n’ont pas été tous actionnés : ouvrir, envoyer ou supprimer sur le compte réel n’a pas été fait. Les cartes Docs restent À faire.');

const pages = writeFooters('Hubera — tests 13 oct 2026');
doc.end();
stream.on('finish', () => {
  const st = fs.statSync(out);
  console.log(JSON.stringify({ ok: true, out, kb: Math.round(st.size / 1024), pages }));
});
stream.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
