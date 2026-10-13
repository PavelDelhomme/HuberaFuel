import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Switch,
  Text,
  Pressable,
  AppState,
  Alert,
  type AppStateStatus,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useLocale } from '@/context/LocaleContext';
import { useTheme } from '@/hooks/useTheme';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DatePickerField } from '@/components/DatePickerField';
import { createFillUp, getFillUps, getTrips, getVehicleById, updateVehicle, updateTrip } from '@/lib/database';
import {
  adaptVehicleConsumption,
  displayOdometerKm,
  formatEuro,
  getSinceLastFillStats,
  refreshBudgets,
  sumTripKmBetween,
} from '@/lib/calculations';
import { applyFillUpToFuelEstimate, fuelLevelLabel, previewFillUpFuel } from '@/lib/fuelLevel';
import {
  fetchCheapestStations,
  fuelLabel,
  isFrenchFuelOpenDataAvailable,
  isSaneFuelPricePerLiter,
  type FuelStationPrice,
} from '@/lib/fuelPrices';
import { getCurrentLocation, ensureLocationEnabled } from '@/lib/locationService';
import { notify } from '@/lib/notify';
import { refreshVehicleReminders } from '@/lib/reminders';
import { useToast } from '@/context/ToastContext';
import { toLocalYmd } from '@/lib/dates';
import type { FillUp } from '@/types';

function parseNum(v: string): number {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export default function AddFillUpScreen() {
  const params = useLocalSearchParams<{ tripId?: string; fromTrip?: string }>();
  const { showToast } = useToast();
  const linkedTripId = params.tripId ? Number(params.tripId) : null;
  const { activeVehicle, budgetStatuses, refresh } = useApp();
  const { colors } = useTheme();
  const { countryCode, moneySymbol, formatPerLiter, currency } = useLocale();
  const [liters, setLiters] = useState('');
  const [totalPaid, setTotalPaid] = useState('');
  const [pricePerLiter, setPricePerLiter] = useState(
    activeVehicle?.defaultFuelPrice.toString() ?? '1.70'
  );
  /** Qui a été modifié en dernier pour recalculer le 3e champ */
  const [lastEdited, setLastEdited] = useState<'liters' | 'total' | 'ppl'>('liters');
  const [odometer, setOdometer] = useState(
    activeVehicle?.hasOdometer ? String(displayOdometerKm(activeVehicle) || '') : ''
  );
  const [distanceKm, setDistanceKm] = useState('');
  const [dateLocal, setDateLocal] = useState(() => toLocalYmd(new Date()));
  const [isFull, setIsFull] = useState(false);
  const [note, setNote] = useState('');
  const [station, setStation] = useState<FuelStationPrice | null>(null);
  const [nearby, setNearby] = useState<FuelStationPrice[]>([]);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [kmHint, setKmHint] = useState('');
  const [lastFill, setLastFill] = useState<FillUp | null>(null);
  /** Champs verrouillés par défaut — crayon pour éditer un seul champ */
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});

  const hasOdo = activeVehicle?.hasOdometer !== false;
  const toggleUnlock = (key: string) =>
    setUnlocked((u) => ({ ...u, [key]: !u[key] }));

  useEffect(() => {
    if (!activeVehicle) return;
    void (async () => {
      const fills = await getFillUps(activeVehicle.id);
      const last = fills[0] || null;
      setLastFill(last);
      const currentOdo = displayOdometerKm(activeVehicle);
      const since = await getSinceLastFillStats(activeVehicle.id);

      if (hasOdo) {
        if (currentOdo > 0) {
          setOdometer(String(Math.round(currentOdo)));
        } else if (last?.odometer != null) {
          setOdometer(String(Math.round(last.odometer)));
        }
        if (last?.odometer != null && currentOdo > last.odometer) {
          const km = Math.round(currentOdo - last.odometer);
          setDistanceKm(String(km));
          setKmHint(
            `Auto compteur : ${km} km depuis le plein du ${new Date(last.date).toLocaleDateString('fr-FR')}`
          );
        } else if (since.tripKm >= 20) {
          setDistanceKm(String(Math.round(since.tripKm)));
          setKmHint(
            `Trajets GPS de ce véhicule depuis le dernier plein : ${since.tripKm} km`
          );
        } else if (last?.distanceSinceLastKm != null && last.distanceSinceLastKm > 0) {
          setKmHint(`Dernier plein : +${Math.round(last.distanceSinceLastKm)} km`);
        }
      } else if (since.tripKm >= 20) {
        setDistanceKm(String(Math.round(since.tripKm)));
        setKmHint(
          last
            ? `Trajets GPS depuis le plein du ${new Date(last.date).toLocaleDateString('fr-FR')} : ${since.tripKm} km`
            : `Trajets GPS de ce véhicule : ${since.tripKm} km`
        );
      } else if (!last) {
        const trips = await getTrips(activeVehicle.id, { omitRoutePoints: true });
        const allKm = sumTripKmBetween(trips, null, new Date().toISOString());
        if (allKm >= 20) {
          setDistanceKm(String(Math.round(allKm)));
          setKmHint(`Tous les trajets GPS de ce véhicule : ${allKm} km (1er plein)`);
        }
      } else if (last.distanceSinceLastKm != null && last.distanceSinceLastKm > 0) {
        setDistanceKm(String(Math.round(last.distanceSinceLastKm)));
        setKmHint('Suggestion basée sur le dernier plein');
      }
    })();
  }, [activeVehicle?.id, activeVehicle?.currentOdometer, activeVehicle?.trackedKm, hasOdo]);

  const fuelKey =
    activeVehicle?.fuelType === 'diesel'
      ? 'gazole'
      : activeVehicle?.fuelType === 'gpl'
        ? 'gplc'
        : 'e10';

  const fillToFullLiters = useMemo(() => {
    if (!activeVehicle) return 0;
    const rem = activeVehicle.estimatedFuelLiters;
    if (rem == null || rem < 0) return 0;
    const need = activeVehicle.tankCapacity - rem;
    return need > 0.5 ? Math.round(need * 10) / 10 : 0;
  }, [activeVehicle]);

  /** Place libre estimée + marge 12 % (jauge approximative), plafonnée au réservoir. */
  const maxLitersAllowed = useMemo(() => {
    if (!activeVehicle) return 999;
    const tank = activeVehicle.tankCapacity;
    const rem = activeVehicle.estimatedFuelLiters;
    if (rem == null || rem < 0) return Math.round(tank * 10) / 10;
    const room = Math.max(0, tank - rem);
    return Math.min(tank, Math.round(room * 1.12 * 10) / 10);
  }, [activeVehicle]);

  const priceDelta = useMemo(() => {
    if (!lastFill?.pricePerLiter || lastFill.pricePerLiter <= 0) return null;
    const p = parseNum(pricePerLiter);
    if (p <= 0) return null;
    return Math.round((p - lastFill.pricePerLiter) * 1000) / 1000;
  }, [pricePerLiter, lastFill]);

  const lastStationLabel = useMemo(() => {
    const n = (lastFill?.note || '').trim();
    if (!n) return null;
    // note souvent "Station …" ou nom libre
    return n.length > 2 ? n : null;
  }, [lastFill]);

  const applyFillToFull = () => {
    if (fillToFullLiters <= 0) return;
    const L = fillToFullLiters;
    setLiters(String(L));
    setIsFull(true);
    setLastEdited('liters');
    const P = parseNum(pricePerLiter);
    if (P > 0) setTotalPaid((L * P).toFixed(2));
  };

  const applyLastStation = () => {
    if (!lastStationLabel) return;
    setNote(lastStationLabel);
    if (lastFill?.pricePerLiter && lastFill.pricePerLiter > 0) {
      setPricePerLiter(String(lastFill.pricePerLiter));
      setLastEdited('ppl');
      const L = parseNum(liters);
      if (L > 0) setTotalPaid((L * lastFill.pricePerLiter).toFixed(2));
    }
  };

  const derived = useMemo(() => {
    const L = parseNum(liters);
    const T = parseNum(totalPaid);
    const P = parseNum(pricePerLiter);
    if (lastEdited === 'liters' || lastEdited === 'total') {
      if (L > 0 && T > 0) return { liters: L, total: T, ppl: T / L };
      if (L > 0 && P > 0) return { liters: L, total: L * P, ppl: P };
      if (T > 0 && P > 0) return { liters: T / P, total: T, ppl: P };
    }
    if (lastEdited === 'ppl') {
      if (L > 0 && P > 0) return { liters: L, total: L * P, ppl: P };
      if (T > 0 && P > 0) return { liters: T / P, total: T, ppl: P };
    }
    return { liters: L, total: T || L * P, ppl: P || (L > 0 && T > 0 ? T / L : 0) };
  }, [liters, totalPaid, pricePerLiter, lastEdited]);

  const onLiters = (v: string) => {
    const L = parseNum(v);
    setLiters(v);
    setLastEdited('liters');
    const T = parseNum(totalPaid);
    if (L > 0 && T > 0) setPricePerLiter((T / L).toFixed(3));
    else if (L > 0 && parseNum(pricePerLiter) > 0) {
      setTotalPaid((L * parseNum(pricePerLiter)).toFixed(2));
    }
  };

  const onTotal = (v: string) => {
    setTotalPaid(v);
    setLastEdited('total');
    const T = parseNum(v);
    const L = parseNum(liters);
    if (L > 0 && T > 0) setPricePerLiter((T / L).toFixed(3));
    else if (T > 0 && parseNum(pricePerLiter) > 0) {
      const nextL = T / parseNum(pricePerLiter);
      setLiters(nextL.toFixed(2));
    }
  };

  const onPpl = (v: string) => {
    setPricePerLiter(v);
    setLastEdited('ppl');
    const P = parseNum(v);
    const L = parseNum(liters);
    if (L > 0 && P > 0) setTotalPaid((L * P).toFixed(2));
  };

  const findStations = async (opts?: { autoPick?: boolean }) => {
    if (!isFrenchFuelOpenDataAvailable(countryCode)) {
      if (!opts?.autoPick) {
        notify(
          'Stations',
          'Les prix open data ne sont disponibles qu’en France. Saisissez litres et montant manuellement (tous pays Europe OK).'
        );
      }
      return;
    }
    setLocating(true);
    if (!opts?.autoPick) {
      setStation(null);
      setNearby([]);
    }
    try {
      const gpsOn = await ensureLocationEnabled();
      const loc = await getCurrentLocation({ fresh: true, timeoutMs: 10_000 });
      if (!loc) {
        if (!opts?.autoPick) {
          notify(
            'GPS',
            gpsOn
              ? 'Position introuvable. Réessayez une fois dehors, GPS allumé.'
              : 'Activez la localisation (GPS), puis revenez — la recherche relance toute seule.',
          );
        }
        return;
      }
      const list = await fetchCheapestStations({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        radiusKm: 8,
        fuel: activeVehicle?.fuelType || 'diesel',
        limit: 12,
        countryCode,
      });
      list.sort((a, b) => (a.distanceKm || 99) - (b.distanceKm || 99));
      if (!list.length) {
        if (!opts?.autoPick) notify('Stations', 'Aucune station dans un rayon élargi (~25 km). Vérifiez le GPS.');
        setNearby([]);
        return;
      }
      const closest = list[0].distanceKm ?? 99;
      // Plusieurs stations « au même endroit » → laisser choisir
      const cluster = list.filter((s) => (s.distanceKm ?? 99) <= closest + 0.18);
      if (opts?.autoPick) {
        if (cluster.length >= 2) {
          setNearby(cluster.slice(0, 5));
          setStation(null);
        } else {
          pickStation(list[0]);
          setNearby([]);
        }
      } else {
        setNearby(list);
      }
    } catch (e) {
      if (!opts?.autoPick) notify('Erreur', e instanceof Error ? e.message : 'API stations');
    } finally {
      setLocating(false);
    }
  };

  // Par défaut : station la plus proche (pas la dernière utilisée)
  useEffect(() => {
    if (!activeVehicle) return;
    void findStations({ autoPick: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVehicle?.id, countryCode]);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active' && activeVehicle && nearby.length === 0 && !station) {
        void findStations({ autoPick: true });
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVehicle?.id, nearby.length, station]);

  const pickStation = (s: FuelStationPrice) => {
    // Remplace entièrement la sélection précédente (pas d’empilement)
    setStation(s);
    setNearby([]);
    const apiPrice = s.prices[fuelKey];
    if (apiPrice != null) {
      setPricePerLiter(apiPrice.toFixed(3));
      setLastEdited('ppl');
      const L = parseNum(liters);
      if (L > 0) setTotalPaid((L * apiPrice).toFixed(2));
    }
    setNote(`${s.name} — ${s.address} ${s.city}`.trim());
  };

  const clearStation = () => {
    setStation(null);
  };

  const envelopePreview = useMemo(() => {
    const main = budgetStatuses[0];
    if (!main) return null;
    const nextSpent = main.spent + (derived.total || 0);
    return {
      name: main.budget.name,
      amount: main.budget.amount,
      spent: main.spent,
      nextSpent,
      remaining: Math.max(0, main.budget.amount - nextSpent),
      percent: main.budget.amount > 0 ? (nextSpent / main.budget.amount) * 100 : 0,
    };
  }, [budgetStatuses, derived.total]);

  const persistFill = async (opts?: {
    resizeTankTo?: number;
    ignorePrevious?: boolean;
  }) => {
    if (!activeVehicle) return;
    setLoading(true);
    try {
      let vehicle = activeVehicle;
      if (opts?.resizeTankTo && opts.resizeTankTo > vehicle.tankCapacity) {
        await updateVehicle(vehicle.id, { tankCapacity: opts.resizeTankTo });
        vehicle = (await getVehicleById(vehicle.id)) || {
          ...vehicle,
          tankCapacity: opts.resizeTankTo,
        };
      }
      const dateIso = new Date(`${dateLocal}T12:00:00`).toISOString();
      const odoVal = hasOdo ? parseNum(odometer) : null;
      let distVal = distanceKm ? parseNum(distanceKm) : null;
      if (hasOdo && (distVal == null || distVal <= 0) && odoVal != null && lastFill?.odometer != null) {
        const delta = odoVal - lastFill.odometer;
        if (delta > 0) distVal = Math.round(delta * 10) / 10;
      }
      const fillId = await createFillUp({
        vehicleId: vehicle.id,
        date: dateIso,
        liters: Math.round(derived.liters * 100) / 100,
        pricePerLiter: Math.round(derived.ppl * 1000) / 1000,
        totalCost: Math.round(derived.total * 100) / 100,
        odometer: odoVal,
        distanceSinceLastKm: distVal,
        isFull,
        note: note.trim() || undefined,
        tripId: linkedTripId && Number.isFinite(linkedTripId) ? linkedTripId : null,
      });

      if (linkedTripId && Number.isFinite(linkedTripId)) {
        await updateTrip(linkedTripId, { fillUpId: fillId });
      }

      if (derived.ppl > 0) {
        await updateVehicle(vehicle.id, { defaultFuelPrice: derived.ppl });
      }

      await applyFillUpToFuelEstimate(
        vehicle,
        {
          liters: Math.round(derived.liters * 100) / 100,
          isFull,
          id: fillId,
        },
        { ignorePrevious: opts?.ignorePrevious }
      );

      const adapted = await adaptVehicleConsumption(vehicle.id);
      await refreshBudgets(vehicle.id);
      await refresh();
      void refreshVehicleReminders();
      let msg =
        `${derived.liters.toFixed(2)} L · ${formatEuro(derived.total)}` +
        (station ? ` · ${station.name}` : '') +
        (params.fromTrip === '1' ? ' — reprenez le trajet quand vous voulez.' : '');
      if (adapted && adapted.next !== adapted.previous) {
        msg += `\nConso adaptée : ${adapted.previous.toFixed(1)} → ${adapted.next.toFixed(1)} L/100 (mesurée ~${adapted.measured.toFixed(1)}, ${adapted.samples} mesure${adapted.samples > 1 ? 's' : ''}).`;
      }
      showToast(`Plein enregistré — ${msg.replace(/\n/g, ' · ')}`, { durationMs: 3200 });
      router.back();
    } catch (e) {
      notify('Erreur', e instanceof Error ? e.message : 'Impossible d’enregistrer le plein.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!activeVehicle) {
      notify('Erreur', 'Aucun véhicule actif.');
      return;
    }
    if (derived.liters <= 0) {
      notify('Erreur', 'Indiquez les litres (ou montant + prix/L).');
      return;
    }
    if (derived.ppl <= 0 || derived.total <= 0) {
      notify('Erreur', 'Indiquez le montant payé (ou litres + prix/L).');
      return;
    }
    if (!isSaneFuelPricePerLiter(derived.ppl, countryCode)) {
      notify(
        'Prix / L incohérent',
        `${derived.ppl.toFixed(3)} €/L n’est pas réaliste. Vérifiez le prix à la pompe (souvent ~1,5–2,5 €/L) : avec ${formatEuro(derived.total)} ça ferait environ ${(derived.total / Math.max(derived.ppl, 0.01)).toFixed(1)} L.`
      );
      return;
    }
    if (hasOdo && !odometer) {
      notify('Erreur', 'Kilométrage compteur requis.');
      return;
    }
    if (!hasOdo && !distanceKm) {
      notify('Distance', 'Sans compteur, indiquez les km depuis le dernier plein.');
      return;
    }

    const preview = previewFillUpFuel(activeVehicle, {
      liters: Math.round(derived.liters * 100) / 100,
      isFull,
    });
    if (!isFull && preview.exceedsCapacity) {
      const nextTank = Math.ceil(preview.neededCapacity);
      const litersExceedTank = derived.liters > activeVehicle.tankCapacity + 0.05;
      Alert.alert(
        'Plus que la capacité enregistrée',
        `Vous avez saisi ${derived.liters.toFixed(1)} L. Le réservoir de ${activeVehicle.name} est noté à ${activeVehicle.tankCapacity} L. Erreur de saisie, ou on a mal estimé le réservoir ?`,
        [
          { text: 'Corriger la saisie', style: 'cancel' },
          {
            text: `Réservoir = ${nextTank} L`,
            onPress: () => void persistFill({ resizeTankTo: nextTank }),
          },
          ...(litersExceedTank
            ? []
            : [
                {
                  text: 'Jauge = litres saisis',
                  onPress: () => void persistFill({ ignorePrevious: true }),
                },
              ]),
        ]
      );
      return;
    }

    await persistFill();
  };

  if (!activeVehicle) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, padding: 16 }]}>
        <Text style={[styles.error, { color: colors.danger }]}>
          Sélectionnez un véhicule actif avant d&apos;ajouter un plein.
        </Text>
        <Button
          title="Aller aux véhicules"
          onPress={() => router.push('/(tabs)/vehicles' as never)}
          style={{ marginTop: 16 }}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.vehicle, { color: colors.textSecondary }]}>
        Véhicule : {activeVehicle.name}
        {!hasOdo ? ' · suivi sans compteur' : ''}
        {linkedTripId ? ' · lié au trajet en pause' : ''}
      </Text>

      <DatePickerField
        label="Date du plein"
        value={dateLocal}
        onChange={setDateLocal}
        maximumDate={new Date()}
      />

      <Text style={[styles.section, { color: colors.text }]}>Station</Text>
      {locating && !station && nearby.length === 0 ? (
        <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 8 }}>
          Recherche de la station la plus proche…
        </Text>
      ) : null}
      {!station && nearby.length > 1 ? (
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, marginBottom: 8 }}>
          Plusieurs stations proches — choisissez :
        </Text>
      ) : null}
      <Button
        title={
          locating
            ? 'Recherche…'
            : !isFrenchFuelOpenDataAvailable(countryCode)
              ? 'Stations auto (France uniquement)'
              : station
                ? 'Changer de station (GPS)'
                : 'Trouver la station (GPS)'
        }
        variant="secondary"
        onPress={() => void findStations()}
        loading={locating}
      />
      {station && (
        <Card style={{ marginTop: 10, marginBottom: 8 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{station.name}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {station.address} {station.city}
            {station.distanceKm != null ? ` · ${station.distanceKm} km` : ''}
            {station.prices[fuelKey] != null
              ? ` · ${fuelLabel(fuelKey)} ${formatPerLiter(station.prices[fuelKey]!)}`
              : ''}
          </Text>
          <Pressable onPress={clearStation} style={{ marginTop: 8 }}>
            <Text style={{ color: colors.danger, fontWeight: '600', fontSize: 13 }}>
              Retirer la station
            </Text>
          </Pressable>
        </Card>
      )}
      {!station &&
        nearby.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => pickStation(s)}
            style={[
              styles.stationRow,
              {
                borderColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{s.name}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {s.distanceKm} km · {s.address} {s.city}
              </Text>
            </View>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>
              {s.prices[fuelKey] != null ? formatPerLiter(s.prices[fuelKey]!) : '—'}
            </Text>
          </Pressable>
        ))}
      {lastStationLabel && !station && (
        <Pressable
          onPress={applyLastStation}
          style={[
            styles.quickChip,
            { borderColor: colors.border, backgroundColor: colors.card, marginTop: 8 },
          ]}
        >
          <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 12 }} numberOfLines={1}>
            Ou dernière station : {lastStationLabel}
          </Text>
        </Pressable>
      )}

      <Text style={[styles.section, { color: colors.text }]}>Quantité & montant</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8 }}>
        Champs verrouillés par défaut — touchez le crayon pour modifier. Place libre estimée ~{maxLitersAllowed.toFixed(1)} L (on peut dépasser, l’app demandera confirmation).
      </Text>
      {fillToFullLiters > 0 && (
        <Pressable
          onPress={applyFillToFull}
          style={[
            styles.quickChip,
            { borderColor: colors.border, backgroundColor: colors.card, marginBottom: 10 },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
            Compléter le réservoir (~{fillToFullLiters.toFixed(1)} L)
          </Text>
        </Pressable>
      )}
      <Input
        label="Litres"
        placeholder="45.00"
        value={liters}
        onChangeText={onLiters}
        keyboardType="decimal-pad"
        locked={!unlocked.liters}
        onRequestEdit={() => toggleUnlock('liters')}
      />
      <Input
        label={`Montant payé (${currency})`}
        placeholder="78.50"
        value={totalPaid}
        onChangeText={onTotal}
        keyboardType="decimal-pad"
        locked={!unlocked.total}
        onRequestEdit={() => toggleUnlock('total')}
      />
      <Input
        label="Prix au litre"
        value={unlocked.ppl ? pricePerLiter : '-- auto'}
        onChangeText={onPpl}
        keyboardType="decimal-pad"
        locked={!unlocked.ppl}
        onRequestEdit={() => toggleUnlock('ppl')}
        hint={
          derived.ppl > 0
            ? `${derived.ppl.toFixed(2).replace('.', ',')} €/L`
            : 'Calculé depuis litres + montant'
        }
      />
      {priceDelta != null && Math.abs(priceDelta) >= 0.001 && (
        <Text
          style={{
            color: priceDelta > 0 ? colors.warning : colors.success,
            fontSize: 12,
            fontWeight: '700',
            marginTop: -6,
            marginBottom: 10,
          }}
        >
          {priceDelta > 0 ? '+' : ''}
          {(priceDelta * 100).toFixed(1)} ct/L vs dernier plein (
          {formatPerLiter(lastFill!.pricePerLiter)})
        </Text>
      )}

      {derived.total > 0 && derived.liters > 0 && (
        <Text style={[styles.total, { color: colors.accent }]}>
          {derived.liters.toFixed(2)} L × {formatPerLiter(derived.ppl)} ={' '}
          {formatEuro(derived.total)}
        </Text>
      )}

      {hasOdo ? (
        <Input
          label="Kilométrage compteur"
          value={odometer}
          onChangeText={setOdometer}
          keyboardType="numeric"
          locked={!unlocked.odometer}
          onRequestEdit={() => toggleUnlock('odometer')}
        />
      ) : (
        <Input
          label="Km depuis le dernier plein"
          value={distanceKm}
          onChangeText={setDistanceKm}
          keyboardType="decimal-pad"
          placeholder="ex: 420"
          locked={!unlocked.distance}
          onRequestEdit={() => toggleUnlock('distance')}
        />
      )}

      {hasOdo && (
        <Input
          label="Km depuis dernier plein (optionnel)"
          value={distanceKm}
          onChangeText={setDistanceKm}
          keyboardType="decimal-pad"
          locked={!unlocked.distance}
          onRequestEdit={() => toggleUnlock('distance')}
        />
      )}

      {!hasOdo && !!kmHint && (
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: -8, marginBottom: 8 }}>
          {kmHint}
        </Text>
      )}

      <Input
        label="Note / nom station (optionnel)"
        value={note}
        onChangeText={setNote}
        locked={!unlocked.note}
        onRequestEdit={() => toggleUnlock('note')}
      />

      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.switchLabel, { color: colors.text }]}>Plein jusqu’au bouchon</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 }}>
            Décoché par défaut. Oui seulement si le réservoir est plein jusqu’au bouchon (jauge = 100 %). Sinon on ajoute les litres au reste.
          </Text>
        </View>
        <Switch
          value={isFull}
          onValueChange={setIsFull}
          trackColor={{ false: colors.border, true: colors.accent }}
        />
      </View>

      {derived.liters > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 4 }}>
            Réservoir estimé ({activeVehicle.name})
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>
            Actuel : {fuelLevelLabel(activeVehicle)}
          </Text>
          <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 14, lineHeight: 20 }}>
            {
              previewFillUpFuel(activeVehicle, {
                liters: Math.round(derived.liters * 100) / 100,
                isFull,
              }).summary
            }
          </Text>
        </Card>
      )}

      {envelopePreview && (
        <Card style={{ marginBottom: 16 }}>
          <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 6 }}>
            Enveloppe : {envelopePreview.name}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            Déjà dépensé {formatEuro(envelopePreview.spent)} / {formatEuro(envelopePreview.amount)}
          </Text>
          <Text style={{ color: colors.accent, fontWeight: '600', marginTop: 4 }}>
            Après ce plein : {formatEuro(envelopePreview.nextSpent)} (
            {envelopePreview.percent.toFixed(0)}%) — reste {formatEuro(envelopePreview.remaining)}
          </Text>
        </Card>
      )}

      <Button title="Enregistrer le plein" onPress={handleSave} loading={loading} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  vehicle: { fontSize: 14, marginBottom: 16 },
  section: { fontSize: 16, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    gap: 8,
  },
  quickChip: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  switchLabel: { fontSize: 14, fontWeight: '600' },
  total: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  error: { fontSize: 16, textAlign: 'center', padding: 32 },
});
