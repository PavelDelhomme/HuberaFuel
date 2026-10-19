import { describe, expect, it } from 'vitest';
import {
  acceptFuelReleaseIdentity,
  fuelReleaseIdentityError,
  FUEL_RELEASE_HOST,
  FUEL_RELEASE_NAME,
} from './releaseIdentity.js';

describe('contrôle identité release Fuel', () => {
  it('accepte cloud.hubera.fuel et fuel.hubera.cloud', () => {
    expect(
      acceptFuelReleaseIdentity({
        packageName: 'cloud.hubera.fuel',
        host: FUEL_RELEASE_HOST,
        appName: FUEL_RELEASE_NAME,
      })
    ).toBe(true);
    expect(fuelReleaseIdentityError({ host: 'https://fuel.hubera.cloud/api/version' })).toBeNull();
  });

  it('accepte encore le paquet legacy déjà utilisé', () => {
    expect(
      acceptFuelReleaseIdentity({
        packageName: 'com.gasoiltracking.app',
        host: 'fuel.hubera.cloud',
        appName: 'Hubera Fuel',
      })
    ).toBe(true);
  });

  it('refuse un nom vraiment étranger', () => {
    expect(
      acceptFuelReleaseIdentity({
        packageName: 'cloud.hubera.music',
        host: 'music.hubera.cloud',
        appName: 'Hubera Music',
      })
    ).toBe(false);
    expect(fuelReleaseIdentityError({ packageName: 'com.example.foreign' })).toMatch(/package refusé/);
    expect(fuelReleaseIdentityError({ host: 'example.com' })).toMatch(/hôte refusé/);
    expect(fuelReleaseIdentityError({ appName: 'Autre application' })).toMatch(/nom d’app refusé/);
  });
});
