import { describe, expect, it } from 'vitest';
import { estimateTripFuelLiters } from '@/lib/consumptionModel';
import { gaugeDisplaysConfirmedFull, unknownGaugeChoice } from '@/lib/fuelLevelCore';
import type { Vehicle } from '@/types';

describe('jauge inconnue — je ne sais pas', () => {
  it('ne met pas la jauge à 100 % et la conso peut encore se calculer', () => {
    const tank = 48;
    const choice = unknownGaugeChoice();
    expect(choice.knowledge).toBe('unknown');
    expect(choice.forcedFull).toBe(false);
    expect(choice.liters).toBeNull();
    expect(choice.percent).toBeNull();
    expect(choice.liters).not.toBe(tank);
    expect(gaugeDisplaysConfirmedFull(choice.liters, tank)).toBe(false);
    expect(gaugeDisplaysConfirmedFull(tank, tank)).toBe(true);

    const used = estimateTripFuelLiters(
      {
        consumptionPer100: 6.4,
        year: 2016,
        fuelType: 'essence',
        brand: 'Peugeot',
        model: '206',
        estimatedFuelLiters: choice.liters,
        tankCapacity: tank,
        consumptionLearnFactor: 1,
      } as Vehicle,
      50
    );
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThan(tank);
  });
});
