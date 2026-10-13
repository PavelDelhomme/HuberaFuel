import { describe, expect, it } from 'vitest';
import { estimateCommutesRemaining } from '@/lib/commuteRange';
import type { Place, Trip, Vehicle } from '@/types';

const vehicle = {
  consumptionPer100: 7,
  consumptionLearnFactor: 1,
  fuelType: 'essence',
  name: '206 grise',
} as Pick<Vehicle, 'consumptionPer100' | 'consumptionLearnFactor' | 'fuelType' | 'name'>;

const home: Place = {
  id: 1,
  name: 'Maison',
  address: '',
  kind: 'home',
  latitude: 47.2,
  longitude: -1.55,
  createdAt: '',
};
const work: Place = {
  id: 2,
  name: 'Travail',
  address: '',
  kind: 'work',
  latitude: 47.22,
  longitude: -1.52,
  createdAt: '',
};

function trip(km: number, from: Place, to: Place): Trip {
  return {
    id: km,
    vehicleId: 1,
    startTime: '2026-10-10T07:30:00.000Z',
    endTime: '2026-10-10T08:00:00.000Z',
    distanceKm: km,
    estimatedFuelUsed: 0,
    estimatedCost: 0,
    isActive: false,
    status: 'confirmed',
    source: 'gps',
    routePoints: JSON.stringify([
      { latitude: from.latitude, longitude: from.longitude },
      { latitude: to.latitude, longitude: to.longitude },
    ]),
  } as Trip;
}

describe('estimateCommutesRemaining', () => {
  it('compte les allers-retours selon la conso de cette voiture', () => {
    const trips = [
      trip(12, home, work),
      trip(13, work, home),
      trip(12.5, home, work),
    ];
    const r = estimateCommutesRemaining({
      vehicle,
      litersRemaining: 10,
      places: [home, work],
      trips,
    });
    expect(r).not.toBeNull();
    expect(r!.oneWayKm).toBeGreaterThan(10);
    expect(r!.roundTrips).toBeGreaterThan(3);
    expect(r!.label).toMatch(/aller-retour/);
    expect(r!.label).toMatch(/Maison/);
  });

  it('sans assez d’essence : plus de trajet complet', () => {
    const r = estimateCommutesRemaining({
      vehicle,
      litersRemaining: 0.3,
      places: [home, work],
      trips: [trip(40, home, work), trip(41, work, home)],
    });
    expect(r).not.toBeNull();
    expect(r!.label).toMatch(/Plus assez|plus assez/);
  });
});
