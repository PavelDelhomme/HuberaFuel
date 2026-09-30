/**
 * Contrôle trajet depuis Hubera Maps :
 *   gasoiltracking://trip/control?action=pause|resume|stop|start|fill|history&silent=1
 */
import { useEffect, useRef } from 'react';
import { Linking, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { runMapsTripControl } from '@/lib/mapsTripControl';
import { markMapsSilent } from '@/lib/mapsSilent';

export default function TripControlFromMaps() {
  const params = useLocalSearchParams<{
    action?: string;
    tripId?: string;
    silent?: string;
    liters?: string;
    total?: string;
    station?: string;
    dest?: string;
    vehicleId?: string;
  }>();
  const { refresh } = useApp();
  const { showToast } = useToast();
  const ran = useRef(false);
  const silent = params.silent === '1';
  if (silent) {
    markMapsSilent();
    void SplashScreen.hideAsync().catch(() => undefined);
  }

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      const result = await runMapsTripControl(
        {
          action: params.action,
          tripId: params.tripId,
          liters: params.liters,
          total: params.total,
          station: params.station,
          dest: params.dest,
          vehicleId: params.vehicleId,
        },
        refresh
      );
      if (!silent) showToast(result.message);
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
        if (!silent) router.replace('/(tabs)' as never);
      }
      router.replace('/(tabs)' as never);
    })();
  }, [params, refresh, showToast, silent]);

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }} pointerEvents="none" />
  );
}
