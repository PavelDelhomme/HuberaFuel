import { describe, expect, it } from 'vitest';
import { metaFromTrip, trackingShouldRun } from '@/lib/trackingMeta';

describe('suivi Fuel — arrêt de trajet', () => {
  it('trajet en pause : meta en pause, le FGS ne doit pas tourner', () => {
    const meta = metaFromTrip({ id: 4, vehicleId: 1, isActive: true, isPaused: true });
    expect(meta).toEqual({ id: 4, vehicleId: 1, isPaused: true, isActive: true });
    expect(trackingShouldRun(meta === 'absent' || meta === 'inactive' ? null : meta)).toBe(false);
  });

  it('trajet clos : inactive, pas de résurrection depuis un tampon', () => {
    expect(metaFromTrip({ id: 4, vehicleId: 1, isActive: false, isPaused: false })).toBe('inactive');
    expect(trackingShouldRun(null)).toBe(false);
  });

  it('trajet actif : le suivi continue', () => {
    const meta = metaFromTrip({ id: 9, vehicleId: 2, isActive: true, isPaused: false });
    expect(trackingShouldRun(meta === 'absent' || meta === 'inactive' ? null : meta)).toBe(true);
  });
});
