import { describe, expect, it } from 'vitest';
import type { Place } from '@/types';
import {
  isOnCorridor,
  isResumableZombieTrip,
  mergeRouteSegments,
  nearestSavedPlace,
  placeLabel,
  stampCoords,
  extendRecordedTripEnds,
} from '@/lib/extendTripEnds';

const HOME: Place = {
  id: 1,
  name: 'Domicile',
  address: '1 Rue Camille Saint-Saëns, 35235 Thorigné-Fouillard',
  kind: 'home',
  latitude: 48.1571969,
  longitude: -1.586983,
  createdAt: '2026-01-01',
};

const WORK: Place = {
  id: 2,
  name: 'Intermarché La Guerche',
  address: 'Fbg de Vitré, 35130 La Guerche-de-Bretagne',
  kind: 'work',
  latitude: 47.9474563,
  longitude: -1.2238268,
  createdAt: '2026-01-01',
};

describe('extendTripEnds', () => {
  it('trouve le lieu le plus proche sous le plafond', () => {
    const hit = nearestSavedPlace(
      { latitude: 48.15577, longitude: -1.58681 },
      [HOME, WORK],
      2.5
    );
    expect(hit?.place.id).toBe(1);
    expect(hit!.km).toBeGreaterThan(0.04);
    expect(hit!.km).toBeLessThan(0.3);
  });

  it('détecte un GPS à Bais sur le corridor Guerche → Thorigné', () => {
    expect(
      isOnCorridor(
        { latitude: WORK.latitude!, longitude: WORK.longitude! },
        { latitude: 47.97087, longitude: -1.32351 },
        { latitude: 48.15577, longitude: -1.58681 }
      )
    ).toBe(true);
  });

  it('refuse un milieu hors corridor', () => {
    expect(
      isOnCorridor(
        { latitude: WORK.latitude!, longitude: WORK.longitude! },
        { latitude: 48.08, longitude: -1.7 },
        { latitude: HOME.latitude!, longitude: HOME.longitude! }
      )
    ).toBe(false);
  });

  it('fusionne préfixe / tracé / suffixe sans doublon collé', () => {
    const recorded = [
      { latitude: 47.97, longitude: -1.32, timestamp: 1000 },
      { latitude: 48.15, longitude: -1.58, timestamp: 2000 },
    ];
    const prefix = [
      { latitude: 47.947, longitude: -1.224, timestamp: 100 },
      { latitude: 47.97, longitude: -1.32, timestamp: 900 },
    ];
    const suffix = [
      { latitude: 48.15, longitude: -1.58, timestamp: 2100 },
      { latitude: 48.157, longitude: -1.587, timestamp: 2200 },
    ];
    const merged = mergeRouteSegments(prefix, recorded, suffix);
    expect(merged[0].latitude).toBeCloseTo(47.947, 3);
    expect(merged[merged.length - 1].latitude).toBeCloseTo(48.157, 3);
    expect(merged.length).toBe(4);
  });

  it('reprend un zombie récent 0 km', () => {
    const now = Date.parse('2026-09-28T10:43:00Z');
    expect(
      isResumableZombieTrip(
        {
          note: 'Suivi GPS libre [clôturé auto: zombie]',
          distanceKm: 0.113,
          endTime: '2026-09-28T10:34:17.573Z',
          isActive: false,
        },
        now
      )
    ).toBe(true);
    expect(
      isResumableZombieTrip(
        {
          note: 'Suivi GPS libre [clôturé auto: zombie]',
          distanceKm: 0.113,
          endTime: '2026-09-28T09:00:00Z',
          isActive: false,
        },
        now
      )
    ).toBe(false);
  });

  it('rallonge les deux bouts via fetchRoute', async () => {
    const recorded = [
      { latitude: 47.97087, longitude: -1.32351, timestamp: 1_000_000 },
      { latitude: 48.15577, longitude: -1.58681, timestamp: 2_000_000 },
    ];
    const out = await extendRecordedTripEnds({
      points: recorded,
      places: [HOME, WORK],
      fetchRoute: async (from, to) => ({
        coordinates: [from, to],
      }),
    });
    expect(out.prepended).toBe(true);
    expect(out.appended).toBe(true);
    expect(out.originName).toContain('Intermarché');
    expect(out.destName).toContain('Domicile');
    expect(out.points[0].latitude).toBeCloseTo(WORK.latitude!, 4);
    expect(out.points[out.points.length - 1].latitude).toBeCloseTo(HOME.latitude!, 4);
  });

  it('estampille une géométrie entre deux horodatages', () => {
    const pts = stampCoords(
      [
        { latitude: 1, longitude: 2 },
        { latitude: 3, longitude: 4 },
      ],
      1000,
      2000
    );
    expect(pts[0].timestamp).toBe(1000);
    expect(pts[1].timestamp).toBe(2000);
  });

  it('libellé lieu', () => {
    expect(placeLabel(HOME)).toContain('Domicile');
  });
});
