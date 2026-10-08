/**
 * Contenu Aide — orienté utilisateur, catégorisé.
 * Pas de jargon technique inutile ; les comportements « normaux » sont listés à part.
 */

export type HelpArticle = {
  id: string;
  title: string;
  body: string;
  /** Lien interne expo-router optionnel */
  link?: { label: string; href: string };
};

export type HelpCategory = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  articles: HelpArticle[];
};

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'start',
    title: 'Démarrer',
    subtitle: 'Compte, premier véhicule, idées de base',
    icon: 'rocket-outline',
    articles: [
      {
        id: 'what',
        title: 'À quoi sert Hubera Fuel ?',
        body:
          'Suivre vos trajets (GPS), estimer la consommation et le coût, enregistrer vos pleins, suivre un budget carburant, et garder l’historique sur le téléphone et (si vous êtes connecté) sur le cloud.',
      },
      {
        id: 'account',
        title: 'Créer un compte / se connecter',
        body:
          'Ouvrez le menu (☰) → Connexion. Après inscription, validez l’e-mail si demandé. Sans compte, tout reste en local sur l’appareil. Avec compte, vous pouvez synchroniser et retrouver vos données sur le site.',
        link: { label: 'Ouvrir la connexion', href: '/auth' },
      },
      {
        id: 'first-vehicle',
        title: 'Ajouter mon premier véhicule',
        body:
          'Onglet Mon Garage → ajouter. Choisissez un modèle du catalogue (conso / réservoir indicatifs) ou saisissez à la main. Activez le véhicule que vous utilisez : c’est lui qui reçoit trajets et pleins.',
        link: { label: 'Mon Garage', href: '/(tabs)/vehicles' },
      },
      {
        id: 'menu',
        title: 'Où trouver quoi ?',
        body:
          'Accueil : résumé et jauge. Garage : véhicules. Pleins : historique carburant. Maps : recherche d’adresse, lieux & récents, suivi libre. Budget : enveloppes et prix stations. Menu ☰ : compte, historique des trajets, aide, mises à jour.',
      },
    ],
  },
  {
    id: 'vehicles',
    title: 'Véhicules & conso',
    subtitle: 'Garage, jauge, masse / SCx, VIN',
    icon: 'car-outline',
    articles: [
      {
        id: 'gauge',
        title: 'Jauge de carburant',
        body:
          'La jauge est une estimation : elle baisse avec les trajets et remonte aux pleins. Au départ d’un trajet, vous pouvez l’ajuster. Valider la jauge compare la conso observée au modèle de cette voiture (facteur + L/100) et synchronise le cloud si vous êtes connecté. Chaque véhicule garde un historique des jauges (départ/arrivée, pleins, saisies).',
        link: { label: 'Accueil', href: '/(tabs)' },
      },
      {
        id: 'physics',
        title: 'Masse, SCx, boîte — à quoi ça sert ?',
        body:
          'Ces champs affinent l’estimation de conso (modèle physique) quand un tracé GPS existe. La « boîte » (nombre de rapports) influence seulement le rendement approximatif, pas une carte des vitesses. Si vous ne savez pas : laissez les suggestions du catalogue.',
      },
      {
        id: 'vin',
        title: 'VIN (optionnel)',
        body:
          'Dans Modifier le véhicule, vous pouvez saisir le VIN (17 caractères, carte grise). Le bouton « Enrichir » tente de préremplir masse / SCx via catalogue local (et Autoref si une clé API est configurée). Le Cx n’est presque jamais fourni automatiquement.',
      },
      {
        id: 'odometer',
        title: 'Compteur HS ou illisible',
        body:
          'Désactivez « compteur fiable » : les km viennent alors surtout des trajets GPS (tracked km). Utile sur les vieux véhicules.',
      },
      {
        id: 'multi',
        title: 'Plusieurs voitures',
        body:
          'Ajoutez chaque véhicule, puis sélectionnez celui qui est actif avant de démarrer un trajet ou d’ajouter un plein. L’historique peut aussi filtrer « Toutes ».',
      },
    ],
  },
  {
    id: 'trips',
    title: 'Trajets & navigation',
    subtitle: 'Suivi libre, navigation, Maps, historique',
    icon: 'navigate-outline',
    articles: [
      {
        id: 'free',
        title: 'Suivi libre (recommandé au quotidien)',
        body:
          'Pas de destination : l’app enregistre le GPS, la distance, la conso estimée. Sur la carte : panneau de limitation (si connu) + niveau d’essence en direct. Boutons : Plein, Pause, Terminer — puis les stats, et « Suivi en cours » en bas.',
        link: { label: 'Ouvrir Maps', href: '/(tabs)/maps' },
      },
      {
        id: 'nav',
        title: 'Navigation vers une destination',
        body:
          'Depuis Maps : barre « Tapez une adresse… » en haut, ou un lieu / récent. L’itinéraire proposé par défaut est l’éco (conso). Le guidage reste sur l’écran trajet. Astuce : « Intermarché » n’est plus confondu avec le lieu Travail.',
      },
      {
        id: 'maps-tab',
        title: 'Onglet Maps',
        body:
          'Entrée principale navigation : recherche d’adresse à côté du menu, lieux Maison/Travail & récents, démarrage suivi libre. L’ancien onglet Trajet n’est plus dans la barre (écran conservé pour le guidage en cours et l’historique).',
        link: { label: 'Maps', href: '/(tabs)/maps' },
      },
      {
        id: 'history',
        title: 'Historique des trajets',
        body:
          'Menu ☰ → Historique des trajets, ou bouton Historique sur Maps (trajets du jour, véhicule sélectionné). Accueil : carte « Aujourd’hui » (km / nb trajets), « Distance » (tous trajets), ou « Depuis le plein ». Filtres : Aujourd’hui · Depuis le dernier plein · Tout.',
        link: { label: 'Ouvrir l’historique du jour', href: '/(tabs)/trip?tab=history&filter=today' },
      },
      {
        id: 'pause-fill',
        title: 'Pause et plein pendant un trajet',
        body:
          'Pause : le GPS ne compte plus. « Plein » en pause ouvre l’ajout de plein lié au trajet. Terminer : arrêt définitif + récap.',
      },
      {
        id: 'permissions',
        title: 'Permission localisation',
        body:
          'Autorisez la position (et si proposé, l’arrière-plan) pour un suivi fiable. Sans GPS, distance et conso seront peu fiables.',
      },
    ],
  },
  {
    id: 'fillups',
    title: 'Pleins',
    subtitle: 'Saisie, tickets, stations',
    icon: 'water-outline',
    articles: [
      {
        id: 'add-fill',
        title: 'Enregistrer un plein',
        body:
          'Nouveau plein : la station la plus proche est proposée (choix si plusieurs au même endroit). Champs verrouillés + crayon pour éviter les erreurs. Prix au litre en -- auto avec le €/L affiché en dessous. Les litres sont plafonnés à la place libre estimée (+ marge).',
        link: { label: 'Pleins', href: '/(tabs)/fillups' },
      },
      {
        id: 'stations-prices',
        title: 'Prix des stations (France)',
        body:
          'Les prix open data (gouvernement) sont dispo en France. Hors France : saisie manuelle. Dans Budget vous pouvez aussi explorer les stations autour de vous.',
      },
      {
        id: 'low-fuel',
        title: 'Essence basse au démarrage',
        body:
          'Si le niveau est bas (ou si la destination dépasse l’autonomie), l’app prévient avant de démarrer — suivi libre comme navigation. Elle propose la station la moins chère encore joignable avec le carburant restant. Vous pouvez y aller, démarrer sans, ou annuler.',
      },
    ],
  },
  {
    id: 'budget',
    title: 'Budget',
    subtitle: 'Enveloppes, lieux, stations',
    icon: 'wallet-outline',
    articles: [
      {
        id: 'budget-basic',
        title: 'Créer un budget',
        body:
          'Fixez un montant et une période. Les dépenses (pleins / coûts estimés) s’accumulent. Les seuils peuvent déclencher des rappels si activés.',
        link: { label: 'Budget', href: '/(tabs)/budget' },
      },
      {
        id: 'places',
        title: 'Lieux Maison / Travail',
        body:
          'Dans Budget → Lieux, définissez Maison et Travail (adresse ou GPS). Swipe ← pour modifier, → pour supprimer (confirmation). Flèches ↑↓ pour réordonner. Ces lieux alimentent Maps, suggestions et trajets programmés.',
      },
      {
        id: 'scheduled',
        title: 'Trajets programmés',
        body:
          'Menu ☰ → Trajets programmés (aussi dans Budget). Ex. Domicile → Travail × 5 j/sem. Sert aux estimations budget et aux suggestions « trajet habituel ». Swipe pour modifier / supprimer.',
        link: { label: 'Trajets programmés', href: '/scheduled-trips' },
      },
      {
        id: 'theme-pref',
        title: 'Mode clair / sombre',
        body:
          'Le thème se règle dans le menu ☰ → Préférences (plus dans la barre du haut), pour laisser la place à la recherche d’adresse sur Maps. La sync cloud reste l’icône en haut à droite.',
      },
    ],
  },
  {
    id: 'tutorial',
    title: 'Parcours guidé',
    subtitle: 'Première utilisation pas à pas',
    icon: 'school-outline',
    articles: [
      {
        id: 'tuto-1',
        title: 'Étape 1 — Compte & sync',
        body:
          'Créez un compte (ou connectez-vous) via ☰. Validez l’e-mail si demandé. L’icône sync en haut à droite pousse/tire le cloud. Sans compte, tout reste local sur le téléphone.',
        link: { label: 'Connexion', href: '/auth' },
      },
      {
        id: 'tuto-2',
        title: 'Étape 2 — Véhicule actif',
        body:
          'Mon Garage → ajoutez votre voiture (catalogue ou manuel). Sélectionnez-la comme active : tous les trajets et pleins s’y rattachent. Corrigez la jauge sur l’Accueil si besoin.',
        link: { label: 'Mon Garage', href: '/(tabs)/vehicles' },
      },
      {
        id: 'tuto-3',
        title: 'Étape 3 — Lieux & trajets habituels',
        body:
          'Budget → Lieux : Domicile + Travail. Puis Trajets programmés pour le trajet domicile-travail. Ainsi Maps et Accueil proposent les bons raccourcis.',
        link: { label: 'Budget', href: '/(tabs)/budget' },
      },
      {
        id: 'tuto-4',
        title: 'Étape 4 — Premier trajet',
        body:
          'Maps → tapez une adresse (autocomplétion + récents prioritaires) ou lancez un suivi libre. Choisissez l’itinéraire éco ou rapide sur la carte avant de démarrer. Terminer → récap, puis retour Maps.',
        link: { label: 'Maps', href: '/(tabs)/maps' },
      },
      {
        id: 'tuto-5',
        title: 'Étape 5 — Premier plein',
        body:
          'Pleins → Nouveau plein : station proche proposée, prix auto si connu, litres plafonnés. Un plein complet aide l’app à apprendre votre vraie conso.',
        link: { label: 'Pleins', href: '/(tabs)/fillups' },
      },
    ],
  },
  {
    id: 'sync',
    title: 'Compte, sync & mises à jour',
    subtitle: 'Cloud, OTA, plusieurs appareils',
    icon: 'cloud-outline',
    articles: [
      {
        id: 'push-pull',
        title: 'Pousser / tirer le cloud',
        body:
          'Menu ☰ : « Pousser cet appareil → cloud » envoie le téléphone comme source de vérité. « Actualiser depuis le cloud » remplace le local par le snapshot serveur. Terminez un trajet actif avant de pousser.',
      },
      {
        id: 'flavors',
        title: 'Plusieurs apps (prod / preprod / qa…)',
        body:
          'Chaque flavor Android a son propre stockage : comptes et données ne se mélangent pas. L’app « prod » est celle des utilisateurs.',
      },
      {
        id: 'ota',
        title: 'Mise à jour de l’app',
        body:
          'Menu ☰ → Vérifier / installer. Une mise à jour forcée peut s’afficher au lancement. Sur Android, l’APK s’installe dans l’app (pas besoin du Play Store).',
      },
      {
        id: 'password',
        title: 'Mot de passe oublié',
        body:
          'Sur l’écran Connexion → « Mot de passe oublié ». Vous recevez un lien unique (jeton aléatoire, ~2 h, usage unique). Une fois connecté, changez le mot de passe depuis Mon compte.',
        link: { label: 'Compte', href: '/account' },
      },
    ],
  },
];

export type KnownIssue = {
  id: string;
  title: string;
  body: string;
  kind: 'normal' | 'limit' | 'tip';
};

/** Comportements normaux / limites connues (rassurer l’utilisateur). */
export const HELP_KNOWN: KnownIssue[] = [
  {
    id: 'speed-limit-missing',
    kind: 'normal',
    title: 'Le panneau de vitesse disparaît parfois',
    body:
      'Les limitations viennent d’OpenStreetMap. Certaines routes n’ont pas de tag maxspeed, ou le serveur Overpass est saturé. L’app garde alors la dernière valeur connue plutôt que d’afficher n’importe quoi.',
  },
  {
    id: 'conso-estimate',
    kind: 'normal',
    title: 'La conso estimée ≠ ordinateur de bord',
    body:
      'C’est une estimation (GPS + modèle + vos pleins). Régler la jauge peaufine le modèle de cette voiture (conso observée vs estimée). Ça ne remplacera jamais le calculateur constructeur.',
  },
  {
    id: 'gps-noise',
    kind: 'normal',
    title: 'Petits écarts de distance GPS',
    body:
      'Sous un tunnel, en ville dense ou téléphone en poche, le GPS saute. L’app filtre une partie du bruit ; un trajet très court (< 500 m) peut être proposé à la suppression.',
  },
  {
    id: 'bg-tracking',
    kind: 'limit',
    title: 'Suivi en arrière-plan coupé par le téléphone',
    body:
      'Certains constructeurs (économiseur batterie agressif) tuent le GPS en arrière-plan. Gardez l’app ouverte ou autorisez l’activité en arrière-plan / ignorez l’optimisation batterie pour Hubera Fuel.',
  },
  {
    id: 'stations-fr',
    kind: 'limit',
    title: 'Prix stations hors France',
    body:
      'L’open data carburants officiel ne couvre que la France. Ailleurs, saisissez prix et litres à la main.',
  },
  {
    id: 'cx-api',
    kind: 'limit',
    title: 'Pas de Cx / SCx magique via Internet',
    body:
      'Aucune API gratuite fiable ne donne le SCx pour toutes les voitures. Catalogue local + saisie manuelle (et VIN optionnel pour la masse). C’est normal.',
  },
  {
    id: 'maps-vs-google',
    kind: 'tip',
    title: 'Guidage in-app vs Google Maps',
    body:
      'Le guidage dans l’app est volontairement simple (OSRM). Pour un turn-by-turn ultra détaillé, ouvrez Google Maps depuis le trajet : le suivi conso continue dans Hubera Fuel.',
  },
  {
    id: 'sync-conflict',
    kind: 'tip',
    title: 'Deux téléphones, un compte',
    body:
      'Le dernier « pousser vers le cloud » gagne. Évitez de modifier les mêmes données sur deux appareils sans sync. Préférez un appareil « principal ».',
  },
  {
    id: 'battery',
    kind: 'normal',
    title: 'La batterie baisse plus vite en trajet',
    body:
      'GPS précis + écran + éventuellement carte : c’est attendu. Branchez en voiture si possible.',
  },
];

export function filterHelp(query: string): {
  categories: HelpCategory[];
  known: KnownIssue[];
} {
  const q = query.trim().toLowerCase();
  if (!q) return { categories: HELP_CATEGORIES, known: HELP_KNOWN };
  const categories = HELP_CATEGORIES.map((cat) => ({
    ...cat,
    articles: cat.articles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        cat.title.toLowerCase().includes(q)
    ),
  })).filter((c) => c.articles.length > 0);
  const known = HELP_KNOWN.filter(
    (k) => k.title.toLowerCase().includes(q) || k.body.toLowerCase().includes(q)
  );
  return { categories, known };
}
