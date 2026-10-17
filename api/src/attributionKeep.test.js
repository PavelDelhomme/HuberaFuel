import { describe, expect, it } from 'vitest';
import { applyAttributionKeep } from './attributionKeep.js';

const keep = {
  activeVehicleId: 4,
  staleVehicleId: 2,
  reassignNewTripsUntil: '2026-10-31T23:59:59.000Z',
  fillsSince: '2026-10-15T00:00:00.000Z',
  tripVehicle: { 203: 4, 207: 4 },
  gaugeVehicle: { 179: 4 },
  gaugeOdometer: { 179: 744 },
  fillVehicle: { 3: 2 },
  corrected: [
    { id: 2, estimatedFuelLiters: 47.1, trackedKm: 37.1, isActive: false },
    { id: 4, estimatedFuelLiters: 6.3, trackedKm: 318, isActive: true },
  ],
};

function base() {
  return {
    vehicles: [
      { id: 2, isActive: true, estimatedFuelLiters: 6.3, trackedKm: 194.6, tankCapacity: 50 },
      { id: 4, isActive: false, estimatedFuelLiters: 20.4, trackedKm: 160.5, tankCapacity: 50 },
    ],
    trips: [
      { id: 203, vehicleId: 2, startTime: '2026-10-15T12:25:00.000Z', endTime: '2026-10-15T13:11:00.000Z', distanceKm: 56.1, estimatedFuelUsed: 3.1, status: 'confirmed' },
      { id: 207, vehicleId: 2, startTime: '2026-10-17T09:34:00.000Z', endTime: '2026-10-17T10:43:00.000Z', distanceKm: 49.7, estimatedFuelUsed: 2.6, status: 'confirmed' },
    ],
    fillUps: [{ id: 3, vehicleId: 2, date: '2026-08-20T16:00:00.000Z', liters: 32.5 }],
    gaugeReadings: [{ id: 179, vehicleId: 2, liters: 6.3, odometer: 123410, tripId: 207 }],
  };
}

describe('garde attribution 206', () => {
  it('ramène trajets, jauge et niveaux quand le téléphone renvoie la 2003', () => {
    const data = base();
    const out = applyAttributionKeep(data, keep, Date.parse('2026-10-17T14:00:00Z'));
    expect(out.changed).toBe(true);
    expect(data.trips.map((t) => t.vehicleId)).toEqual([4, 4]);
    expect(data.gaugeReadings[0].vehicleId).toBe(4);
    expect(data.gaugeReadings[0].odometer).toBe(744);
    expect(data.vehicles.find((v) => v.id === 4).isActive).toBe(true);
    expect(data.vehicles.find((v) => v.id === 4).estimatedFuelLiters).toBe(6.3);
    expect(data.vehicles.find((v) => v.id === 2).estimatedFuelLiters).toBe(47.1);
    expect(data.vehicles.find((v) => v.id === 2).isActive).toBe(false);
  });

  it('ne déplace pas un plein historique déjà sur la 2003, et le rétablit s’il a bougé', () => {
    const data = base();
    data.fillUps[0].vehicleId = 4;
    applyAttributionKeep(data, keep, Date.parse('2026-10-17T14:00:00Z'));
    expect(data.fillUps[0].vehicleId).toBe(2);
  });

  it('après correction, un trajet neuf sur la 2003 revient à la grise', () => {
    const data = base();
    data.vehicles[0].estimatedFuelLiters = 47.1;
    data.vehicles[0].trackedKm = 37.1;
    data.vehicles[0].isActive = false;
    data.vehicles[1].estimatedFuelLiters = 6.3;
    data.vehicles[1].trackedKm = 318;
    data.vehicles[1].isActive = true;
    data.trips.forEach((t) => {
      t.vehicleId = 4;
    });
    data.gaugeReadings[0].vehicleId = 4;
    data.gaugeReadings[0].odometer = 744;
    data.trips.push({
      id: 210,
      vehicleId: 2,
      startTime: '2026-10-18T02:00:00.000Z',
      endTime: '2026-10-18T03:00:00.000Z',
      distanceKm: 50,
      estimatedFuelUsed: 3,
      status: 'confirmed',
    });
    data.vehicles[0].trackedKm = 87.1;
    data.vehicles[0].estimatedFuelLiters = 44.1;
    applyAttributionKeep(data, keep, Date.parse('2026-10-18T04:00:00Z'));
    const neu = data.trips.find((t) => t.id === 210);
    expect(neu.vehicleId).toBe(4);
    expect(data.vehicles.find((v) => v.id === 4).isActive).toBe(true);
    expect(data.vehicles.find((v) => v.id === 2).trackedKm).toBe(37.1);
    expect(data.vehicles.find((v) => v.id === 4).trackedKm).toBe(368);
  });

  it('laisse passer un plein réel sur la 2003', () => {
    const data = base();
    data.vehicles[0].estimatedFuelLiters = 47.1;
    data.vehicles[1].estimatedFuelLiters = 6.3;
    data.trips.forEach((t) => {
      t.vehicleId = 4;
    });
    data.gaugeReadings[0].vehicleId = 4;
    data.gaugeReadings[0].odometer = 744;
    data.fillUps.push({ id: 30, vehicleId: 2, date: '2026-10-20T10:00:00.000Z', liters: 20 });
    data.trips.push({
      id: 211,
      vehicleId: 2,
      startTime: '2026-10-20T11:00:00.000Z',
      endTime: '2026-10-20T12:00:00.000Z',
      distanceKm: 10,
      estimatedFuelUsed: 1,
      status: 'confirmed',
    });
    applyAttributionKeep(data, keep, Date.parse('2026-10-20T13:00:00Z'));
    expect(data.trips.find((t) => t.id === 211).vehicleId).toBe(2);
  });
});
