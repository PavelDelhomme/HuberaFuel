import { describe, expect, it } from 'vitest';
import {
  estimateTripFuelLiters,
  estimateTripFuelPhysics,
  type PointLike,
} from '@/lib/consumptionModel';
import { inferVehicleSegment, resolveVehiclePhysics } from '@/lib/vehiclePhysics';
import type { Vehicle } from '@/types';

const vehicle: Vehicle = {
  id: 1,
  name: 'Peugeot 206',
  brand: 'Peugeot',
  model: '206',
  year: 2003,
  fuelType: 'essence',
  consumptionPer100: 6.5,
  tankCapacity: 50,
  defaultFuelPrice: 1.8,
  currentOdometer: 100000,
  hasOdometer: true,
  trackedKm: 0,
  estimatedFuelLiters: 40,
  isActive: true,
  createdAt: '',
  consumptionLearnFactor: 1,
  curbWeightKg: 1050,
  dragAreaScx: 0.62,
  vehicleSegment: 'city',
  payloadKg: 150,
  transmissionGears: 5,
};

/** Tracé plat ~90 km/h pendant ~60 s (~1,5 km). */
function flatCruisePoints(): PointLike[] {
  const pts: PointLike[] = [];
  let t = 1_000_000;
  let lat = 48.1;
  for (let i = 0; i < 61; i++) {
    pts.push({ latitude: lat, longitude: -1.6, timestamp: t, altitude: 50 });
    lat += 0.00025; // ~27,8 m / s → ~100 km/h
    t += 1000;
  }
  return pts;
}

/** Même distance avec montée continue (+8 %). */
function climbPoints(): PointLike[] {
  const pts: PointLike[] = [];
  let t = 1_000_000;
  let lat = 48.1;
  let alt = 50;
  for (let i = 0; i < 61; i++) {
    pts.push({ latitude: lat, longitude: -1.6, timestamp: t, altitude: alt });
    lat += 0.00025;
    alt += 2.2; // ~8 % de pente
    t += 1000;
  }
  return pts;
}

describe('consumption-physics', () => {
  it('infère citadine pour 206', () => {
    expect(inferVehicleSegment('Peugeot', '206')).toBe('city');
  });

  it('resolveVehiclePhysics utilise masse + SCx saisis', () => {
    const p = resolveVehiclePhysics(vehicle);
    expect(p.massKg).toBe(1200);
    expect(p.dragAreaScx).toBe(0.62);
    expect(p.etaTrans).toBeGreaterThan(0.8);
    expect(p.etaEngine).toBeLessThan(0.3);
  });

  it('physique > 0 sur croisière', () => {
    const pts = flatCruisePoints();
    const L = estimateTripFuelPhysics(vehicle, pts);
    expect(L).toBeGreaterThan(0.05);
    expect(L).toBeLessThan(0.5);
  });

  it('montée consomme plus que plat', () => {
    const flat = estimateTripFuelPhysics(vehicle, flatCruisePoints());
    const climb = estimateTripFuelPhysics(vehicle, climbPoints());
    expect(climb).toBeGreaterThan(flat);
  });

  it('estimateTripFuelLiters utilise la physique si points', () => {
    const pts = flatCruisePoints();
    const phys = estimateTripFuelPhysics(vehicle, pts);
    const via = estimateTripFuelLiters(vehicle, 1.5, { points: pts });
    expect(via).toBe(phys);
  });

  it('forceHeuristic ignore les points', () => {
    const pts = flatCruisePoints();
    const heur = estimateTripFuelLiters(vehicle, 20, {
      points: pts,
      forceHeuristic: true,
      avgSpeedKmh: 90,
    });
    const phys = estimateTripFuelPhysics(vehicle, pts);
    expect(heur).not.toBe(phys);
    expect(heur).toBeGreaterThan(1);
  });

  it('ralenti : 10 min à l’arrêt compte la conso idle', () => {
    const t0 = 1_700_000_000_000;
    const pts = [
      { latitude: 48.11, longitude: -1.68, timestamp: t0, speed: 0 },
      { latitude: 48.11, longitude: -1.68, timestamp: t0 + 600_000, speed: 0 },
    ];
    const L = estimateTripFuelPhysics(vehicle, pts);
    expect(L).toBeGreaterThan(0.05);
    expect(L).toBeLessThan(2);
  });
});
