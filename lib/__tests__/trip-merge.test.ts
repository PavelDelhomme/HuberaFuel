import { describe, expect, it } from 'vitest';
import { mergeUnsyncedLocalTrips, parseTripTimeMs, tripFingerprint } from '../tripMerge';
import { bumpLocalWriteSeq, getLocalWriteSeq } from '../localWriteSeq';

const mk = (id: number, vehicleId: number, startTime: string, extra: object = {}) => ({
  id,
  vehicleId,
  startTime,
  endTime: startTime,
  isActive: false,
  fillUpId: 7 as number | null,
  ...extra,
});

describe('mergeUnsyncedLocalTrips', () => {
  const vehicles = new Set([1]);
  const since = Date.parse('2026-11-09T10:00:00Z');

  it('garde un trajet local jamais poussé (pull ne le perd plus)', () => {
    const remote = [mk(1, 1, '2026-11-08T08:00:00Z')];
    const local = [mk(1, 1, '2026-11-08T08:00:00Z'), mk(2, 1, '2026-11-09T11:30:00Z')];
    const r = mergeUnsyncedLocalTrips(local, remote, { sinceMs: since, remoteVehicleIds: vehicles });
    expect(r.added).toBe(1);
    expect(r.trips).toHaveLength(2);
    expect(r.trips[1].id).toBe(2);
    expect(r.trips[1].fillUpId).toBeNull();
  });

  it('renumérote en cas de collision d’id', () => {
    const remote = [mk(5, 1, '2026-11-08T08:00:00Z')];
    const local = [mk(5, 1, '2026-11-09T11:30:00Z')];
    const r = mergeUnsyncedLocalTrips(local, remote, { sinceMs: since, remoteVehicleIds: vehicles });
    expect(r.trips.map((t) => t.id)).toEqual([5, 6]);
  });

  it('ne ressuscite pas un vieux trajet supprimé ailleurs', () => {
    const local = [mk(2, 1, '2026-10-01T11:30:00Z')];
    const r = mergeUnsyncedLocalTrips(local, [], { sinceMs: since, remoteVehicleIds: vehicles });
    expect(r.added).toBe(0);
  });

  it('ignore trajet actif et véhicule absent du cloud', () => {
    const local = [
      mk(2, 1, '2026-11-09T11:30:00Z', { isActive: true }),
      mk(3, 9, '2026-11-09T11:40:00Z'),
    ];
    const r = mergeUnsyncedLocalTrips(local, [], { sinceMs: since, remoteVehicleIds: vehicles });
    expect(r.added).toBe(0);
  });

  it('dédoublonne par véhicule + départ', () => {
    const remote = [mk(1, 1, '2026-11-09T11:30:00Z')];
    const local = [mk(9, 1, '2026-11-09T11:30:00.400Z')];
    const r = mergeUnsyncedLocalTrips(local, remote, { sinceMs: since, remoteVehicleIds: vehicles });
    expect(r.added).toBe(0);
    expect(tripFingerprint(remote[0])).toBe(tripFingerprint(local[0]));
  });

  it('lit le format SQLite datetime(now) en UTC', () => {
    expect(parseTripTimeMs('2026-11-09 11:30:00')).toBe(Date.parse('2026-11-09T11:30:00Z'));
  });
});

describe('localWriteSeq', () => {
  it('incrémente', () => {
    const a = getLocalWriteSeq();
    bumpLocalWriteSeq();
    expect(getLocalWriteSeq()).toBe(a + 1);
  });
});
