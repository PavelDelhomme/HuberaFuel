/**
 * Clôture les trajets « zombies » laissés actifs après kill / Freecess / crash.
 * - Très vieux (> 8 h) → confirmé (données GPS éventuelles conservées)
 * - Quasi 0 km + plus de points récents (> 45 min) → rejeté
 */
import { getActiveTrip, updateTrip } from '@/lib/database';
import { parseRoutePoints } from '@/lib/calculations';

const MAX_AGE_MS = 8 * 60 * 60 * 1000;
/** Aligné sur le commentaire historique (45 min) — 20 min coupait le départ Guerche. */
export const STALE_POINT_MS = 45 * 60 * 1000;
const TINY_KM = 0.5;
export const TINY_MIN_AGE_MS = 45 * 60 * 1000;

export async function finalizeStaleActiveTrip(opts?: {
  /** FGS encore vivant : ne pas tuer un 0 km (GPS sourd / Freecess). */
  trackingLive?: boolean;
}): Promise<boolean> {
  const trip = await getActiveTrip();
  if (!trip?.isActive) return false;

  const startMs = Date.parse(trip.startTime);
  if (!Number.isFinite(startMs)) return false;
  const ageMs = Date.now() - startMs;
  const pts = parseRoutePoints(trip.routePoints);
  const lastTs =
    pts.length > 0 && Number.isFinite(pts[pts.length - 1]?.timestamp)
      ? Number(pts[pts.length - 1].timestamp)
      : startMs;
  const pointStale = Date.now() - lastTs > STALE_POINT_MS;
  const tiny = (trip.distanceKm || 0) < TINY_KM;
  const veryOld = ageMs > MAX_AGE_MS;

  if (!veryOld && opts?.trackingLive) {
    return false;
  }
  if (!veryOld && !(tiny && pointStale && ageMs > TINY_MIN_AGE_MS)) {
    return false;
  }

  const tag = tiny ? '[clôturé auto: zombie]' : '[clôturé auto: trop long]';
  const note = [trip.note?.trim(), tag].filter(Boolean).join(' ');
  await updateTrip(trip.id, {
    isActive: false,
    endTime: new Date().toISOString(),
    status: tiny ? 'rejected' : 'confirmed',
    note: note || tag,
  });
  return true;
}
