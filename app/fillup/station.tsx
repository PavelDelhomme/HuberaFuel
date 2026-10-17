import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useLocale } from '@/context/LocaleContext';
import { useTheme } from '@/hooks/useTheme';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { Card, ProgressBar } from '@/components/Card';
import {
  adaptVehicleConsumption,
  displayOdometerKm,
  formatDistance,
  formatEuro,
  getSinceLastFillStats,
  refreshBudgets,
} from '@/lib/calculations';
import { notify } from '@/lib/notify';
import { refreshVehicleReminders } from '@/lib/reminders';
import {
  getCurrentLocation,
  startBackgroundTracking,
  stopBackgroundTracking,
  seedLivePointsCache,
  ensureLocationEnabled,
} from '@/lib/locationService';
import { recordFuelGaugeReading } from '@/lib/fuelGaugeHistory';
import { seedLiveTripBuffer, clearLiveTripBuffer } from '@/lib/liveTripBuffer';
import { launchGoogleMapsNavigation } from '@/lib/mapsNavigation';
import { fuelLabel, isSaneFuelPricePerLiter } from '@/lib/fuelPrices';
import { applyFillUpToFuelEstimate, previewFillUpFuel } from '@/lib/fuelLevel';
import {
  createFillUp,
  createTrip,
  getFillUps,
  getVehicleById,
  stopActiveTrips,
  updateTrip,
  addTrackedKm,
  updateVehicle,
} from '@/lib/database';
import { reverseGeocode } from '@/lib/geocode';

type Phase = 'go' | 'fill' | 'done';

/**
 * Trajet station : Maps + suivi GPS → km réels → plein → budget.
 */
export default function StationTripScreen() {
  const params = useLocalSearchParams<{
    name?: string;
    address?: string;
    lat?: string;
    lon?: string;
    price?: string;
    fuelKey?: string;
  }>();
  const { activeVehicle, activeTrip, budgetStatuses, refresh } = useApp();
  const { colors } = useTheme();
  const { moneySymbol, formatPerLiter, countryCode } = useLocale();

  const [phase, setPhase] = useState<Phase>('go');
  const [doFillUp, setDoFillUp] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const [liters, setLiters] = useState('');
  const [price, setPrice] = useState(
    params.price || activeVehicle?.defaultFuelPrice.toString() || '1.70'
  );
  /** Km réels GPS (ou saisie de secours si GPS = 0). */
  const [distanceKm, setDistanceKm] = useState('');
  const [tripId, setTripId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveSummary, setSaveSummary] = useState('');

  const lat = parseFloat(params.lat || '');
  const lon = parseFloat(params.lon || '');
  const stationName = params.name || 'Station';

  const linkedTrip =
    activeTrip &&
    (tripId != null
      ? activeTrip.id === tripId
      : (activeTrip.destinationName || '').includes(stationName))
      ? activeTrip
      : null;

  const liveKm = linkedTrip?.distanceKm ?? 0;

  useEffect(() => {
    if (phase !== 'go' || !linkedTrip) return;
    if (linkedTrip.distanceKm > 0) {
      setDistanceKm(linkedTrip.distanceKm.toFixed(1));
    }
  }, [linkedTrip?.distanceKm, phase, linkedTrip]);

  useEffect(() => {
    if (activeTrip?.isActive && !tripId) {
      const dest = activeTrip.destinationName || '';
      if (dest === stationName || dest.includes(stationName)) {
        setTripId(activeTrip.id);
      }
    }
  }, [activeTrip, stationName, tripId]);

  const syncDistanceFromTrip = useCallback(async () => {
    await refresh();
    const km = linkedTrip?.distanceKm ?? activeTrip?.distanceKm ?? 0;
    if (km > 0) setDistanceKm(km.toFixed(1));
  }, [refresh, linkedTrip?.distanceKm, activeTrip?.distanceKm]);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active' && (tripId || linkedTrip)) {
        void syncDistanceFromTrip();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [tripId, linkedTrip, syncDistanceFromTrip]);

  const startTripAndOpenMaps = async () => {
    if (!activeVehicle) {
      notify('Erreur', 'Sélectionnez un véhicule.');
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      notify('Erreur', 'Coordonnées station manquantes.');
      return;
    }
    setStarting(true);
    try {
      await stopActiveTrips();
      await stopBackgroundTracking();
      await clearLiveTripBuffer();

      await ensureLocationEnabled();
      const loc = await getCurrentLocation({ fresh: true });
      const startPoint = loc
        ? [
            {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              timestamp: Date.now(),
            },
          ]
        : [];

      const tripId = await createTrip({
        vehicleId: activeVehicle.id,
        startTime: new Date().toISOString(),
        endTime: null,
        distanceKm: 0,
        estimatedFuelUsed: 0,
        estimatedCost: 0,
        routePoints: JSON.stringify(startPoint),
        originName: 'Position de départ',
        destinationName: stationName,
        isActive: true,
        isPaused: false,
        status: 'confirmed',
        source: 'gps',
        fillUpId: null,
        note: `Station ${params.address || ''}`.trim(),
      });
      setTripId(tripId);
      setDistanceKm('0');

      if (activeVehicle.estimatedFuelLiters != null) {
        await recordFuelGaugeReading({
          vehicleId: activeVehicle.id,
          liters: activeVehicle.estimatedFuelLiters,
          source: 'trip_start',
          tripId,
        });
      }

      seedLivePointsCache(tripId, activeVehicle.id, startPoint);
      await seedLiveTripBuffer({
        tripId,
        vehicleId: activeVehicle.id,
        routePoints: JSON.stringify(startPoint),
      });

      const trackingPromise = startBackgroundTracking({ forceRestart: true });
      await launchGoogleMapsNavigation({
        destination: { latitude: lat, longitude: lon },
        origin: loc
          ? { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
          : null,
        label: stationName,
      });

      const trackingStarted = await trackingPromise;
      if (loc) {
        void reverseGeocode(loc.coords.latitude, loc.coords.longitude)
          .then((name) => {
            if (name) return updateTrip(tripId, { originName: name });
          })
          .catch(() => undefined);
      }
      await refresh();

      notify(
        'Trajet démarré',
        trackingStarted
          ? 'Suivi GPS actif — les km vers la station sont enregistrés. Revenez ici à l’arrivée.'
          : 'Maps ouvert. Autorisez la localisation pour tracer les km.'
      );
    } catch (e) {
      notify('Erreur', e instanceof Error ? e.message : 'Impossible de démarrer.');
    } finally {
      setStarting(false);
    }
  };

  /** Arrêt du suivi → passage au formulaire plein avec km réels. */
  const arriveAtStation = async () => {
    setLoading(true);
    try {
      await stopBackgroundTracking();
      await refresh();
      const km = linkedTrip?.distanceKm ?? activeTrip?.distanceKm ?? 0;
      setDistanceKm(km > 0 ? km.toFixed(1) : distanceKm || '');
      if (tripId || linkedTrip?.id) {
        const id = tripId ?? linkedTrip!.id;
        await updateTrip(id, { isPaused: true });
        await refresh();
      }
      setPhase('fill');
    } catch (e) {
      notify('Erreur', e instanceof Error ? e.message : 'Échec');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!activeVehicle) {
      notify('Erreur', 'Sélectionnez un véhicule.');
      return;
    }
    setLoading(true);
    try {
      const km = parseFloat(distanceKm.replace(',', '.')) || 0;
      const fuelEst = (km * activeVehicle.consumptionPer100) / 100;
      let id = tripId ?? linkedTrip?.id ?? null;

      if (id) {
        await stopBackgroundTracking();
        await updateTrip(id, {
          isActive: false,
          isPaused: false,
          endTime: new Date().toISOString(),
          distanceKm: km,
          estimatedFuelUsed: Math.round(fuelEst * 100) / 100,
          estimatedCost: Math.round(fuelEst * activeVehicle.defaultFuelPrice * 100) / 100,
          destinationName: stationName,
          status: 'confirmed',
        });
        if (km > 0) await addTrackedKm(activeVehicle.id, km);
      } else {
        id = await createTrip({
          vehicleId: activeVehicle.id,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          distanceKm: km,
          estimatedFuelUsed: Math.round(fuelEst * 100) / 100,
          estimatedCost: Math.round(fuelEst * activeVehicle.defaultFuelPrice * 100) / 100,
          routePoints: '[]',
          originName: 'Position',
          destinationName: stationName,
          isActive: false,
          status: 'confirmed',
          source: 'manual',
          fillUpId: null,
          note: `Station ${params.address || ''}`.trim(),
        });
        if (km > 0) await addTrackedKm(activeVehicle.id, km);
      }

      if (doFillUp) {
        const L = parseFloat(liters.replace(',', '.'));
        const ppl = parseFloat(price.replace(',', '.'));
        if (!L || L <= 0 || !ppl || ppl <= 0) {
          notify('Plein', 'Indiquez litres et prix, ou désactivez « Faire un plein ».');
          setLoading(false);
          return;
        }
        if (!isSaneFuelPricePerLiter(ppl, countryCode)) {
          notify(
            'Prix / L incohérent',
            `${ppl.toFixed(3)} €/L n’est pas réaliste. Le gazole est en général ~1,5–2,5 €/L.`
          );
          setLoading(false);
          return;
        }
        // Relire le véhicule après addTrackedKm (sinon odo React périmé → km perdus au createFillUp).
        const fresh = (await getVehicleById(activeVehicle.id)) || activeVehicle;
        const preview = previewFillUpFuel(fresh, { liters: L, isFull });
        if (!isFull && preview.exceedsCapacity) {
          notify(
            'Plus que la capacité',
            `${L.toFixed(1)} L dépasse le réservoir noté à ${fresh.tankCapacity} L. Corrige la saisie, ou passe par « Ajouter un plein » pour réajuster le réservoir. Le plein n’est pas enregistré.`
          );
          setLoading(false);
          return;
        }
        const odoNow = fresh.hasOdometer !== false ? displayOdometerKm(fresh) : 0;
        let distanceSinceLastKm: number | null = null;
        const fills = await getFillUps(activeVehicle.id);
        const lastFill = fills[0] || null;
        if (fresh.hasOdometer !== false && lastFill?.odometer != null && odoNow > lastFill.odometer) {
          distanceSinceLastKm = Math.round((odoNow - lastFill.odometer) * 10) / 10;
        } else {
          const since = await getSinceLastFillStats(activeVehicle.id);
          const sinceKm = since.tripKm > 0 ? since.tripKm : km;
          distanceSinceLastKm = sinceKm > 0 ? Math.round(sinceKm * 10) / 10 : km || null;
        }
        const fillId = await createFillUp({
          vehicleId: activeVehicle.id,
          date: new Date().toISOString(),
          liters: L,
          pricePerLiter: ppl,
          totalCost: L * ppl,
          odometer: fresh.hasOdometer !== false ? odoNow || null : null,
          distanceSinceLastKm,
          isFull,
          note: `${stationName} · ${fuelLabel(params.fuelKey || 'gazole')}`,
          tripId: id,
        });
        if (id) await updateTrip(id, { fillUpId: fillId });
        await applyFillUpToFuelEstimate(fresh, { liters: L, isFull, id: fillId });
        if (ppl > 0) await updateVehicle(activeVehicle.id, { defaultFuelPrice: ppl });
        const adapted = await adaptVehicleConsumption(activeVehicle.id);
        await refreshBudgets(activeVehicle.id);
        await refresh();
        void refreshVehicleReminders();
        let msg = `Trajet ${formatDistance(km)} + plein ${L.toFixed(1)} L`;
        if (distanceSinceLastKm && distanceSinceLastKm > km + 1) {
          msg += ` · ${formatDistance(distanceSinceLastKm)} depuis dernier plein`;
        }
        msg += '.';
        if (adapted && adapted.next !== adapted.previous) {
          msg += ` Conso ${adapted.previous.toFixed(1)} → ${adapted.next.toFixed(1)} L/100.`;
        }
        setSaveSummary(msg);
        setPhase('done');
        return;
      }

      await refreshBudgets(activeVehicle.id);
      await refresh();
      setSaveSummary(`Trajet station ${formatDistance(km)} (sans plein).`);
      setPhase('done');
    } catch (e) {
      notify('Erreur', e instanceof Error ? e.message : 'Échec');
    } finally {
      setLoading(false);
    }
  };

  const goBudget = () => {
    router.replace('/(tabs)/budget' as never);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: colors.text }]}>{stationName}</Text>
      <Text style={{ color: colors.textSecondary, marginBottom: 16 }}>
        {params.address || 'Station essence'}
        {params.price ? ` · ${formatPerLiter(parseFloat(params.price))}` : ''}
      </Text>

      {!activeVehicle && (
        <Text style={{ color: colors.danger, marginBottom: 12 }}>
          Sélectionnez un véhicule avant d&apos;enregistrer.
        </Text>
      )}

      {phase === 'go' && (
        <>
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12, lineHeight: 18 }}>
            1. Démarre le suivi GPS et ouvre Maps.{'\n'}
            2. À l’arrivée, revenez ici — les km parcourus remplacent l’estimation.{'\n'}
            3. Saisissez litres / prix, puis voyez le budget.
          </Text>

          <Button
            title="Y aller (Maps + suivi GPS)"
            onPress={startTripAndOpenMaps}
            loading={starting}
          />

          {(tripId || linkedTrip) && (
            <Card style={{ marginTop: 16 }}>
              <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 4 }}>
                Trajet en cours
              </Text>
              <Text style={{ color: colors.accent, fontSize: 28, fontWeight: '800' }}>
                {formatDistance(liveKm)}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 12 }}>
                Distance GPS enregistrée (mise à jour au retour dans l’app)
              </Text>
              <Button
                title="Je suis à la station"
                onPress={arriveAtStation}
                loading={loading}
              />
            </Card>
          )}

          {!tripId && !linkedTrip && (
            <Button
              title="Saisir le plein sans trajet GPS"
              variant="secondary"
              onPress={() => setPhase('fill')}
              style={{ marginTop: 12 }}
            />
          )}
        </>
      )}

      {phase === 'fill' && (
        <>
          <Input
            label="Distance parcourue (km GPS)"
            value={distanceKm}
            onChangeText={setDistanceKm}
            keyboardType="numeric"
            placeholder="Ex. 4.2"
          />
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: -8, marginBottom: 12 }}>
            Remplie par le GPS. Corrigez seulement si besoin.
          </Text>

          <View style={styles.switchRow}>
            <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>Faire un plein</Text>
            <Switch
              value={doFillUp}
              onValueChange={setDoFillUp}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>

          {doFillUp && (
            <>
              <Input
                label="Litres"
                value={liters}
                onChangeText={setLiters}
                keyboardType="numeric"
                placeholder="45"
              />
              <Input
                label={`Prix au litre (${moneySymbol})`}
                value={price}
                onChangeText={setPrice}
                keyboardType="numeric"
              />
              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Plein jusqu’au bouchon</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                    Oui = capacité. Non = reste + litres ajoutés.
                  </Text>
                </View>
                <Switch
                  value={isFull}
                  onValueChange={setIsFull}
                  trackColor={{ false: colors.border, true: colors.accent }}
                />
              </View>
            </>
          )}

          <Button
            title={doFillUp ? 'Enregistrer trajet + plein' : 'Enregistrer trajet sans plein'}
            onPress={save}
            loading={loading}
            style={{ marginTop: 8 }}
          />
          <Button
            title="Retour au suivi GPS"
            variant="secondary"
            onPress={async () => {
              setLoading(true);
              try {
                const id = tripId ?? linkedTrip?.id;
                if (id) {
                  await updateTrip(id, { isPaused: false, isActive: true });
                }
                const loc = await getCurrentLocation();
                if (loc) {
                  await startBackgroundTracking({ forceRestart: true });
                }
                await refresh();
                setPhase('go');
                notify('Suivi', 'GPS repris — continuez vers la station.');
              } catch (e) {
                notify('Erreur', e instanceof Error ? e.message : 'Impossible de reprendre le suivi.');
              } finally {
                setLoading(false);
              }
            }}
            loading={loading}
            style={{ marginTop: 8 }}
          />
        </>
      )}

      {phase === 'done' && (
        <>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>Enregistré</Text>
            <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>{saveSummary}</Text>
            {budgetStatuses.length > 0 ? (
              budgetStatuses.slice(0, 4).map((b) => (
                <View key={b.budget.id} style={{ marginBottom: 12 }}>
                  <View style={styles.budgetRow}>
                    <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                      {b.budget.name}
                    </Text>
                    <Text style={{ color: colors.accent, fontWeight: '700' }}>
                      {formatEuro(Math.max(0, b.remaining))} restants
                    </Text>
                  </View>
                  <ProgressBar percent={b.percentUsed} color={colors.accent} />
                  <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                    {formatEuro(b.spent)} / {formatEuro(b.budget.amount)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={{ color: colors.textSecondary, marginBottom: 8 }}>
                Aucun budget configuré.
              </Text>
            )}
          </Card>
          <Button title="Retour → Budget" onPress={goBudget} style={{ marginTop: 12 }} />
          <Button
            title="Fermer"
            variant="secondary"
            onPress={() => router.back()}
            style={{ marginTop: 8 }}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
});
