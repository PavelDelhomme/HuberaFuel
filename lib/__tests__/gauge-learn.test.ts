import { describe, expect, it } from 'vitest';
import {
  blendLearnFactor,
  gaugeLearnUpdate,
  learnedFactorFromGauge,
} from '../consumptionModel';

describe('gauge → modèle conso', () => {
  it('facteur > 1 si la jauge a plus baissé que le modèle', () => {
    expect(learnedFactorFromGauge(3.2, 4.5)).toBeGreaterThan(1);
    expect(learnedFactorFromGauge(4.5, 3.2)).toBeLessThan(1);
  });

  it('EMA du facteur par véhicule', () => {
    expect(blendLearnFactor(1, 1.2)).toBeCloseTo(1.056, 2);
    expect(blendLearnFactor(1, 0.8)).toBeLessThan(1);
  });

  it('jauge qui monte (plein) : pas d’apprentissage', () => {
    expect(
      gaugeLearnUpdate({
        previousLiters: 12,
        currentLiters: 40,
        tripKm: 80,
        estimatedBurnLiters: 5,
        prevL100: 6.5,
        prevLearnFactor: 1,
        fuelType: 'essence',
      })
    ).toBeNull();
  });

  it('sans km ni estimation : pas d’apprentissage', () => {
    expect(
      gaugeLearnUpdate({
        previousLiters: 40,
        currentLiters: 38,
        tripKm: 0,
        estimatedBurnLiters: 0,
        prevL100: 6.5,
        prevLearnFactor: 1,
      })
    ).toBeNull();
  });

  it('recalibre L/100 + facteur après une jauge à la baisse', () => {
    const r = gaugeLearnUpdate({
      previousLiters: 50,
      currentLiters: 42,
      tripKm: 100,
      estimatedBurnLiters: 6.5,
      prevL100: 6.5,
      prevLearnFactor: 1,
      fuelType: 'essence',
    });
    expect(r).not.toBeNull();
    expect(r!.learned).toBe(true);
    expect(r!.measuredL100).toBe(8);
    expect(r!.nextL100).toBeGreaterThan(6.5);
    expect(r!.nextLearnFactor).toBeGreaterThan(1);
  });
});
