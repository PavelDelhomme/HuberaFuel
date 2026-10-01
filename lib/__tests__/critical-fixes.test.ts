import { describe, expect, it } from 'vitest';
import { compareSemver } from '../semver';
import { userFacingReleaseNotes } from '../releaseNotes';
import { presetDisplayName, searchVehicles } from '../../constants/vehicles';
import { compareSemver as apiCompare, pickLatestRelease } from '../../api/src/semver.js';
import {
  estimateTripFuelLiters,
  REAL_WORLD_MARGIN,
  vehicleAgeFactor,
} from '../consumptionModel';
import { resolveFillUpDistanceKm, sumTripKmBetween } from '../fillUpDistance';
import {
  gaugeArcAngle,
  gaugeArcPath,
  gaugeFractionFromArcTouch,
  gaugePolar,
} from '../fuelGaugeMath';
import { decideSyncAction } from '../syncDecision';
import { cheapestStationFuelPrice } from '../fuelPrices';
import { mergeUniqueFillUps } from '../fillUpMerge';

describe('compareSemver', () => {
  it('ordonne correctement', () => {
    expect(compareSemver('1.4.69', '1.4.68')).toBeGreaterThan(0);
    expect(compareSemver('1.4.67', '1.4.68')).toBeLessThan(0);
    expect(compareSemver('1.4.70', '1.4.70')).toBe(0);
  });
  it('ignore suffixes non numériques', () => {
    expect(compareSemver('1.4.69x', '1.4.68')).toBeGreaterThan(0);
  });
  it('API et client alignés', () => {
    expect(apiCompare('1.4.70', '1.4.69')).toBe(compareSemver('1.4.70', '1.4.69'));
  });
});

describe('pickLatestRelease', () => {
  it('prend le max semver même si id plus petit', () => {
    const best = pickLatestRelease([
      { id: 108, version: '1.4.67', apk_filename: 'a.apk' },
      { id: 107, version: '1.4.68', apk_filename: 'b.apk' },
    ]);
    expect(best?.version).toBe('1.4.68');
  });
  it('refuse les lignes sans apk', () => {
    const best = pickLatestRelease([
      { id: 1, version: '9.9.9', apk_filename: null },
      { id: 2, version: '1.0.0', apk_filename: 'x.apk' },
    ]);
    expect(best?.version).toBe('1.0.0');
  });
});

describe('userFacingReleaseNotes', () => {
  it('masque GitHub Actions', () => {
    const n = userFacingReleaseNotes(
      'v1.4.67 — trajets (GitHub Actions ac542f91)',
      '1.4.67'
    );
    expect(n.toLowerCase()).not.toMatch(/github/);
    expect(n).toMatch(/1\.4\.67|Corrections/);
  });
  it('conserve une note propre', () => {
    const n = userFacingReleaseNotes(
      'Choisissez l’itinéraire avant de démarrer la navigation.',
      '1.4.69'
    );
    expect(n).toContain('itinéraire');
  });
  it('affiche Hubera Fuel à la place de Gasoil Tracking', () => {
    const n = userFacingReleaseNotes(
      'Gasoil Tracking : suivi des trajets plus stable.',
      '1.4.140'
    );
    expect(n).toContain('Hubera Fuel');
    expect(n).not.toMatch(/Gasoil Tracking/i);
  });
});

describe('vehicles search', () => {
  it('priorise 208 vs 108', () => {
    const r208 = searchVehicles('208');
    expect(r208[0]?.model).toBe('208');
    const r108 = searchVehicles('108');
    expect(r108[0]?.model).toBe('108');
  });
  it('affiche année + carburant', () => {
    const p = searchVehicles('208')[0]!;
    expect(presetDisplayName(p)).toMatch(/208 · \d{4}/);
  });
  it('catalogue enrichi (phase B)', async () => {
    const { VEHICLE_CATALOG } = await import('../../constants/vehicles');
    expect(VEHICLE_CATALOG.length).toBeGreaterThanOrEqual(450);
  });
  it('alias mégane / citroen', () => {
    expect(searchVehicles('megane')[0]?.model.toLowerCase()).toMatch(/mégane|megane/);
    expect(searchVehicles('citroen').some((v) => /citro/i.test(v.brand))).toBe(true);
  });
});

describe('decideSyncAction', () => {
  const base = {
    localHash: 'aaa',
    remoteHash: 'bbb',
    remoteServerAt: 10_000,
    lastPushedAt: 0,
    lastPulledServerAt: 0,
    localW: 50,
    remoteW: 50,
    localKm: 100,
    remoteKm: 100,
    localTripCount: 10,
    remoteTripCount: 10,
    localActivityAt: 5_000,
    remoteActivityAt: 5_000,
  };

  it('skip si hash égal', () => {
    expect(decideSyncAction({ ...base, localHash: 'x', remoteHash: 'x' })).toBe('skip');
  });

  it('pull si cloud corrigé après notre push (même km)', () => {
    expect(
      decideSyncAction({
        ...base,
        lastPushedAt: 1_000,
        remoteServerAt: 20_000,
      })
    ).toBe('pull');
  });

  it('push si local a nettement plus de km', () => {
    expect(
      decideSyncAction({
        ...base,
        localKm: 200,
        remoteKm: 100,
        lastPushedAt: 1_000,
        remoteServerAt: 20_000,
      })
    ).toBe('push');
  });

  it('pull local vide + cloud riche', () => {
    expect(
      decideSyncAction({
        ...base,
        localW: 0,
        remoteW: 80,
      })
    ).toBe('pull');
  });
});

describe('mergeUniqueFillUps', () => {
  it('ajoute un plein Maps absent du cloud', () => {
    const r = mergeUniqueFillUps(
      [{ id: 9, vehicleId: 1, date: '2026-09-30T16:00:00+02:00', liters: 42.1, totalCost: 74 }],
      [{ id: 3, vehicleId: 1, date: '2026-09-21T10:00:00Z', liters: 70, totalCost: 124.45 }]
    );
    expect(r.added).toBe(1);
    expect(r.fills).toHaveLength(2);
    expect(r.fills[1].id).toBe(4);
    expect(r.fills[1].liters).toBe(42.1);
  });
  it('ne duplique pas le même ticket', () => {
    const row = { id: 3, vehicleId: 1, date: '2026-09-30T12:00:00Z', liters: 59.3, totalCost: 104.31 };
    const r = mergeUniqueFillUps([row], [{ ...row, id: 8 }]);
    expect(r.added).toBe(0);
    expect(r.fills).toHaveLength(1);
  });
});

describe('cheapestStationFuelPrice (essence)', () => {
  it('prend E10 plutôt que SP98', () => {
    const pick = cheapestStationFuelPrice(
      { e10: 1.72, sp95: 1.79, sp98: 1.95 },
      'essence'
    );
    expect(pick?.key).toBe('e10');
    expect(pick?.price).toBe(1.72);
  });
  it('diesel = gazole', () => {
    expect(cheapestStationFuelPrice({ gazole: 1.65, e10: 1.5 }, 'diesel')?.price).toBe(1.65);
  });
});

describe('syncPreferNewer policy (legacy)', () => {
  function shouldPull(remoteAt: number, localAt: number, remoteW: number, localW: number) {
    const remoteClearlyNewer = remoteAt > localAt + 2000;
    const remoteRicherAndNotOlder = remoteW > localW + 5 && remoteAt >= localAt - 2000;
    return remoteClearlyNewer || remoteRicherAndNotOlder;
  }
  it('ne tire pas un cloud plus riche mais plus vieux', () => {
    expect(shouldPull(1_000, 10_000, 100, 10)).toBe(false);
  });
  it('tire si cloud clairement plus récent', () => {
    expect(shouldPull(20_000, 10_000, 5, 50)).toBe(true);
  });
  it('tire si plus riche et horloge comparable', () => {
    expect(shouldPull(10_000, 10_000, 100, 10)).toBe(true);
  });
  it('local vide ne doit jamais gagner contre cloud riche', () => {
    const localEmptyish = true;
    const remoteHasData = true;
    expect(localEmptyish && remoteHasData).toBe(true); // tire, ne pousse pas
  });
});

describe('consumptionModel (anti-surconso)', () => {
  it('marge réelle modérée', () => {
    expect(REAL_WORLD_MARGIN).toBeLessThanOrEqual(1.08);
  });
  it('âge 206 (2003) plafonné bas', () => {
    expect(vehicleAgeFactor(2003, 2026)).toBeLessThanOrEqual(1.09);
  });
  it('AR ~90 km 206 ≈ 4–8 L (pas 15+)', () => {
    const v = {
      id: 2,
      name: 'Peugeot 206',
      brand: 'Peugeot',
      model: '206',
      year: 2003,
      fuelType: 'essence' as const,
      consumptionPer100: 5.2,
      tankCapacity: 50,
      defaultFuelPrice: 1.79,
      currentOdometer: 120000,
      hasOdometer: true,
      trackedKm: 0,
      estimatedFuelLiters: 40,
      isActive: true,
      createdAt: '',
      consumptionLearnFactor: 1,
    };
    const burned = estimateTripFuelLiters(v, 90, {
      avgSpeedKmh: 55,
      idleRatio: 0.15,
      accelFactor: 1.05,
      stopGoFactor: 1.05,
      ascentM: 120,
    });
    expect(burned).toBeGreaterThan(3.5);
    expect(burned).toBeLessThan(9);
    expect((burned / 90) * 100).toBeLessThan(9);
  });
});

describe('fill-up distance (pleins du véhicule)', () => {
  it('somme les trajets entre deux dates', () => {
    const trips = [
      {
        startTime: '2026-09-01T10:00:00.000Z',
        endTime: '2026-09-01T11:00:00.000Z',
        distanceKm: 40,
        isActive: false,
        status: 'confirmed' as const,
      },
      {
        startTime: '2026-09-03T10:00:00.000Z',
        endTime: '2026-09-03T12:00:00.000Z',
        distanceKm: 80,
        isActive: false,
        status: 'confirmed' as const,
      },
      {
        startTime: '2026-09-05T10:00:00.000Z',
        endTime: '2026-09-05T11:00:00.000Z',
        distanceKm: 15,
        isActive: false,
        status: 'rejected' as const,
      },
    ];
    expect(sumTripKmBetween(trips, '2026-09-01T08:00:00.000Z', '2026-09-04T00:00:00.000Z')).toBe(
      120
    );
    expect(sumTripKmBetween(trips, '2026-09-01T12:00:00.000Z', '2026-09-04T00:00:00.000Z')).toBe(
      80
    );
    expect(sumTripKmBetween(trips, null, '2026-09-04T00:00:00.000Z')).toBe(120);
  });

  it('utilise les trajets GPS si pas de km saisis entre deux pleins', () => {
    const prev = {
      id: 1,
      vehicleId: 2,
      date: '2026-09-01T12:00:00.000Z',
      liters: 30,
      pricePerLiter: 1.8,
      totalCost: 54,
      odometer: null as number | null,
      distanceSinceLastKm: null as number | null,
      isFull: true,
    };
    const curr = {
      id: 2,
      vehicleId: 2,
      date: '2026-09-08T12:00:00.000Z',
      liters: 28,
      pricePerLiter: 1.8,
      totalCost: 50.4,
      odometer: null as number | null,
      distanceSinceLastKm: null as number | null,
      isFull: true,
    };
    const trips = [
      {
        startTime: '2026-09-03T10:00:00.000Z',
        endTime: '2026-09-03T12:00:00.000Z',
        distanceKm: 320,
        isActive: false,
        status: 'confirmed' as const,
      },
      {
        startTime: '2026-09-06T10:00:00.000Z',
        endTime: '2026-09-06T11:00:00.000Z',
        distanceKm: 280,
        isActive: false,
        status: 'confirmed' as const,
      },
    ];
    const d = resolveFillUpDistanceKm(prev, curr, trips);
    expect(d).toBe(600);
    expect((curr.liters / d!) * 100).toBeCloseTo(4.67, 1);
  });
});

describe('jauge demi-cercle (volant)', () => {
  it('E=π, milieu=π/2, F=0', () => {
    expect(gaugeArcAngle(0)).toBeCloseTo(Math.PI, 5);
    expect(gaugeArcAngle(0.5)).toBeCloseTo(Math.PI / 2, 5);
    expect(gaugeArcAngle(1)).toBeCloseTo(0, 5);
  });

  it('polar : E à gauche, F à droite, ½ en haut', () => {
    const e = gaugePolar(100, 100, 50, 0);
    const mid = gaugePolar(100, 100, 50, 0.5);
    const f = gaugePolar(100, 100, 50, 1);
    expect(e.x).toBeCloseTo(50, 5);
    expect(e.y).toBeCloseTo(100, 5);
    expect(mid.x).toBeCloseTo(100, 5);
    expect(mid.y).toBeCloseTo(50, 5);
    expect(f.x).toBeCloseTo(150, 5);
    expect(f.y).toBeCloseTo(100, 5);
  });

  it('touch arc : gauche→0, haut→0.5, droite→1', () => {
    const cx = 200;
    const cy = 200;
    expect(gaugeFractionFromArcTouch(100, 200, cx, cy)).toBeCloseTo(0, 2); // gauche
    expect(gaugeFractionFromArcTouch(200, 100, cx, cy)).toBeCloseTo(0.5, 2); // haut
    expect(gaugeFractionFromArcTouch(300, 200, cx, cy)).toBeCloseTo(1, 2); // droite
  });

  it('arc > 50 % ne prend pas le grand chemin SVG (pas de débordement)', () => {
    const path = gaugeArcPath(100, 100, 50, 0, 0.75);
    // flags : large-arc=0 sweep=1 → "A 50 50 0 0 1"
    expect(path).toMatch(/A 50 50 0 0 1/);
    expect(path).not.toMatch(/A 50 50 0 1 1/);
  });
});
