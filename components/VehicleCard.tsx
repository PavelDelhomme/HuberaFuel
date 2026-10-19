import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { useLocale } from '@/context/LocaleContext';
import { FUEL_TYPE_LABELS } from '@/constants/Colors';
import type { Vehicle } from '@/types';
import { displayOdometerKm, formatConsumption } from '@/lib/calculations';
import { fuelRemainingTone, fuelToneColor, setFuelLiters } from '@/lib/fuelLevel';
import { promptUnknownGauge } from '@/lib/unknownGaugePrompt';
import { updateVehicle } from '@/lib/database';
import { FuelGaugeSlider } from '@/components/FuelGaugeSlider';
import { notify } from '@/lib/notify';
import { vehicleIdentity } from '@/lib/vehicleIdentity';

interface VehicleCardProps {
  vehicle: Vehicle;
  isActive?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onSelect?: () => void;
  onEdit?: () => void;
  onView?: () => void;
  onMaintenance?: () => void;
  onDelete?: () => void;
  /** Après changement rapide de jauge. */
  onFuelUpdated?: () => void;
}

export function VehicleCard({
  vehicle,
  isActive,
  onPress,
  onLongPress,
  onSelect,
  onEdit,
  onView,
  onMaintenance,
  onDelete,
  onFuelUpdated,
}: VehicleCardProps) {
  const { colors } = useTheme();
  const { locale } = useLocale();
  const odo = displayOdometerKm(vehicle);
  const fuelTone = fuelRemainingTone({
    litersRemaining: vehicle.estimatedFuelLiters,
    tankCapacity: vehicle.tankCapacity,
    lowLitersThreshold: vehicle.lowFuelThresholdLiters,
    vehicle,
  });
  const fuelColor = fuelToneColor(fuelTone, colors);
  const [draftLiters, setDraftLiters] = useState<number | null>(vehicle.estimatedFuelLiters);

  React.useEffect(() => {
    setDraftLiters(vehicle.estimatedFuelLiters);
  }, [vehicle.id, vehicle.estimatedFuelLiters]);

  const commitFuel = async (liters: number) => {
    const { liters: next } = await setFuelLiters(vehicle, liters);
    setDraftLiters(next);
    notify('Réservoir', `${vehicle.name} · ${next.toFixed(1)} L`);
    onFuelUpdated?.();
  };

  const selectOnTap = () => {
    if (onSelect && !isActive) onSelect();
    else onPress?.();
  };

  return (
    <Pressable
      onPress={selectOnTap}
      onLongPress={onLongPress}
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: isActive ? colors.accent : colors.border,
          borderWidth: isActive ? 2 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${vehicle.name}${isActive ? ', véhicule actif' : ', appuyer pour sélectionner'}`}
      accessibilityState={{ selected: !!isActive }}
    >
      <View style={styles.header}>
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.text }]}>{vehicle.name}</Text>
          <Text style={[styles.details, { color: colors.textSecondary }]}>
            {vehicle.brand} {vehicle.model} · {vehicleIdentity(vehicle)}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {onDelete && (
            <Pressable
              onPress={onDelete}
              style={[styles.deleteBtn, { borderColor: colors.danger }]}
              hitSlop={6}
              accessibilityLabel="Supprimer"
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          )}
          {isActive && (
            <View style={[styles.badge, { backgroundColor: colors.accent }]}>
              <Text style={styles.badgeText}>Actif</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {formatConsumption(vehicle.consumptionPer100, vehicle.fuelType)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Conso.</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {odo.toLocaleString(locale)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>km</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {FUEL_TYPE_LABELS[vehicle.fuelType]}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Carburant</Text>
        </View>
      </View>

      <View
        style={styles.fuelBlock}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
      >
        <FuelGaugeSlider
          key={vehicle.id}
          requireConfirm
          resetKey={vehicle.id}
          tankCapacity={vehicle.tankCapacity}
          liters={draftLiters}
          accentColor={fuelColor}
          vehicle={vehicle}
          onChange={setDraftLiters}
          onChangeEnd={(L) => void commitFuel(L)}
          onUnknown={() => {
            promptUnknownGauge((choice) => {
              void (async () => {
                await updateVehicle(vehicle.id, { estimatedFuelLiters: choice.liters });
                setDraftLiters(choice.liters);
                notify('Réservoir', `${vehicle.name} · niveau inconnu`);
                onFuelUpdated?.();
              })();
            });
          }}
        />
        {draftLiters != null && vehicle.consumptionPer100 > 0 && (
          <Text
            style={{
              marginTop: 6,
              fontSize: 12,
              fontWeight: '600',
              color: colors.textSecondary,
            }}
            accessibilityLiveRegion="polite"
          >
            Autonomie est. ~{Math.round((draftLiters / vehicle.consumptionPer100) * 100)} km
          </Text>
        )}
      </View>

      <View style={styles.actions}>
        {onEdit && (
          <ActionBtn
            icon="create-outline"
            label="Modifier"
            color={colors.text}
            borderColor={colors.border}
            onPress={onEdit}
          />
        )}
        {onView && (
          <ActionBtn
            icon="eye-outline"
            label="Voir"
            color={colors.accent}
            borderColor={colors.accent}
            onPress={onView}
          />
        )}
        {onMaintenance && (
          <ActionBtn
            icon="construct-outline"
            label="Entretien"
            color={colors.accent}
            borderColor={colors.accent}
            onPress={onMaintenance}
          />
        )}
      </View>
    </Pressable>
  );
}

function ActionBtn({
  icon,
  label,
  color,
  borderColor,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  borderColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.actionBtn, { borderColor }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.actionLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  info: { flex: 1 },
  name: { fontSize: 18, fontWeight: '700' },
  details: { fontSize: 14, marginTop: 2 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 14, fontWeight: '600' },
  statLabel: { fontSize: 11, marginTop: 2 },
  fuelBlock: { marginTop: 14 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    alignItems: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 40,
  },
  actionLabel: { fontSize: 13, fontWeight: '700' },
  deleteBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
