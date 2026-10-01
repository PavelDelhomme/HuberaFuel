import { describe, expect, it } from 'vitest';
import { normalizeFuelPackage, pickLatestRelease, FUEL_PKG_HUBERA, FUEL_PKG_LEGACY } from './semver.js';

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
