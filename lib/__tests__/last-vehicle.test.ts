import { describe, expect, it } from 'vitest';
import {
  LAST_VEHICLE_STORAGE_KEY,
  MAPS_FUEL_VEHICLE_KEY,
  firstStoredVehicleRaw,
  preferStoredVehicleId,
  resolveActiveVehicleId,
} from '@/lib/lastVehicle';

describe('dernier véhicule Fuel / Maps', () => {
  it('préfère gasoil_last_vehicle_id au premier de la liste', () => {
    expect(LAST_VEHICLE_STORAGE_KEY).toBe('gasoil_last_vehicle_id');
    const ids = [2, 7, 9];
    expect(preferStoredVehicleId('7', ids)).toBe(7);
    expect(preferStoredVehicleId('7', ids)).not.toBe(ids[0]);
    expect(preferStoredVehicleId(null, ids)).toBeNull();
    expect(preferStoredVehicleId('1', ids)).toBeNull();
    expect(preferStoredVehicleId('0', ids)).toBeNull();
  });

  it('ne réécrit pas la voiture active vers un id mémorisé différent', () => {
    const ids = [2, 4];
    expect(
      resolveActiveVehicleId({
        storedId: 2,
        dbActiveIds: [4],
        vehicleIds: ids,
        lastTripAtByVehicle: { 2: Date.parse('2026-10-18T08:00:00Z'), 4: Date.parse('2026-10-17T09:34:00Z') },
      })
    ).toBe(4);
    expect(
      resolveActiveVehicleId({
        storedId: 2,
        dbActiveIds: [2],
        vehicleIds: ids,
        lastTripAtByVehicle: { 4: Date.parse('2026-10-17T09:34:00Z') },
      })
    ).toBe(2);
    expect(
      resolveActiveVehicleId({
        storedId: null,
        dbActiveIds: [4],
        vehicleIds: ids,
      })
    ).toBe(4);
    expect(
      resolveActiveVehicleId({
        storedId: 4,
        dbActiveIds: [4],
        vehicleIds: ids,
      })
    ).toBe(4);
  });

  it('lit la clé Maps hubera-maps-fuel-veh si Fuel n’a pas encore d’id', () => {
    expect(MAPS_FUEL_VEHICLE_KEY).toBe('hubera-maps-fuel-veh');
    expect(firstStoredVehicleRaw('7', '2')).toBe('7');
    expect(firstStoredVehicleRaw(null, '9')).toBe('9');
    expect(firstStoredVehicleRaw('', '9')).toBe('9');
    expect(firstStoredVehicleRaw('0', '9')).toBe('9');
    expect(preferStoredVehicleId(firstStoredVehicleRaw(null, '9'), [2, 9])).toBe(9);
  });
});
