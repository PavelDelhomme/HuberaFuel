import { describe, expect, it } from 'vitest';
import { decodeMapsTripPack, encodeMapsFuelSnap, encodeMapsTripPack } from '@/lib/mapsTripList';

describe('mapsTripList', () => {
  it('encode / decode un historique compact', () => {
    const pack = encodeMapsTripPack([
      {
        id: 175,
        distanceKm: 43.549,
        startTime: '2026-09-28T12:43:00.000Z',
        originName: 'Intermarché La Guerche',
        destinationName: 'Domicile',
        isActive: false,
        status: 'confirmed',
      },
      {
        id: 176,
        distanceKm: 0,
        startTime: '2026-09-28T14:00:00.000Z',
        originName: 'Domicile',
        destinationName: '',
        isActive: true,
        isPaused: true,
        status: 'confirmed',
      },
      {
        id: 9,
        status: 'rejected',
        distanceKm: 0.01,
        startTime: '2026-09-01T00:00:00.000Z',
      },
    ]);
    expect(pack).not.toContain('rejected');
    const rows = decodeMapsTripPack(pack);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 175,
      km: 43.5,
      origin: 'Intermarché La Guerche',
      dest: 'Domicile',
      active: false,
    });
    expect(rows[1]).toMatchObject({
      id: 176,
      active: true,
      paused: true,
      dest: '',
    });
  });

  it('nettoie les séparateurs dans les libellés', () => {
    const pack = encodeMapsTripPack([
      {
        id: 1,
        originName: 'A | B ~ C',
        destinationName: 'Chez\ntoi',
        status: 'confirmed',
      },
    ]);
    expect(pack).not.toMatch(/A \| B/);
    const [row] = decodeMapsTripPack(pack);
    expect(row.origin).toContain('A');
    expect(row.dest).toBe('Chez toi');
  });

  it('pack snap véhicules : nom + actif du compte', () => {
    const snap = encodeMapsFuelSnap({
      vehicles: [
        { id: 2, name: 'Clio', isActive: false, tankCapacity: 50, estimatedFuelLiters: 10 },
        { id: 7, name: 'Kangoo La Guerche', isActive: true, tankCapacity: 60, estimatedFuelLiters: 30 },
      ],
      fills: [],
      budget: null,
    });
    expect(snap.startsWith('V||')).toBe(true);
    expect(snap).toContain('7~Kangoo La Guerche~50~1~60~30~0');
    expect(snap).toContain('2~Clio~20~0~50~10~0');
  });
});
