import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useLocale } from '@/context/LocaleContext';
import { useTheme } from '@/hooks/useTheme';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { getVehicleById, updateVehicle, deleteVehicle } from '@/lib/database';
import { getConsumptionStats } from '@/lib/calculations';
import { confirm, notify } from '@/lib/notify';
import { FUEL_TYPE_LABELS } from '@/constants/Colors';
import { presetDisplayName, type VehiclePreset } from '@/constants/vehicles';
import {
  bootstrapVehicleCatalog,
  refreshVehicleCatalogFromApi,
  searchVehiclesLive,
} from '@/lib/vehicleCatalogStore';
import { fuelGaugeSaveSummary, setFuelLiters } from '@/lib/fuelLevel';
import { FuelGaugeSlider } from '@/components/FuelGaugeSlider';
import { refreshVehicleReminders } from '@/lib/reminders';
import type { FuelType, Vehicle, VehicleSegment } from '@/types';
import { SEGMENT_DEFAULTS, suggestPhysicsFields, resolveVehiclePhysics } from '@/lib/vehiclePhysics';
import { enrichVehicleSpecs } from '@/lib/vehicleSpecsLookup';

/**
 * Modifier un véhicule existant.
 * Choisir un modèle catalogue remplit les specs → véhicule personnalisé utilisateur.
 */
export default function EditVehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vehicleId = Number(id);
  const { refresh } = useApp();
  const { colors } = useTheme();
  const { moneySymbol, country } = useLocale();

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [fuelType, setFuelType] = useState<FuelType>('diesel');
  const [consumption, setConsumption] = useState('6.0');
  const [tankCapacity, setTankCapacity] = useState('50');
  const [fuelPrice, setFuelPrice] = useState(String(country.defaultFuelPrice));
  const [odometer, setOdometer] = useState('0');
  const [hasOdometer, setHasOdometer] = useState(true);
  const [autoAdapt, setAutoAdapt] = useState(true);
  const [notifyMaint, setNotifyMaint] = useState(true);
  const [notifyFuel, setNotifyFuel] = useState(false);
  const [fuelThreshold, setFuelThreshold] = useState('');
  const [gears, setGears] = useState('');
  const [curbWeight, setCurbWeight] = useState('');
  const [dragScx, setDragScx] = useState('');
  const [payload, setPayload] = useState('150');
  const [segment, setSegment] = useState<VehicleSegment>('sedan');
  const [plate, setPlate] = useState('');
  const [vin, setVin] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [ready, setReady] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [measuredConso, setMeasuredConso] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(vehicleId) || vehicleId < 1) {
      notify('Erreur', 'Véhicule introuvable.');
      router.back();
      return;
    }
    getVehicleById(vehicleId).then((v) => {
      if (!v) {
        notify('Erreur', 'Véhicule introuvable.');
        router.back();
        return;
      }
      setName(v.name);
      setBrand(v.brand);
      setModel(v.model);
      setYear(String(v.year));
      setFuelType(v.fuelType);
      setConsumption(String(v.consumptionPer100));
      setTankCapacity(String(v.tankCapacity));
      setFuelPrice(String(v.defaultFuelPrice));
      setOdometer(String(v.currentOdometer));
      setHasOdometer(v.hasOdometer);
      setAutoAdapt(v.consumptionAutoAdapt !== false);
      setNotifyMaint(v.notifyMaintenance !== false);
      setNotifyFuel(!!v.notifyLowFuel);
      setFuelThreshold(
        v.lowFuelThresholdLiters != null ? String(v.lowFuelThresholdLiters) : ''
      );
      setGears(v.transmissionGears != null ? String(v.transmissionGears) : '');
      const phys = resolveVehiclePhysics(v);
      setSegment(phys.segment);
      setCurbWeight(String(phys.curbWeightKg));
      setDragScx(String(phys.dragAreaScx));
      setPayload(String(phys.payloadKg));
      if (v.transmissionGears == null) setGears(String(phys.gears ?? ''));
      setPlate(v.plateNumber || '');
      setVin(v.vin || '');
      setSearch('');
      setVehicle(v);
      setReady(true);
      void getConsumptionStats(v.id).then((s) => {
        setMeasuredConso(s.averageConsumption > 0 ? s.averageConsumption : null);
      });
    });
  }, [vehicleId]);

  const [catalogTick, setCatalogTick] = useState(0);

  useEffect(() => {
    void (async () => {
      await bootstrapVehicleCatalog();
      setCatalogTick((t) => t + 1);
      await refreshVehicleCatalogFromApi();
      setCatalogTick((t) => t + 1);
    })();
  }, []);

  const results = useMemo(() => searchVehiclesLive(search), [search, catalogTick]);

  const applyPreset = (preset: VehiclePreset) => {
    setBrand(preset.brand);
    setModel(preset.model);
    setYear(String(preset.year));
    setFuelType(preset.fuel);
    setConsumption(String(preset.consumption));
    setTankCapacity(String(preset.tank));
    setHasOdometer(!preset.odometerUnreliable);
    const labeled = presetDisplayName(preset);
    if (!name.trim() || name === `${brand} ${model}` || /·/.test(name) === false) {
      setName(labeled);
    }
    const s = suggestPhysicsFields(preset.brand, preset.model);
    setSegment(s.vehicleSegment);
    setCurbWeight(String(s.curbWeightKg));
    setDragScx(String(s.dragAreaScx));
    setGears(String(s.transmissionGears));
    setPayload(String(s.payloadKg));
    setStatus(`Base catalogue : ${labeled} — ajustez puis enregistrez.`);
  };

  const handleSave = async () => {
    if (!name.trim() || !brand.trim() || !model.trim()) {
      notify('Erreur', 'Nom, marque et modèle sont requis.');
      return;
    }
    setLoading(true);
    try {
      await updateVehicle(vehicleId, {
        name: name.trim(),
        brand: brand.trim(),
        model: model.trim(),
        year: parseInt(year, 10) || new Date().getFullYear(),
        fuelType,
        consumptionPer100: parseFloat(consumption.replace(',', '.')) || 6,
        tankCapacity: parseFloat(tankCapacity.replace(',', '.')) || 50,
        defaultFuelPrice:
          parseFloat(fuelPrice.replace(',', '.')) || country.defaultFuelPrice,
        hasOdometer,
        currentOdometer: parseFloat(odometer.replace(',', '.')) || 0,
        consumptionAutoAdapt: autoAdapt,
        notifyMaintenance: notifyMaint,
        notifyLowFuel: notifyFuel,
        lowFuelThresholdLiters: fuelThreshold.trim()
          ? parseFloat(fuelThreshold.replace(',', '.')) || null
          : null,
        transmissionGears: gears.trim()
          ? parseInt(gears.replace(',', '.'), 10) || null
          : null,
        curbWeightKg: curbWeight.trim()
          ? parseFloat(curbWeight.replace(',', '.')) || null
          : null,
        dragAreaScx: dragScx.trim() ? parseFloat(dragScx.replace(',', '.')) || null : null,
        vehicleSegment: segment,
        payloadKg: payload.trim() ? parseFloat(payload.replace(',', '.')) || null : null,
        plateNumber: plate.trim() || null,
        vin: vin.trim().toUpperCase().replace(/\s/g, '') || null,
      });
      await refresh();
      void refreshVehicleReminders();
      notify(
        'Véhicule mis à jour',
        autoAdapt
          ? `${name.trim()} — conso auto selon vos pleins.`
          : `${name.trim()} — conso figée manuellement.`
      );
      router.back();
    } catch (e) {
      notify('Erreur', e instanceof Error ? e.message : 'Échec');
    } finally {
      setLoading(false);
    }
  };

  const fuelTypes: FuelType[] = ['diesel', 'essence', 'gpl', 'electrique'];

  if (!ready) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, padding: 16 }]}>
        <Text style={{ color: colors.textSecondary }}>Chargement…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="always"
      nestedScrollEnabled
    >
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Modifiez votre véhicule. Vous pouvez repartir d’un modèle catalogue : les valeurs
        deviennent votre fiche personnalisée (conso, réservoir, etc.).
      </Text>
      {!!status && <Text style={[styles.status, { color: colors.accent }]}>{status}</Text>}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Base catalogue (optionnel)</Text>
      <Input
        placeholder="Rechercher Clio, 806, Golf…"
        value={search}
        onChangeText={setSearch}
      />
      <View style={styles.searchList}>
        {results.slice(0, 8).map((preset, i) => (
          <Pressable
            key={`${preset.brand}-${preset.model}-${preset.year}-${i}`}
            onPress={() => applyPreset(preset)}
            style={[styles.searchRow, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {preset.brand} {preset.model} ({preset.year})
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {preset.consumption} L/100 · {preset.tank} L
              </Text>
            </View>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Utiliser</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Fiche personnalisée</Text>
      <Input label="Nom" value={name} onChangeText={setName} />
      <Input label="Marque" value={brand} onChangeText={setBrand} />
      <Input label="Modèle" value={model} onChangeText={setModel} />
      <Input
        label="Immatriculation (carte grise)"
        value={plate}
        onChangeText={setPlate}
        autoCapitalize="characters"
        placeholder="AA-123-BB"
      />
      <Input
        label="VIN (optionnel, 17 car.)"
        value={vin}
        onChangeText={setVin}
        autoCapitalize="characters"
        placeholder="VF3XXXXXXXXXXXXXX"
      />
      <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, marginTop: -4 }}>
        Le VIN permet d’enrichir la fiche (Autoref.eu si clé API, sinon catalogue / cache SCx).
      </Text>
      <Button
        title="Enrichir masse / SCx (VIN + cache)"
        variant="outline"
        onPress={async () => {
          const r = await enrichVehicleSpecs({
            brand,
            model,
            year: parseInt(year, 10) || undefined,
            vin,
          });
          if (r.curbWeightKg) setCurbWeight(String(r.curbWeightKg));
          if (r.dragAreaScx) setDragScx(String(r.dragAreaScx));
          notify(
            'Fiche technique',
            r.dragAreaScx || r.curbWeightKg
              ? `Source : ${r.source}${r.notes ? ` — ${r.notes}` : ''}`
              : r.notes || 'Rien de nouveau trouvé'
          );
        }}
        style={{ marginBottom: 12 }}
      />
      <Input label="Année" value={year} onChangeText={setYear} keyboardType="numeric" />

      <Text style={[styles.label, { color: colors.text }]}>Carburant</Text>
      <View style={styles.fuelTypes}>
        {fuelTypes.map((type) => (
          <Pressable
            key={type}
            style={[
              styles.fuelChip,
              {
                backgroundColor: fuelType === type ? colors.accent : colors.card,
                borderColor: colors.border,
              },
            ]}
            onPress={() => setFuelType(type)}
          >
            <Text
              style={{
                color: fuelType === type ? '#fff' : colors.text,
                fontWeight: '600',
                fontSize: 13,
              }}
            >
              {FUEL_TYPE_LABELS[type]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Input
        label="Consommation (L/100km)"
        value={consumption}
        onChangeText={setConsumption}
        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
      />
      <Input
        label="Boîte (nb de rapports)"
        value={gears}
        onChangeText={setGears}
        placeholder="4, 5, 6…"
        keyboardType="numeric"
      />

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Physique (conso GPS)</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 8, lineHeight: 18 }}>
        Masse et aérodynamique pour le modèle de forces. Valeurs par défaut selon le segment —
        modifiez si vous connaissez la fiche technique.
      </Text>
      <Text style={[styles.label, { color: colors.text }]}>Segment</Text>
      <View style={styles.fuelTypes}>
        {(Object.keys(SEGMENT_DEFAULTS) as VehicleSegment[]).map((seg) => (
          <Pressable
            key={seg}
            style={[
              styles.fuelChip,
              {
                backgroundColor: segment === seg ? colors.accent : colors.card,
                borderColor: colors.border,
              },
            ]}
            onPress={() => {
              setSegment(seg);
              const def = SEGMENT_DEFAULTS[seg];
              setCurbWeight(String(def.curbWeightKg));
              setDragScx(String(def.dragAreaScx));
              setGears(String(def.gears));
            }}
          >
            <Text
              style={{
                color: segment === seg ? '#fff' : colors.text,
                fontWeight: '600',
                fontSize: 12,
              }}
            >
              {SEGMENT_DEFAULTS[seg].label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Input
        label="Masse à vide (kg)"
        value={curbWeight}
        onChangeText={setCurbWeight}
        keyboardType="numeric"
      />
      <Input
        label="S × Cx (m²)"
        value={dragScx}
        onChangeText={setDragScx}
        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
      />
      <Input
        label="Charge (passagers / bagages, kg)"
        value={payload}
        onChangeText={setPayload}
        keyboardType="numeric"
      />

      {measuredConso != null && (
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 10, marginTop: -4 }}>
          Mesurée sur vos pleins : ~{measuredConso.toFixed(1)} L/100
          {autoAdapt ? ' (l’app s’en rapproche à chaque plein)' : ' (auto désactivée — valeur manuelle)'}
        </Text>
      )}
      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.switchLabel, { color: colors.text }]}>
            Adapter la conso selon mes pleins
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            Oui = lissage automatique. Non = vous gardez la valeur saisie.
          </Text>
        </View>
        <Switch
          value={autoAdapt}
          onValueChange={setAutoAdapt}
          trackColor={{ false: colors.border, true: colors.accent }}
        />
      </View>
      <Input
        label="Capacité réservoir (L)"
        value={tankCapacity}
        onChangeText={setTankCapacity}
        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
      />
      <Input
        label={`Prix carburant (${moneySymbol}/L)`}
        value={fuelPrice}
        onChangeText={setFuelPrice}
        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
      />

      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.switchLabel, { color: colors.text }]}>Utiliser le compteur</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
            Indiquez le km déjà au compteur (ex. avant de reprendre la 206). Les trajets GPS
            s’ajoutent ensuite.
          </Text>
        </View>
        <Switch
          value={hasOdometer}
          onValueChange={setHasOdometer}
          trackColor={{ false: colors.border, true: colors.accent }}
        />
      </View>
      <Input
        label="Kilométrage de base (compteur)"
        value={odometer}
        onChangeText={setOdometer}
        keyboardType="numeric"
        placeholder="Ex. 185420"
      />
      {vehicle && (
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 12, marginTop: -4 }}>
          Affiché : {(Number(odometer.replace(',', '.')) || 0) + (vehicle.trackedKm || 0)} km
          {' '}(base + {Math.round(vehicle.trackedKm || 0)} km suivis)
        </Text>
      )}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Notifications</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 8, lineHeight: 18 }}>
        Rappels locaux (sur cet appareil). Activez pour CT / contre-visite et pour l’alerte « bientôt
        plein ».
      </Text>
      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.switchLabel, { color: colors.text }]}>Rappels CT / entretien</Text>
        </View>
        <Switch
          value={notifyMaint}
          onValueChange={setNotifyMaint}
          trackColor={{ false: colors.border, true: colors.accent }}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.switchLabel, { color: colors.text }]}>Alerte bas de réservoir</Text>
        </View>
        <Switch
          value={notifyFuel}
          onValueChange={setNotifyFuel}
          trackColor={{ false: colors.border, true: colors.accent }}
        />
      </View>
      {notifyFuel && (
        <Input
          label="Seuil litres restants (vide = ~20 %)"
          value={fuelThreshold}
          onChangeText={setFuelThreshold}
          keyboardType="numeric"
          placeholder="12"
        />
      )}
      <Button
        title="Gérer CT / entretien / rappels"
        variant="secondary"
        onPress={() =>
          router.push({
            pathname: '/vehicle/maintenance' as never,
            params: { id: String(vehicleId) },
          })
        }
        style={{ marginBottom: 12 }}
      />

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Niveau carburant estimé</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 8, lineHeight: 18 }}>
        Réglez la jauge comme sur le tableau de bord (E → F). Utile avec plusieurs voitures.
      </Text>
      {vehicle && (
        <View style={{ marginBottom: 12 }}>
          <FuelGaugeSlider
            tankCapacity={vehicle.tankCapacity}
            liters={vehicle.estimatedFuelLiters}
            onChange={(L) => setVehicle({ ...vehicle, estimatedFuelLiters: L })}
            onChangeEnd={async (L) => {
              const adj = await setFuelLiters(vehicle, L);
              setVehicle({ ...vehicle, estimatedFuelLiters: adj.liters });
              await refresh();
              notify('Niveau', fuelGaugeSaveSummary(adj));
            }}
          />
          <Pressable
            onPress={async () => {
              await updateVehicle(vehicle.id, { estimatedFuelLiters: null });
              setVehicle({ ...vehicle, estimatedFuelLiters: null });
              await refresh();
              notify('Niveau', 'Marqué inconnu');
            }}
            style={{ marginTop: 10 }}
          >
            <Text style={{ color: colors.textSecondary, fontWeight: '600', fontSize: 13 }}>
              Marquer comme inconnu
            </Text>
          </Pressable>
        </View>
      )}

      <Button title="Enregistrer les modifications" onPress={handleSave} loading={loading} />
      <Button
        title="Supprimer ce véhicule"
        variant="danger"
        onPress={() =>
          confirm(
            'Supprimer le véhicule',
            `Supprimer « ${name.trim() || 'ce véhicule'} » et ses données liées ?`,
            async () => {
              await deleteVehicle(vehicleId);
              await refresh();
              notify('Supprimé', 'Véhicule retiré.');
              router.back();
            },
            'Supprimer'
          )
        }
        style={{ marginTop: 16 }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  status: { fontSize: 13, fontWeight: '600', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10, marginTop: 8 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  searchList: { marginBottom: 8 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  fuelTypes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  fuelChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
  },
  switchLabel: { fontSize: 15, fontWeight: '600' },
});
