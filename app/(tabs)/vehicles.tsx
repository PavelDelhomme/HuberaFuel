import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/context/ToastContext';
import { VehicleCard } from '@/components/VehicleCard';
import { Button } from '@/components/Button';
import { TutorialAnchor } from '@/components/TutorialAnchor';
import { DrawerEdgeBand } from '@/components/DrawerEdgeSwipe';
import { deleteVehicle } from '@/lib/database';
import { confirm, notify } from '@/lib/notify';
import { syncFailureMessage } from '@/lib/api';

export default function VehiclesScreen() {
  const { vehicles, activeVehicle, selectVehicle, refresh } = useApp();
  const { syncNow, pushLocalNow } = useAuth();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const ordered = React.useMemo(() => {
    // Démo tutoriel en tête pour le spotlight « garage-first »
    const demo = vehicles.filter((v) => /^Démo\s*·/i.test(v.name));
    const rest = vehicles.filter((v) => !/^Démo\s*·/i.test(v.name));
    return [...demo, ...rest];
  }, [vehicles]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
      const result = await syncNow();
      await refresh();
      if (result === 'pulled') showToast('Cloud téléchargé');
      else if (result === 'pushed') showToast('Sauvegarde envoyée au cloud');
      else if (result === 'blocked-trip') showToast('Sync reportée — trajet en cours');
      else if (result === 'up-to-date') showToast('Déjà synchronisé');
    } catch (e) {
      showToast(syncFailureMessage(e).message);
    } finally {
      setRefreshing(false);
    }
  }, [refresh, syncNow, showToast]);

  const handleDelete = (id: number, name: string) => {
    confirm(
      'Supprimer',
      `Supprimer « ${name} » ?`,
      async () => {
        try {
          await deleteVehicle(id);
          await refresh();
          notify('Supprimé', name);
        } catch (e) {
          notify('Erreur', e instanceof Error ? e.message : 'Impossible de supprimer.');
        }
      },
      'Supprimer'
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={ordered}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="car-outline" size={64} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Aucun véhicule enregistré
            </Text>
            <Button
              title="Ajouter un véhicule"
              onPress={() => router.push('/vehicle/add')}
              style={{ marginTop: 20, alignSelf: 'stretch' }}
            />
          </View>
        }
        renderItem={({ item, index }) => {
          const card = (
            <VehicleCard
              vehicle={item}
              isActive={activeVehicle?.id === item.id}
              onSelect={() => void selectVehicle(item.id)}
              onView={() =>
                router.push({ pathname: '/vehicle/[id]' as never, params: { id: String(item.id) } })
              }
              onEdit={() =>
                router.push({ pathname: '/vehicle/edit' as never, params: { id: String(item.id) } })
              }
              onMaintenance={() =>
                router.push({
                  pathname: '/vehicle/maintenance' as never,
                  params: { id: String(item.id) },
                })
              }
              onLongPress={() => handleDelete(item.id, item.name)}
              onDelete={() => handleDelete(item.id, item.name)}
              onFuelUpdated={() => {
                void refresh();
                void pushLocalNow();
              }}
            />
          );
          // Spotlight sur la 1ʳᵉ carte seulement (évite un trou géant / double barre)
          if (index === 0) {
            return <TutorialAnchor id="garage-first">{card}</TutorialAnchor>;
          }
          return card;
        }}
      />
      {vehicles.length > 0 && (
        <View style={styles.footer}>
          <Button title="Ajouter un véhicule" onPress={() => router.push('/vehicle/add')} />
        </View>
      )}
      <DrawerEdgeBand />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 24 },
  emptyText: { fontSize: 16, marginTop: 16 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
});
