import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useLocale } from '@/context/LocaleContext';
import { Card, StatCard } from '@/components/Card';
import { Button } from '@/components/Button';
import { FuelGaugeSlider } from '@/components/FuelGaugeSlider';
import { FuelGaugeTimeline } from '@/components/FuelGaugeTimeline';
import { FUEL_TYPE_LABELS } from '@/constants/Colors';
import {
  displayOdometerKm,
  formatConsumption,
  formatDistance,
  formatEuro,
  getSinceLastFillStats,
} from '@/lib/calculations';
import { getFillUps, getTrips } from '@/lib/database';
import { fuelGaugeSaveSummary, fuelRemainingTone, fuelToneColor, setFuelLiters } from '@/lib/fuelLevel';
import { formatRelativeDay } from '@/lib/dates';
import { notify } from '@/lib/notify';
import { updateVehicle } from '@/lib/database';
import { MaintenanceStatusPanel } from '@/components/MaintenanceStatusPanel';
import { TutorialAnchor } from '@/components/TutorialAnchor';
import { syncFailureMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import type { FillUp, SinceLastFillStats, Trip } from '@/types';

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicleId = Number(id);
  const { vehicles, activeVehicle, selectVehicle, refresh } = useApp();
  const { syncNow, pushLocalNow } = useAuth();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const { locale } = useLocale();
  const vehicle = vehicles.find((v) => v.id === vehicleId) || null;
  const [fills, setFills] = useState<FillUp[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [since, setSince] = useState<SinceLastFillStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftFuel, setDraftFuel] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(vehicleId)) return;
    setLoading(true);
    try {
      const [f, t, s] = await Promise.all([
        getFillUps(vehicleId),
        getTrips(vehicleId),
        getSinceLastFillStats(vehicleId),
      ]);
      setFills(f.slice(0, 5));
      setTrips(
        t
          .filter((x) => !x.isActive && x.distanceKm > 0.05)
          .sort((a, b) => b.startTime.localeCompare(a.startTime))
          .slice(0, 5)
      );
      setSince(s);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void refresh();
    }, [load, refresh])
  );

  React.useEffect(() => {
    setDraftFuel(vehicle?.estimatedFuelLiters ?? null);
  }, [vehicle?.id, vehicle?.estimatedFuelLiters]);

  if (!vehicle) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: 'Véhicule' }} />
        <Text style={{ color: colors.textSecondary }}>Véhicule introuvable</Text>
        <Button title="Retour" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </View>
    );
  }

  const tone = fuelRemainingTone({
    litersRemaining: vehicle.estimatedFuelLiters,
    tankCapacity: vehicle.tankCapacity,
    lowLitersThreshold: vehicle.lowFuelThresholdLiters,
    rangeKm: since?.rangeKm,
    vehicle,
  });
  const fuelColor = fuelToneColor(tone, colors);
  const isActive = activeVehicle?.id === vehicle.id;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={loading || syncing}
          onRefresh={async () => {
            setSyncing(true);
            try {
              await load();
              await refresh();
              const result = await syncNow();
              await refresh();
              await load();
              if (result === 'pulled') showToast('Cloud téléchargé');
              else if (result === 'pushed') showToast('Sauvegarde envoyée au cloud');
              else if (result === 'blocked-trip') showToast('Sync reportée — trajet en cours');
              else if (result === 'up-to-date') showToast('Déjà synchronisé');
            } catch (e) {
              showToast(syncFailureMessage(e).message);
            } finally {
              setSyncing(false);
            }
          }}
        />
      }
    >
      <Stack.Screen options={{ title: vehicle.name }} />
      <TutorialAnchor id="vehicle-detail-card">
      <Card>
        <View style={styles.header}>
          <Ionicons name="car-sport" size={36} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: colors.text }]}>{vehicle.name}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              {vehicle.brand} {vehicle.model} · {vehicle.year} · {FUEL_TYPE_LABELS[vehicle.fuelType]}
            </Text>
            {isActive && (
              <Text style={{ color: colors.accent, fontWeight: '700', marginTop: 4, fontSize: 12 }}>
                Véhicule actif
              </Text>
            )}
          </View>
        </View>
        <View style={styles.statsRow}>
          <StatCard
            label="Compteur"
            value={`${displayOdometerKm(vehicle).toLocaleString(locale)} km`}
          />
          <StatCard
            label="Conso"
            value={formatConsumption(vehicle.consumptionPer100, vehicle.fuelType)}
          />
        </View>
        <View style={styles.statsRow}>
          <StatCard label="Réservoir" value={`${vehicle.tankCapacity} L`} />
          <StatCard
            label="Autonomie"
            value={since?.rangeKm ? formatDistance(since.rangeKm) : '—'}
          />
        </View>
      </Card>
      </TutorialAnchor>

      <Card>
        <Text style={[styles.section, { color: colors.text }]}>Niveau carburant</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8 }}>
          Marques 0 · 1/4 · 1/2 · 3/4 · 1 — comme sur le tableau de bord.
        </Text>
        <FuelGaugeSlider
          requireConfirm
          tankCapacity={vehicle.tankCapacity}
          liters={draftFuel}
          accentColor={fuelColor}
          onChange={setDraftFuel}
          onChangeEnd={async (L) => {
            setDraftFuel(L);
            const adj = await setFuelLiters(vehicle, L);
            await refresh();
            await load();
            notify('Réservoir', fuelGaugeSaveSummary(adj));
            void pushLocalNow().then(async (r) => {
              if (r?.ok) showToast('Jauge synchronisée');
              await refresh();
              await load();
            });
          }}
        />
        {since?.lastFill && (
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 10 }}>
            Dernier plein : {formatRelativeDay(since.lastFill.date)} ·{' '}
            {formatEuro(since.lastFill.totalCost)} · ~{since.fuelRemainingEst.toFixed(1)} L restants
          </Text>
        )}
      </Card>

      <FuelGaugeTimeline vehicleId={vehicle.id} compact limit={24} />

      <Card>
        <Text style={[styles.section, { color: colors.text }]}>Derniers pleins</Text>
        {loading && fills.length === 0 ? (
          <ActivityIndicator color={colors.accent} />
        ) : fills.length === 0 ? (
          <Text style={{ color: colors.textSecondary }}>Aucun plein</Text>
        ) : (
          fills.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => router.push(`/fillup/${f.id}` as never)}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>
                {formatRelativeDay(f.date)} · {f.liters.toFixed(1)} L
              </Text>
              <Text style={{ color: colors.accent, fontWeight: '700' }}>
                {formatEuro(f.totalCost)}
              </Text>
            </Pressable>
          ))
        )}
      </Card>

      <Card>
        <Text style={[styles.section, { color: colors.text }]}>Derniers trajets</Text>
        {trips.length === 0 ? (
          <Text style={{ color: colors.textSecondary }}>Aucun trajet</Text>
        ) : (
          trips.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => router.push(`/trip/${t.id}` as never)}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                {t.originName || 'Départ'} → {t.destinationName || 'Arrivée'}
              </Text>
              <Text style={{ color: colors.textSecondary }}>{formatDistance(t.distanceKm)}</Text>
            </Pressable>
          ))
        )}
      </Card>

      <MaintenanceStatusPanel
        upToDate={vehicle.maintenanceUpToDate}
        checklist={vehicle.maintenanceChecklist}
        currentOdometer={displayOdometerKm(vehicle)}
        onChangeUpToDate={async (v) => {
          await updateVehicle(vehicle.id, { maintenanceUpToDate: v });
          await refresh();
          notify('Entretien', v === true ? 'Marqué à jour' : v === false ? 'Marqué non à jour' : 'Non renseigné');
        }}
        onChangeChecklist={async (next) => {
          await updateVehicle(vehicle.id, { maintenanceChecklist: next });
          await refresh();
        }}
      />

      {vehicle.plateNumber ? (
        <Card>
          <Text style={[styles.section, { color: colors.text }]}>Immatriculation</Text>
          <Text style={{ color: colors.text, fontWeight: '700', letterSpacing: 1 }}>
            {vehicle.plateNumber}
          </Text>
        </Card>
      ) : null}

      <View style={{ gap: 10, marginTop: 4 }}>
        {!isActive && (
          <Button
            title="Sélectionner ce véhicule"
            onPress={async () => {
              await selectVehicle(vehicle.id);
              notify('Véhicule', `${vehicle.name} actif`);
            }}
          />
        )}
        <Button
          title="Modifier"
          variant="secondary"
          onPress={() =>
            router.push({ pathname: '/vehicle/edit' as never, params: { id: String(vehicle.id) } })
          }
        />
        <Button
          title="Entretien / CT"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/vehicle/maintenance' as never,
              params: { id: String(vehicle.id) },
            })
          }
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  name: { fontSize: 20, fontWeight: '800' },
  section: { fontSize: 15, fontWeight: '800', marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
});
