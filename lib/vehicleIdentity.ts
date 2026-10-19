import { FUEL_TYPE_LABELS } from '@/constants/Colors';

type IdentityVehicle = {
  id: number;
  name?: string | null;
  year?: number | null;
  fuelType?: string | null;
};

/** Année, carburant et id en base — pour distinguer deux voitures au même nom. */
export function vehicleIdentity(vehicle: IdentityVehicle): string {
  const fuelKey = String(vehicle.fuelType || '');
  const fuel = FUEL_TYPE_LABELS[fuelKey] || fuelKey;
  const bits = [
    vehicle.year && vehicle.year > 0 ? String(vehicle.year) : '',
    fuel,
    `n°${vehicle.id}`,
  ].filter(Boolean);
  return bits.join(' · ');
}

export function vehicleChipLabel(vehicle: IdentityVehicle): string {
  const name = String(vehicle.name || '').trim() || 'Véhicule';
  return `${name} · ${vehicleIdentity(vehicle)}`;
}
