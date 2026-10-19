/**
 * Clôture uniquement les trajets zombies (quasi 0 km, plus de point récent).
 * Un suivi libre avec des kilomètres reste ouvert : l’utilisateur le termine
 * lui-même, même après un long passage en arrière-plan.
 */
import { getActiveTripLite, updateTrip } from '@/lib/database';
import { readLiveTripBuffer } from '@/lib/liveTripBuffer';

/** Aligné sur le commentaire historique (45 min) — 20 min coupait le départ Guerche. */
export const STALE_POINT_MS = 45 * 60 * 1000;
const TINY_KM = 0.5;
export const TINY_MIN_AGE_MS = 45 * 60 * 1000;

export function shouldAutoCloseActiveTrip(opts: {
  ageMs: number;
  distanceKm: number;
  trackingLive: boolean;
}): boolean {
  if (opts.trackingLive) return false;
  if (!Number.isFinite(opts.ageMs) || opts.ageMs < TINY_MIN_AGE_MS) return false;
  return (opts.distanceKm || 0) < TINY_KM;
}

export async function finalizeStaleActiveTrip(opts?: {
  /** FGS encore vivant : ne pas tuer le suivi, même ancien. */
  trackingLive?: boolean;
}): Promise<boolean> {
  const trip = await getActiveTripLite();
  if (!trip?.isActive) return false;

  const startMs = Date.parse(trip.startTime);
  if (!Number.isFinite(startMs)) return false;
  const ageMs = Date.now() - startMs;
  const buf = await readLiveTripBuffer().catch(() => null);
  const lastTs =
    buf && buf.tripId === trip.id && Number.isFinite(buf.lastFixAt)
      ? Number(buf.lastFixAt)
      : startMs;
  const pointStale = Date.now() - lastTs > STALE_POINT_MS;
  const tiny = (trip.distanceKm || 0) < TINY_KM;

  if (opts?.trackingLive) return false;
  if (!shouldAutoCloseActiveTrip({ ageMs, distanceKm: trip.distanceKm || 0, trackingLive: false })) {
    return false;
  }
  if (!tiny || !pointStale) return false;

  const tag = '[clôturé auto: zombie]';
  const note = [trip.note?.trim(), tag].filter(Boolean).join(' ');
  await updateTrip(trip.id, {
    isActive: false,
    endTime: new Date().toISOString(),
    status: 'rejected',
    note: note || tag,
  });
  return true;
}
