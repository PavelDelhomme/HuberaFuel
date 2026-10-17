/** Décision pure : le FGS ne reste live que pour un trajet actif et non en pause. */

export type TrackingMeta = {
  id: number;
  vehicleId: number;
  isPaused: boolean;
  isActive: boolean;
};

type TripLite = {
  id: number;
  vehicleId: number;
  isActive: boolean;
  isPaused?: boolean;
};

/** `absent` = pas de ligne ; `inactive` = trajet clos (arrêter le FGS). */
export function metaFromTrip(
  trip: TripLite | null | undefined
): TrackingMeta | 'absent' | 'inactive' {
  if (!trip) return 'absent';
  if (!trip.isActive) return 'inactive';
  return {
    id: trip.id,
    vehicleId: trip.vehicleId,
    isPaused: !!trip.isPaused,
    isActive: true,
  };
}

export function trackingShouldRun(meta: TrackingMeta | null): meta is TrackingMeta {
  return !!meta && meta.isActive && !meta.isPaused;
}
