/**
 * Contrôle trajet depuis Hubera Maps :
 *   gasoiltracking://trip/control?action=pause|resume|stop|start|fill|history&silent=1
 */
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { runMapsTripControl } from '@/lib/mapsTripControl';

export default function TripControlFromMaps() {
  const params = useLocalSearchParams<{
    action?: string;
    tripId?: string;
    silent?: string;
    liters?: string;
    total?: string;
    station?: string;
    dest?: string;
  }>();
  const { refresh } = useApp();
  const { showToast } = useToast();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const silent = params.silent === '1';
    void (async () => {
      const result = await runMapsTripControl(
        {
          action: params.action,
          tripId: params.tripId,
          liters: params.liters,
          total: params.total,
          station: params.station,
          dest: params.dest,
        },
        refresh
      );
      if (!silent) showToast(result.message);
      const q = new URLSearchParams();
      if (result.tripId) q.set('tripId', String(result.tripId));
      if (result.message) q.set('msg', result.message);
      if (result.trips) q.set('trips', result.trips);
      q.set('ok', result.ok ? '1' : '0');
      try {
        await Linking.openURL(`hubera-maps://fuel?${q.toString()}`);
      } catch {
        if (!silent) router.replace('/(tabs)/maps' as never);
      }
    })();
  }, [params, refresh, showToast]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0f0f1a', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#e94560" />
    </View>
  );
}
