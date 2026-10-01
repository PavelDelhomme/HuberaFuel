/**
 * Commandes Hubera Maps → Fuel sans ouvrir l’UI (broadcast / headless).
 */
import { AppRegistry, DeviceEventEmitter, Linking, Platform } from 'react-native';
import { runMapsTripControl, type MapsTripControlInput } from '@/lib/mapsTripControl';
import { markMapsSilent } from '@/lib/mapsSilent';

let lastDedupe = '';
let lastAt = 0;

export async function handleMapsControlPayload(raw: Record<string, unknown> | null | undefined) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const str = (k: string) => {
    const v = src[k];
    return v == null ? undefined : String(v);
  };
  const action = str('action') || '';
  const dedupe = `${action}|${str('tripId') || ''}|${str('vehicleId') || ''}|${str('liters') || ''}`;
  if (dedupe === lastDedupe && Date.now() - lastAt < 4000) return;
  lastDedupe = dedupe;
  lastAt = Date.now();
  markMapsSilent(12000);
  const input: MapsTripControlInput = {
    action,
    tripId: str('tripId'),
    liters: str('liters'),
    total: str('total'),
    station: str('station'),
    dest: str('dest'),
    vehicleId: str('vehicleId'),
  };
  const result = await runMapsTripControl(input);
  const q = new URLSearchParams();
  if (result.tripId) q.set('tripId', String(result.tripId));
  if (result.message) q.set('msg', result.message);
  if (result.trips) q.set('trips', result.trips);
  if (result.snap) q.set('snap', result.snap);
  if (result.km != null && result.km > 0) q.set('km', String(Math.round(result.km * 10) / 10));
  if (result.trackingStarted === false) q.set('started', '0');
  if (result.trackingStarted === true) q.set('started', '1');
  q.set('ok', result.ok ? '1' : '0');
  try {
    await Linking.openURL(`hubera-maps://fuel?${q.toString()}`);
  } catch {
    /* Maps pas au premier plan */
  }
}

if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('MapsControlTask', () => async (data: Record<string, unknown>) => {
    await handleMapsControlPayload(data);
  });
  DeviceEventEmitter.addListener('huberaMapsControl', (data) => {
    void handleMapsControlPayload(data as Record<string, unknown>);
  });
}
