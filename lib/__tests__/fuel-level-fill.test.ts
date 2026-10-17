import { describe, expect, it } from 'vitest';
import { acceptedGaugeLiters, previewFillUpFuel } from '@/lib/fuelLevelCore';

const v = {
  tankCapacity: 50,
  estimatedFuelLiters: 12,
  name: '206 grise',
};

describe('previewFillUpFuel', () => {
  it('plein partiel 20 L : jauge = reste + litres, pas 100 %', () => {
    const p = previewFillUpFuel(v, { liters: 20, isFull: false });
    expect(p.mode).toBe('add');
    expect(p.afterLiters).toBe(32);
    expect(p.exceedsCapacity).toBe(false);
  });

  it('plein jusqu’au bouchon : jauge = capacité', () => {
    const p = previewFillUpFuel(v, { liters: 20, isFull: true });
    expect(p.mode).toBe('full');
    expect(p.afterLiters).toBe(50);
  });

  it('litres > capacité : overflow, pas de clamp silencieux', () => {
    const p = previewFillUpFuel(
      { ...v, estimatedFuelLiters: 40 },
      { liters: 25, isFull: false }
    );
    expect(p.exceedsCapacity).toBe(true);
    expect(p.afterLiters).toBe(65);
    expect(p.neededCapacity).toBe(65);
    expect(acceptedGaugeLiters(p, 40)).toBe(40);
  });

  it('niveau inconnu : jauge = litres saisis', () => {
    const p = previewFillUpFuel(
      { ...v, estimatedFuelLiters: null },
      { liters: 20, isFull: false }
    );
    expect(p.mode).toBe('replace_unknown');
    expect(p.afterLiters).toBe(20);
  });
});
