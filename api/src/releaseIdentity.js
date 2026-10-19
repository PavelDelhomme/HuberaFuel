/**
 * Identité d’une release Fuel (paquet, hôte, nom d’app).
 * Le contrôle CI refuse un nom étranger. Il accepte le paquet actuel,
 * l’hôte actuel, et le paquet legacy déjà installé.
 */
export const FUEL_RELEASE_HOST = 'fuel.hubera.cloud';
export const FUEL_RELEASE_NAME = 'Hubera Fuel';
export const FUEL_RELEASE_PACKAGES = Object.freeze([
  'cloud.hubera.fuel',
  'com.gasoiltracking.app',
]);
export const FUEL_RELEASE_HOSTS = Object.freeze([
  'fuel.hubera.cloud',
  'gasoil-tracking.hubera.cloud',
  'gasoil-tracking.delhomme.ovh',
]);

export function fuelReleaseAllowlist() {
  return {
    packages: [...FUEL_RELEASE_PACKAGES],
    hosts: [...FUEL_RELEASE_HOSTS],
    names: [FUEL_RELEASE_NAME],
  };
}

function normalizeHost(host) {
  return String(host || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

/** null si l’identité est acceptée, sinon le motif de refus. */
export function fuelReleaseIdentityError({ packageName, host, appName } = {}) {
  const allow = fuelReleaseAllowlist();
  if (packageName != null && String(packageName) !== '') {
    if (!allow.packages.includes(String(packageName))) {
      return `package refusé : ${packageName}`;
    }
  }
  if (host != null && String(host) !== '') {
    const h = normalizeHost(host);
    if (!allow.hosts.includes(h)) {
      return `hôte refusé : ${h}`;
    }
  }
  if (appName != null && String(appName) !== '') {
    if (!allow.names.includes(String(appName))) {
      return `nom d’app refusé : ${appName}`;
    }
  }
  return null;
}

export function acceptFuelReleaseIdentity(input) {
  return fuelReleaseIdentityError(input) == null;
}
