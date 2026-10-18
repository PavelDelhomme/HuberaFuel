import { describe, expect, it } from 'vitest';
import {
  MAP_FOLLOW_DISTANCE_M,
  MAP_FOLLOW_TIME_MS,
  TRIP_GPS_DISTANCE_M,
  TRIP_GPS_TIME_MS,
} from '@/lib/mapFollowGps';

describe('suivi carte moins gourmand que le trajet', () => {
  it('la carte ne réveille pas le GPS plus souvent que l’enregistrement', () => {
    expect(MAP_FOLLOW_TIME_MS).toBeGreaterThan(TRIP_GPS_TIME_MS);
    expect(MAP_FOLLOW_DISTANCE_M).toBeGreaterThan(TRIP_GPS_DISTANCE_M);
    expect(TRIP_GPS_TIME_MS).toBe(5000);
    expect(TRIP_GPS_DISTANCE_M).toBe(16);
  });
});
