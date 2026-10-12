import { describe, expect, it } from 'vitest';
import {
  acceptMapDisplayFix,
  evaluateGpsSample,
  MAX_ACCURACY_FIRST_M,
  MAX_ACCURACY_M,
} from '@/lib/gpsTracking';
import { pickRicherRoutePoints } from '@/lib/liveTripBuffer';

describe('filtre GPS suivi libre', () => {
  it('accepte une précision 50 m en mouvement (FGS Android)', () => {
    const a = { latitude: 48.14, longitude: -1.58, timestamp: 0 };
    const b = {
      latitude: 48.1409,
      longitude: -1.58,
      timestamp: 5000,
      accuracy: 50,
      speed: 16,
    };
    const r = evaluateGpsSample(a, b);
    expect(r.accept).toBe(true);
    expect(MAX_ACCURACY_M).toBeGreaterThanOrEqual(80);
  });

  it('accepte le premier point jusqu’à ~160 m', () => {
    const r = evaluateGpsSample(null, {
      latitude: 48.14,
      longitude: -1.58,
      timestamp: 0,
      accuracy: 120,
    });
    expect(r.accept).toBe(true);
    expect(MAX_ACCURACY_FIRST_M).toBeGreaterThanOrEqual(150);
  });

  it('rejette une précision vraiment nulle', () => {
    const r = evaluateGpsSample(null, {
      latitude: 48.14,
      longitude: -1.58,
      timestamp: 0,
      accuracy: 400,
    });
    expect(r.accept).toBe(false);
    expect(r.reason).toBe('bad_accuracy');
  });

  it('n’utilise pas speed=-1 comme stationnaire', () => {
    const a = { latitude: 48.14, longitude: -1.58, timestamp: 0 };
    const b = {
      latitude: 48.14015,
      longitude: -1.58,
      timestamp: 4000,
      accuracy: 20,
      speed: -1,
    };
    const r = evaluateGpsSample(a, b);
    expect(r.accept).toBe(true);
  });

  it('rejette un téléport Rennes → St-Jacques pour les km trajet', () => {
    const a = { latitude: 48.15596, longitude: -1.58696, timestamp: 0 };
    const b = {
      latitude: 48.103,
      longitude: -1.6935,
      timestamp: 2000,
      accuracy: 3,
    };
    const r = evaluateGpsSample(a, b);
    expect(r.accept).toBe(false);
    expect(r.reason).toBe('too_fast');
  });

  it('la pastille idle suit un téléport mock', () => {
    const a = { latitude: 48.15596, longitude: -1.58696, timestamp: 0 };
    const b = {
      latitude: 48.103,
      longitude: -1.6935,
      timestamp: 2000,
      accuracy: 3,
      mocked: true,
    };
    expect(acceptMapDisplayFix(a, b)).toEqual({
      latitude: 48.103,
      longitude: -1.6935,
    });
  });

  it('accepte un déplacement même si le capteur dit 0 m/s (FGS)', () => {
    // ~80 m en 4 s ≈ 72 km/h, speed device 0
    const a = { latitude: 48.14, longitude: -1.58, timestamp: 0 };
    const b = {
      latitude: 48.14072,
      longitude: -1.58,
      timestamp: 4000,
      accuracy: 25,
      speed: 0,
    };
    const r = evaluateGpsSample(a, b);
    expect(r.accept).toBe(true);
  });
});

describe('pickRicherRoutePoints', () => {
  it('garde le tracé le plus long', () => {
    const short = JSON.stringify([{ latitude: 1, longitude: 2, timestamp: 1 }]);
    const long = JSON.stringify([
      { latitude: 1, longitude: 2, timestamp: 1 },
      { latitude: 1.01, longitude: 2.01, timestamp: 2 },
    ]);
    expect(pickRicherRoutePoints(short, long)).toBe(long);
    expect(pickRicherRoutePoints(long, short)).toBe(long);
  });
});
