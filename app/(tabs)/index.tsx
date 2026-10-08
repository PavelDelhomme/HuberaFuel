import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { useTheme } from '@/hooks/useTheme';
import { useAppUpdate } from '@/context/AppUpdateContext';
import { useToast } from '@/context/ToastContext';
import { Card, StatCard, ProgressBar } from '@/components/Card';
import { Button } from '@/components/Button';
import { SpeedDialFab } from '@/components/SpeedDialFab';
import { PendingAccountsBanner } from '@/components/PendingAccountsBanner';
import { InstallAppHint } from '@/components/InstallAppHint';
import {
  formatEuro,
  formatConsumption,
  formatDistance,
  displayOdometerKm,
  getConsumptionStats,
  getSinceLastFillStats,
  estimateCost,
} from '@/lib/calculations';
import { estimateTripFuelLiters } from '@/lib/consumptionModel';
import { seedDemoData } from '@/lib/seedDemo';
import { seedTodayCommuteAndFillUp } from '@/lib/seedToday';
import { notify } from '@/lib/notify';
import { getPlaces, getMaintenances, getTrips, reconcileTrackedKmFromTrips } from '@/lib/database';
import { syncFailureMessage } from '@/lib/api';
import { computeBudgetOutlook } from '@/lib/budgetOutlook';
import { fuelGaugeSaveSummary, fuelRemainingTone, fuelToneColor, setFuelLiters } from '@/lib/fuelLevel';
import { checkNearestStationReach } from '@/lib/nearestStationReach';
import { getCurrentLocation } from '@/lib/locationService';
import { FuelGaugeSlider } from '@/components/FuelGaugeSlider';
import { TutorialAnchor } from '@/components/TutorialAnchor';
import type { ConsumptionStats, Place, SinceLastFillStats, Trip, VehicleMaintenance } from '@/types';
import { MAINTENANCE_KIND_LABELS, maintenanceIsUrgent } from '@/lib/vehicleMaintenance';
import { formatDateSlash, formatRelativeDay, toLocalYmd } from '@/lib/dates';
import { tripHistoryNav } from '@/lib/tripHistoryNav';

export default function HomeScreen() {
  const { activeVehicle, activeTrip, budgetStatuses, refresh, vehicles, selectVehicle, isLoading } = useApp();
  const { syncNow, pushLocalNow, user } = useAuth();
  const { colors } = useTheme();
  const { locale, countryCode } = useLocale();
  const { checkNow } = useAppUpdate();
  const { showToast } = useToast();
  const [stats, setStats] = useState<ConsumptionStats | null>(null);
  const [sinceFill, setSinceFill] = useState<SinceLastFillStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedingToday, setSeedingToday] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [dueMaintenances, setDueMaintenances] = useState<VehicleMaintenance[]>([]);
  const [todayTrips, setTodayTrips] = useState<Trip[]>([]);
  const [homeFuelDraft, setHomeFuelDraft] = useState<number | null>(null);
  const [stationCheckBusy, setStationCheckBusy] = useState(false);

  useEffect(() => {
    setHomeFuelDraft(activeVehicle?.estimatedFuelLiters ?? null);
  }, [activeVehicle?.id, activeVehicle?.estimatedFuelLiters]);

  const reloadStats = async (vehicleId: number) => {
    const [s, since, trips] = await Promise.all([
      getConsumptionStats(vehicleId),
      getSinceLastFillStats(vehicleId),
      getTrips(vehicleId, { omitRoutePoints: true }),
    ]);
    setStats(s);
    setSinceFill(since);
    const ymd = toLocalYmd(new Date());
    setTodayTrips(
      trips.filter((t) => {
        if (t.isActive || t.distanceKm < 0.05) return false;
        try {
          return toLocalYmd(new Date(t.startTime)) === ymd;
        } catch {
          return t.startTime.slice(0, 10) === ymd;
        }
      })
    );
  };

  const reloadDueMaintenances = async () => {
    try {
      const list = await getMaintenances();
      setDueMaintenances(
        list.filter((m) => {
          if (m.status === 'done' || m.status === 'cancelled') return false;
          if (m.dueDate || m.status === 'overdue') return true;
          const v = vehicles.find((x) => x.id === m.vehicleId);
          const odo = v ? displayOdometerKm(v) : null;
          return (
            (m.dueOdometer != null && m.dueOdometer > 0) ||
            maintenanceIsUrgent(m, 14, odo)
          );
        })
      );
    } catch {
      setDueMaintenances([]);
    }
  };

  useEffect(() => {
    void getPlaces().then(setPlaces).catch(() => setPlaces([]));
    void reloadDueMaintenances();
    if (activeVehicle) {
      void (async () => {
        try {
          await reconcileTrackedKmFromTrips(activeVehicle.id);
          await refresh();
        } catch {
          /* ignore */
        }
        await reloadStats(activeVehicle.id);
      })();
    } else {
      setStats(null);
      setSinceFill(null);
    }
  }, [activeVehicle?.id, activeVehicle?.estimatedFuelLiters]);

  // Toujours rafraîchir « depuis le dernier plein » pour le véhicule sélectionné
  useFocusEffect(
    useCallback(() => {
      if (!activeVehicle) {
        setSinceFill(null);
        setStats(null);
        return;
      }
      void reloadStats(activeVehicle.id);
    }, [activeVehicle?.id, activeVehicle?.estimatedFuelLiters])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    try {
      const result = await syncNow();
      await refresh();
      if (result === 'pulled') showToast('Cloud téléchargé');
      else if (result === 'pushed') showToast('Sauvegarde envoyée au cloud');
      else if (result === 'blocked-trip') showToast('Sync reportée — terminez le trajet d’abord');
      else if (result === 'up-to-date') showToast('Déjà synchronisé');
      else showToast('Synchronisation à jour');
    } catch (e) {
      const fail = syncFailureMessage(e);
      showToast(fail.message);
    }
    try {
      await checkNow();
    } catch {
      /* ignore */
    }
    if (activeVehicle) await reloadStats(activeVehicle.id);
    const p = await getPlaces().catch(() => [] as Place[]);
    setPlaces(p);
    await reloadDueMaintenances();
    setRefreshing(false);
  };

  const loadDemo = async () => {
    setSeeding(true);
    try {
      const res = await seedDemoData();
      await refresh();
      notify(
        'Données démo chargées',
        `${res.trips} trajets + pleins + budget sur le véhicule #${res.vehicleId}.`
      );
    } catch (e) {
      notify('Démo', e instanceof Error ? e.message : 'Échec');
    } finally {
      setSeeding(false);
    }
  };

  const loadToday = async () => {
    if (!activeVehicle) {
      notify('Véhicule', 'Sélectionnez un véhicule d’abord.');
      return;
    }
    setSeedingToday(true);
    try {
      const res = await seedTodayCommuteAndFillUp(activeVehicle.id);
      await refresh();
      await reloadStats(activeVehicle.id);
      notify(
        'Journée ajoutée',
        `${res.tripsAdded} trajet(s) domicile↔travail` +
          (res.fillUpAdded ? ' + plein du jour' : ' (plein déjà présent)') +
          '.'
      );
    } catch (e) {
      notify('Aujourd’hui', e instanceof Error ? e.message : 'Échec');
    } finally {
      setSeedingToday(false);
    }
  };

  const startNavToPlace = (p: Place) => {
    const dest = p.address?.trim() || p.name;
    const hasCoords = p.latitude != null && p.longitude != null;
    router.push({
      pathname: '/(tabs)/trip' as never,
      params: {
        mode: 'nav',
        dest,
        destLat: hasCoords ? String(p.latitude) : '',
        destLon: hasCoords ? String(p.longitude) : '',
        // Auto-start désactivé : on prépare la destination ; l’utilisateur choisit l’itinéraire.
        autoStart: '0',
        prepare: hasCoords ? '1' : '0',
      },
    } as never);
  };

  const checkReachNearestStation = useCallback(async () => {
    if (!activeVehicle || stationCheckBusy) return;
    const liters = activeVehicle.estimatedFuelLiters ?? null;
    if (liters == null) {
      notify('Carburant', 'Indiquez d’abord le niveau sur la jauge.');
      return;
    }
    setStationCheckBusy(true);
    try {
      const loc = await getCurrentLocation();
      if (!loc) {
        notify('GPS', 'Activez la localisation pour trouver une station.');
        return;
      }
      const res = await checkNearestStationReach({
        vehicle: activeVehicle,
        litersRemaining: liters,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        countryCode,
      });
      if (!res) {
        notify('Stations', 'Aucune station trouvée à proximité (France open data).');
        return;
      }
      const extra = res.best
        ? `\n\nMoins chère intéressante : ${res.best.name} · ${res.best.distanceKm.toFixed(1)} km · ${res.best.pricePerL.toFixed(3)} €/L` +
          (res.best.canReach ? '' : ' (détour risqué)')
        : '';
      Alert.alert(
        res.canReachNearest ? 'Assez pour la station' : 'Attention — marge faible',
        res.message + extra,
        [
          { text: 'OK', style: 'cancel' },
          {
            text: 'Nouveau plein',
            onPress: () => router.push('/fillup/add' as never),
          },
        ]
      );
    } catch (e) {
      notify('Stations', e instanceof Error ? e.message : 'Échec');
    } finally {
      setStationCheckBusy(false);
    }
  }, [activeVehicle, stationCheckBusy, countryCode]);

  const mainBudget = budgetStatuses.find((s) => s.budget.vehicleId == null) || budgetStatuses[0];
  const homePlace = places.find((p) => p.kind === 'home');
  const workPlace = places.find((p) => p.kind === 'work');
  const favoritePlaces = places.filter((p) => p.kind === 'other' || p.kind === 'station');
  const budgetOutlook = mainBudget
    ? computeBudgetOutlook({
        allocation: mainBudget.budget.amount,
        spent: mainBudget.spent,
        startDate: mainBudget.budget.startDate,
        endDate: mainBudget.budget.endDate,
        vehicles: activeVehicle ? [activeVehicle] : [],
        plannedMonthSpend: 0,
      })
    : null;

  const todayKm = todayTrips.reduce((s, t) => s + t.distanceKm, 0);
  const todayFuel = todayTrips
    .filter((t) => t.estimatedFuelUsed > 0.05)
    .reduce((s, t) => s + t.estimatedFuelUsed, 0);
  const todayCost = todayTrips.reduce((s, t) => s + t.estimatedCost, 0);

  /** Pendant un trajet actif, recalcule conso si pas encore persistée (évite 0,02 L fantômes). */
  const activeTripFuel =
    activeTrip && activeVehicle
      ? activeTrip.estimatedFuelUsed > 0.05
        ? activeTrip.estimatedFuelUsed
        : estimateTripFuelLiters(activeVehicle, activeTrip.distanceKm, {
            learnedFactor: activeVehicle.consumptionLearnFactor,
          })
      : 0;
  const activeTripCost =
    activeTrip && activeVehicle
      ? activeTrip.estimatedCost > 0.05
        ? activeTrip.estimatedCost
        : estimateCost(activeTripFuel, activeVehicle.defaultFuelPrice)
      : 0;

  const fuelTone = activeVehicle
    ? fuelRemainingTone({
        litersRemaining: activeVehicle.estimatedFuelLiters ?? null,
        tankCapacity: activeVehicle.tankCapacity,
        lowLitersThreshold: activeVehicle.lowFuelThresholdLiters,
        rangeKm:
          activeVehicle.estimatedFuelLiters != null ? sinceFill?.rangeKm : undefined,
        vehicle: activeVehicle,
      })
    : 'unknown';
  const fuelColor = fuelToneColor(fuelTone, colors);
  const litersNow = activeVehicle?.estimatedFuelLiters ?? null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 200 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <PendingAccountsBanner />
        <InstallAppHint />
        {isLoading && !activeVehicle && vehicles.length === 0 ? (
          <Card style={styles.emptyCard}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.emptyText, { color: colors.textSecondary, marginTop: 16 }]}>
              Chargement…
            </Text>
          </Card>
        ) : !activeVehicle ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="car-outline" size={48} color={colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Aucun véhicule actif</Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {user
                ? 'Tirez pour actualiser, ou ☰ → « Actualiser depuis le cloud » pour récupérer vos véhicules et trajets.'
                : 'Vos données sont sur le serveur prod. Connectez-vous avec votre compte pour les récupérer automatiquement.'}
            </Text>
            {!user ? (
              <Button
                title="Connexion"
                onPress={() => router.push('/auth' as never)}
                style={{ marginTop: 16 }}
              />
            ) : (
              <Button
                title="Actualiser depuis le cloud"
                onPress={() => void onRefresh()}
                style={{ marginTop: 16 }}
              />
            )}
            <Button
              title="Ajouter un véhicule"
              variant="outline"
              onPress={() => router.push('/vehicle/add')}
              style={{ marginTop: 10 }}
            />
            {vehicles.length === 0 && __DEV__ && (
              <Button
                title="Charger un exemple (données de démo)"
                variant="outline"
                loading={seeding}
                onPress={loadDemo}
                style={{ marginTop: 10 }}
              />
            )}
          </Card>
        ) : (
          <>
            <TutorialAnchor id="home-vehicle">
            <Card style={styles.vehicleHeader}>
              <View style={styles.vehicleRow}>
                <View style={styles.vehicleInfo}>
                  <Text style={[styles.vehicleName, { color: colors.text }]}>
                    {activeVehicle.name}
                  </Text>
                  <Text style={[styles.vehicleDetail, { color: colors.textSecondary }]}>
                    {displayOdometerKm(activeVehicle).toLocaleString(locale)} km
                    {activeVehicle.fuelType ? ` · ${activeVehicle.fuelType}` : ''}
                    {activeVehicle.year ? ` · année ${activeVehicle.year}` : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {vehicles.length > 1 && (
                    <Pressable
                      onPress={() => {
                        Alert.alert(
                          'Changer de véhicule',
                          'Sélectionnez le véhicule actif',
                          [
                            ...vehicles.map((v) => ({
                              text: v.id === activeVehicle.id ? `✓ ${v.name}` : v.name,
                              onPress: () => void selectVehicle(v.id),
                            })),
                            { text: 'Annuler', style: 'cancel' as const },
                          ]
                        );
                      }}
                      hitSlop={10}
                      style={[styles.iconBtn, { borderColor: colors.border }]}
                      accessibilityLabel="Changer de véhicule"
                    >
                      <Ionicons name="swap-horizontal" size={18} color={colors.accent} />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={onRefresh}
                    hitSlop={10}
                    style={[styles.iconBtn, { borderColor: colors.border }]}
                    accessibilityLabel="Actualiser les données"
                  >
                    <Ionicons name="refresh" size={18} color={colors.accent} />
                  </Pressable>
                </View>
              </View>
              <View
                style={{ marginTop: 6 }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
              >
                <FuelGaugeSlider
                  requireConfirm
                  tankCapacity={activeVehicle.tankCapacity}
                  liters={homeFuelDraft}
                  accentColor={fuelColor}
                  vehicle={activeVehicle}
                  onChange={setHomeFuelDraft}
                  onChangeEnd={async (L) => {
                    setHomeFuelDraft(L);
                    const adj = await setFuelLiters(activeVehicle, L);
                    await refresh();
                    await reloadStats(activeVehicle.id);
                    notify('Réservoir', fuelGaugeSaveSummary(adj));
                    // Push forcé : un syncPreferNewer peut PULL un cloud sans jauge et tout effacer.
                    try {
                      const r = await pushLocalNow();
                      if (r?.ok) showToast('Jauge synchronisée');
                    } catch {
                      /* offline OK — local déjà sauvé */
                    }
                  }}
                />
                {(() => {
                  // Uniquement la jauge véhicule — pas sinceFill (0 par défaut sans plein → « ~0.0 L » fantôme).
                  const rem = homeFuelDraft ?? activeVehicle.estimatedFuelLiters ?? null;
                  if (rem == null) return null;
                  const rangeKm =
                    rem > 0 && activeVehicle.consumptionPer100 > 0
                      ? Math.round((rem / activeVehicle.consumptionPer100) * 100)
                      : sinceFill?.rangeKm && activeVehicle.estimatedFuelLiters != null
                        ? sinceFill.rangeKm
                        : 0;
                  return (
                    <Text
                      style={{
                        color: fuelColor,
                        fontWeight: '800',
                        fontSize: 15,
                        textAlign: 'center',
                        marginTop: 6,
                      }}
                    >
                      ~{rem.toFixed(1)} L
                      {rangeKm > 0 ? ` · ~${Math.round(rangeKm)} km` : ''}
                    </Text>
                  );
                })()}
              </View>
            </Card>
            </TutorialAnchor>

            {(todayTrips.length > 0 || todayKm > 0) && (
              <Pressable
                onPress={() =>
                  router.push(
                    tripHistoryNav({
                      filter: 'today',
                      vehicleId: activeVehicle.id,
                    }) as never
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={`Trajets d’aujourd’hui, ${todayTrips.length} trajet${todayTrips.length > 1 ? 's' : ''}, ${formatDistance(todayKm)}`}
              >
              <Card style={{ marginTop: 12 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800' }}>
                  AUJOURD’HUI
                </Text>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>
                      {formatDistance(todayKm)}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11 }}>
                      {todayTrips.length} trajet{todayTrips.length > 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>
                      {todayFuel.toFixed(1)} L
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11 }}>estimé</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 18 }}>
                      {formatEuro(todayCost)}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11 }}>coût</Text>
                  </View>
                </View>
                <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 12, marginTop: 8 }}>
                  Voir les trajets du jour →
                </Text>
              </Card>
              </Pressable>
            )}

            {activeTrip && (
              <Card style={{ ...styles.tripBanner, borderColor: colors.accent }}>
                <View style={styles.tripHeader}>
                  <Ionicons name="navigate-circle" size={24} color={colors.accent} />
                  <Text style={[styles.tripTitle, { color: colors.accent }]}>Trajet en cours</Text>
                </View>
                <View style={styles.tripStats}>
                  <Text style={[styles.tripStat, { color: colors.text }]}>
                    {formatDistance(activeTrip.distanceKm)}
                  </Text>
                  <Text style={[styles.tripStat, { color: colors.text }]}>
                    {activeTripFuel.toFixed(2)} L
                  </Text>
                  <Text style={[styles.tripStat, { color: colors.text }]}>
                    {formatEuro(activeTripCost)}
                  </Text>
                </View>
                <Button
                  title="Voir le trajet"
                  variant="outline"
                  onPress={() => router.push('/(tabs)/trip')}
                  style={{ marginTop: 8 }}
                />
              </Card>
            )}

            <View style={styles.statsRow}>
              <StatCard
                label="Conso."
                value={
                  stats && stats.averageConsumption > 0
                    ? formatConsumption(stats.averageConsumption, activeVehicle.fuelType)
                    : formatConsumption(activeVehicle.consumptionPer100, activeVehicle.fuelType)
                }
                subtitle={
                  stats && stats.averageConsumption > 0 ? 'D’après vos pleins' : 'Catalogue'
                }
              />
              <StatCard
                label="Autonomie"
                value={formatDistance(sinceFill?.rangeKm ?? 0)}
                color={fuelColor}
                subtitle={
                  homeFuelDraft != null ? `${homeFuelDraft.toFixed(0)} L restants` : undefined
                }
              />
            </View>

            {sinceFill?.lastFill && (
              <Pressable
                onPress={() =>
                  router.push(
                    tripHistoryNav({
                      filter: 'sinceFill',
                      vehicleId: activeVehicle.id,
                    }) as never
                  )
                }
                accessibilityRole="button"
                accessibilityLabel="Voir les trajets depuis le dernier plein"
              >
                <Card style={{ marginBottom: 12 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700' }}>
                    Depuis le plein · {formatRelativeDay(sinceFill.lastFill.date)}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginTop: 4 }}>
                    {formatDistance(sinceFill.tripKm)}
                    <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 13 }}>
                      {' '}
                      · {sinceFill.tripCount} trajet{sinceFill.tripCount > 1 ? 's' : ''} · ~
                      {sinceFill.fuelUsedEst.toFixed(1)} L
                    </Text>
                  </Text>
                  <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 12, marginTop: 6 }}>
                    Voir l’historique filtré →
                  </Text>
                </Card>
              </Pressable>
            )}

            {!sinceFill?.lastFill && (
              <Card style={{ marginBottom: 12 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 10 }}>
                  Enregistrez un plein pour suivre km et autonomie.
                </Text>
                <Button title="Nouveau plein" onPress={() => router.push('/fillup/add')} />
              </Card>
            )}

            {(fuelTone === 'warn' || fuelTone === 'critical') && (
              <Card
                style={{
                  marginBottom: 12,
                  borderColor: fuelColor,
                  borderWidth: 1.5,
                }}
              >
                <Text style={{ color: fuelColor, fontWeight: '800', fontSize: 14 }}>
                  {fuelTone === 'critical' ? 'Réservoir critique' : 'Carburant bas'}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
                  {fuelTone === 'critical'
                    ? 'Allez à une station bientôt (plus proche ou moins chère à portée).'
                    : 'Vérifiez si vous atteignez au moins la station la plus proche.'}
                </Text>
                <Button
                  title="Nouveau plein"
                  onPress={() => router.push('/fillup/add')}
                  style={{ marginTop: 8 }}
                />
                <Button
                  title={stationCheckBusy ? 'Recherche…' : 'Assez pour la station ?'}
                  variant="outline"
                  onPress={() => void checkReachNearestStation()}
                  disabled={stationCheckBusy || litersNow == null}
                  style={{ marginTop: 8 }}
                />
              </Card>
            )}

            {fuelTone === 'ok' && litersNow != null && activeVehicle && (
              <Pressable
                onPress={() => void checkReachNearestStation()}
                disabled={stationCheckBusy}
                style={{ marginBottom: 10, alignSelf: 'flex-start' }}
              >
                <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 13 }}>
                  {stationCheckBusy ? 'Recherche station…' : 'Assez pour la station la plus proche ?'}
                </Text>
              </Pressable>
            )}

            {/* Totaux : toujours sous la jauge / depuis-plein, jamais chevauchés */}
            <View style={[styles.statsRow, { alignItems: 'stretch' }]}>
              <StatCard
                label="Dépensé"
                value={formatEuro(stats?.totalCost ?? 0)}
                subtitle={`${stats?.fillUpCount ?? 0} plein(s)`}
                onPress={() => router.push('/(tabs)/budget' as never)}
              />
              <StatCard
                label="Distance"
                value={formatDistance(stats?.totalDistance ?? 0)}
                subtitle="tous trajets"
                onPress={() =>
                  router.push(
                    tripHistoryNav({
                      filter: 'all',
                      vehicleId: activeVehicle.id,
                    }) as never
                  )
                }
              />
            </View>

            {mainBudget && (
              <Pressable
                onPress={() => router.push('/(tabs)/budget' as never)}
                accessibilityRole="button"
                accessibilityLabel={`Budget ${mainBudget.budget.name}, ouvrir le détail`}
                accessibilityHint="Ouvre l’onglet Budget"
              >
                <Card style={styles.budgetCard}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {mainBudget.budget.name}
                  </Text>
                  <Text
                    style={{
                      color:
                        mainBudget.percentUsed > 100
                          ? colors.danger
                          : mainBudget.percentUsed > 80
                            ? colors.warning
                            : colors.success,
                      fontWeight: '800',
                      fontSize: 22,
                      marginBottom: 6,
                    }}
                  >
                    {mainBudget.percentUsed > 100
                      ? `Dépassé de ${formatEuro(mainBudget.spent - mainBudget.budget.amount)}`
                      : `Il reste ${formatEuro(mainBudget.remaining)}`}
                  </Text>
                  <ProgressBar
                    percent={Math.min(100, mainBudget.percentUsed)}
                    color={
                      mainBudget.percentUsed > 100
                        ? colors.danger
                        : mainBudget.percentUsed > 80
                          ? colors.warning
                          : colors.success
                    }
                    height={12}
                  />
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8 }}>
                    {formatEuro(mainBudget.spent)} dépensés sur {formatEuro(mainBudget.budget.amount)}
                  </Text>
                  {budgetOutlook && budgetOutlook.rangeKm > 0 && (
                    <View
                      style={{
                        marginTop: 10,
                        padding: 10,
                        borderRadius: 12,
                        backgroundColor: colors.background,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                        {budgetOutlook.adjustedRemaining >= 0
                          ? `Reste estimé ${formatEuro(budgetOutlook.adjustedRemaining)}`
                          : `Manque estimé ${formatEuro(Math.abs(budgetOutlook.adjustedRemaining))}`}
                      </Text>
                      <Text
                        style={{
                          color: colors.textSecondary,
                          fontSize: 12,
                          marginTop: 4,
                          lineHeight: 17,
                        }}
                      >
                        Autonomie ~{formatDistance(budgetOutlook.rangeKm)}
                        {budgetOutlook.fuelStockValue > 0
                          ? ` · stock ${formatEuro(budgetOutlook.fuelStockValue)}`
                          : ''}
                        {' · '}
                        {Math.ceil(budgetOutlook.remainingDays)} j. restants dans le mois
                      </Text>
                    </View>
                  )}
                  <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 8 }}>
                    Voir le budget →
                  </Text>
                </Card>
              </Pressable>
            )}

            {dueMaintenances.length > 0 && (
              <Card style={{ marginBottom: 16, borderColor: colors.warning, borderWidth: 1 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>
                    Entretien à prévoir
                  </Text>
                  {dueMaintenances.length > 4 && (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/vehicle/maintenance' as never,
                          params: { id: String(activeVehicle.id) },
                        })
                      }
                    >
                      <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>
                        Voir tout
                      </Text>
                    </Pressable>
                  )}
                </View>
                {dueMaintenances.slice(0, 4).map((m) => {
                  const v = vehicles.find((x) => x.id === m.vehicleId);
                  const urgent =
                    maintenanceIsUrgent(m, 14, v ? displayOdometerKm(v) : null) ||
                    m.status === 'overdue';
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() =>
                        router.push({
                          pathname: '/vehicle/maintenance' as never,
                          params: { id: String(m.vehicleId) },
                        })
                      }
                      style={{ marginBottom: 10 }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: urgent ? colors.danger : colors.warning,
                          }}
                        />
                        <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>
                          {v?.name || 'Véhicule'} · {m.title}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: urgent ? colors.danger : colors.warning,
                          fontSize: 13,
                          marginTop: 2,
                          marginLeft: 16,
                        }}
                      >
                        {urgent ? 'Urgent · ' : ''}
                        {MAINTENANCE_KIND_LABELS[m.kind]}
                        {m.dueDate ? ` · avant le ${formatDateSlash(m.dueDate)}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </Card>
            )}

            {(homePlace || workPlace || favoritePlaces.length > 0) && (
              <Card style={{ marginBottom: 16 }}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Trajets rapides</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 10 }}>
                  Depuis votre position actuelle vers un lieu enregistré.
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {homePlace && (
                    <Pressable
                      onPress={() => startNavToPlace(homePlace)}
                      style={[styles.quickChip, { borderColor: colors.accent, backgroundColor: colors.card }]}
                    >
                      <Text style={{ color: colors.accent, fontWeight: '800' }}>Maison</Text>
                    </Pressable>
                  )}
                  {workPlace && (
                    <Pressable
                      onPress={() => startNavToPlace(workPlace)}
                      style={[styles.quickChip, { borderColor: colors.accent, backgroundColor: colors.card }]}
                    >
                      <Text style={{ color: colors.accent, fontWeight: '800' }}>Travail</Text>
                    </Pressable>
                  )}
                  {favoritePlaces.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => startNavToPlace(p)}
                      style={[styles.quickChip, { borderColor: colors.border, backgroundColor: colors.card }]}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700' }}>{p.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </Card>
            )}

            {__DEV__ && (
              <Button
                title="Ajouter journée type (aujourd’hui)"
                variant="outline"
                loading={seedingToday}
                onPress={loadToday}
                style={{ marginTop: 4, marginBottom: 24 }}
              />
            )}
          </>
        )}
      </ScrollView>

      <TutorialAnchor id="home-fabs">
        <SpeedDialFab
          dual
          actions={[
            {
              key: 'fillup',
              label: 'Nouveau plein',
              icon: 'gas-pump',
              onPress: () => {
                if (!activeVehicle) {
                  router.push('/(tabs)/vehicles' as never);
                  return;
                }
                router.push('/fillup/add');
              },
            },
            activeTrip
              ? {
                  key: 'trip',
                  label: 'Voir trajet',
                  icon: 'navigate',
                  onPress: () => router.push('/(tabs)/trip'),
                }
              : {
                  key: 'trip',
                  label: 'Démarrer trajet',
                  icon: 'map',
                  onPress: () => {
                    if (!activeVehicle) {
                      router.push('/(tabs)/vehicles' as never);
                      return;
                    }
                    router.push('/(tabs)/maps' as never);
                  },
                },
          ]}
        />
      </TutorialAnchor>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, padding: 16 },
  emptyCard: { alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginTop: 16 },
  emptyText: { fontSize: 14, textAlign: 'center', marginTop: 8 },
  vehicleHeader: { marginBottom: 16 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vehicleInfo: { flex: 1 },
  vehicleName: { fontSize: 20, fontWeight: '700' },
  vehicleDetail: { fontSize: 14, marginTop: 2 },
  odometer: { fontSize: 13, marginTop: 8 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: 120,
    flexShrink: 1,
  },
  vehChipRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 6,
    marginTop: 8,
    alignItems: 'center',
  },
  tripBanner: { marginBottom: 16, borderWidth: 2 },
  tripHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  tripTitle: { fontSize: 16, fontWeight: '700' },
  tripStats: { flexDirection: 'row', justifyContent: 'space-around' },
  tripStat: { fontSize: 18, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    width: '100%',
  },
  budgetCard: { marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  quickChip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
