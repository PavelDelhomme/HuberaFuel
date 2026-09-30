/**
 * Variantes d’application installables en parallèle (package Android distinct =
 * stockage / session distincts). Piloté par APP_FLAVOR.
 *
 * Comptes labo (Nothing / Blackview) :
 *   prod|preprod|dev|feat → compte perso (paveldelhomme@gmail.com) par défaut
 *   admin                 → admin@delhomme.ovh
 *   qa                    → qa.lab@maily.ovh
 */
'use strict';

/** @typedef {'prod'|'preprod'|'dev'|'feat'|'qa'|'admin'} AppFlavor */

/** @type {Record<AppFlavor, {
 *   name: string,
 *   shortName: string,
 *   scheme: string,
 *   androidPackage: string,
 *   iosBundle: string,
 *   followsProdOta: boolean,
 *   defaultLoginEmail: string,
 *   roleLabel: string,
 *   accentHint: string,
 * }>} */
const FLAVORS = {
  prod: {
    name: 'Hubera Fuel',
    shortName: 'Fuel',
    scheme: 'gasoiltracking',
    androidPackage: 'com.gasoiltracking.app',
    iosBundle: 'com.gasoiltracking.app',
    followsProdOta: true,
    defaultLoginEmail: 'paveldelhomme@gmail.com',
    roleLabel: 'Production utilisateurs (compte perso)',
    accentHint: '#c73a52',
  },
  preprod: {
    name: 'Fuel Preprod',
    shortName: 'Préprod',
    scheme: 'gasoiltracking-preprod',
    androidPackage: 'com.gasoiltracking.preprod',
    iosBundle: 'com.gasoiltracking.preprod',
    followsProdOta: false,
    defaultLoginEmail: 'paveldelhomme@gmail.com',
    roleLabel: 'Stable avancé — juste avant prod',
    accentHint: '#0d9488',
  },
  dev: {
    name: 'Fuel Dev',
    shortName: 'Dev',
    scheme: 'gasoiltracking-dev',
    androidPackage: 'com.gasoiltracking.dev',
    iosBundle: 'com.gasoiltracking.dev',
    followsProdOta: false,
    defaultLoginEmail: 'paveldelhomme@gmail.com',
    roleLabel: 'Développement / branche active',
    accentHint: '#2563eb',
  },
  feat: {
    name: 'Fuel Feat',
    shortName: 'Feat',
    scheme: 'gasoiltracking-feat',
    androidPackage: 'com.gasoiltracking.feat',
    iosBundle: 'com.gasoiltracking.feat',
    followsProdOta: false,
    defaultLoginEmail: 'paveldelhomme@gmail.com',
    roleLabel: 'Branche feature expérimentale',
    accentHint: '#7c3aed',
  },
  qa: {
    name: 'Fuel QA',
    shortName: 'QA',
    scheme: 'gasoiltracking-qa',
    androidPackage: 'com.gasoiltracking.qa',
    iosBundle: 'com.gasoiltracking.qa',
    followsProdOta: false,
    defaultLoginEmail: 'qa.lab@maily.ovh',
    roleLabel: 'Compte QA labo jetable',
    accentHint: '#ca8a04',
  },
  admin: {
    name: 'Fuel Admin',
    shortName: 'Admin',
    scheme: 'gasoiltracking-admin',
    androidPackage: 'com.gasoiltracking.admin',
    iosBundle: 'com.gasoiltracking.admin',
    followsProdOta: false,
    defaultLoginEmail: 'admin@delhomme.ovh',
    roleLabel: 'Compte admin@delhomme.ovh',
    accentHint: '#334155',
  },
};

/**
 * @param {string} [raw]
 * @returns {AppFlavor}
 */
function normalizeFlavor(raw) {
  const k = String(raw || process.env.APP_FLAVOR || 'prod')
    .toLowerCase()
    .trim();
  if (Object.prototype.hasOwnProperty.call(FLAVORS, k)) return /** @type {AppFlavor} */ (k);
  return 'prod';
}

/**
 * @param {string} [raw]
 */
function resolveFlavor(raw) {
  const key = normalizeFlavor(raw);
  return { key, ...FLAVORS[key] };
}

module.exports = { FLAVORS, normalizeFlavor, resolveFlavor };
