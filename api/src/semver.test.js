import { describe, expect, it } from 'vitest';
import {
  normalizeFuelPackage,
  pickLatestRelease,
  offerPublishedApk,
  FUEL_PKG_HUBERA,
  FUEL_PKG_LEGACY,
} from './semver.js';

describe('OTA package isolation', () => {
  it('sans hint → ancien package (jamais Hubera sur l’id legacy)', () => {
    expect(normalizeFuelPackage('')).toBe(FUEL_PKG_LEGACY);
    expect(normalizeFuelPackage('cloud.hubera.fuel')).toBe(FUEL_PKG_HUBERA);
  });

  it('ne sert pas l’APK Hubera aux clients gasoiltracking', () => {
    const rows = [
      { version: '1.4.163', version_code: 187, apk_filename: 'legacy.apk', package_name: FUEL_PKG_LEGACY, id: 1 },
      { version: '1.4.164', version_code: 188, apk_filename: 'hubera.apk', package_name: FUEL_PKG_HUBERA, id: 2 },
    ];
    expect(pickLatestRelease(rows).apk_filename).toBe('legacy.apk');
    expect(pickLatestRelease(rows, FUEL_PKG_HUBERA).apk_filename).toBe('hubera.apk');
  });
});

describe('offerPublishedApk', () => {
  const latest = { version: '1.4.180', version_code: 204, apk_filename: 'fuel.apk' };

  it('propose l’APK à un client 1.4.179 / 203', () => {
    expect(offerPublishedApk(latest, '1.4.179', 203)).toBe(true);
  });

  it('ne repropose pas l’APK à un client déjà en 1.4.180 / 204', () => {
    expect(offerPublishedApk(latest, '1.4.180', 204)).toBe(false);
    expect(offerPublishedApk(latest, '1.4.181', 205)).toBe(false);
  });

  it('propose encore sans indice de version client', () => {
    expect(offerPublishedApk(latest, '', 0)).toBe(true);
  });
});
