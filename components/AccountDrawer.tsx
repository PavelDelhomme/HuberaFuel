import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useAccountDrawer } from '@/context/AccountDrawerContext';
import { useApp } from '@/context/AppContext';
import { useLocale } from '@/context/LocaleContext';
import { useTheme } from '@/hooks/useTheme';
import { useAppUpdate } from '@/context/AppUpdateContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/Button';
import { CountryPickerCard } from '@/components/CountryPickerCard';
import { isManagerEmail, API_URL, getLocalAppVersion, fetchAppVersion, compareVersions } from '@/lib/api';
import { getAppFlavor } from '@/lib/appFlavor';
import { notify } from '@/lib/notify';

type RowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
};

function DrawerRow({ icon, label, subtitle, onPress, danger }: RowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={subtitle}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.background }]}>
        <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? colors.danger : colors.text, fontWeight: '700', fontSize: 15 }}>
          {label}
        </Text>
        {!!subtitle && (
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

/** Menu profil : compte, MAJ, admin, préférences (sync = icône header). */
export function AccountDrawer() {
  const { open, closeDrawer } = useAccountDrawer();
  const { colors, scheme, toggleScheme } = useTheme();
  const { user, logout, refreshCloudNow, pushLocalNow, pendingRegistrationsCount } = useAuth();
  const { refresh, activeVehicle } = useApp();
  const { country } = useLocale();
  const { updateAvailable, info, checkNow, startUpdate } = useAppUpdate();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(340, Math.max(280, width * 0.82));
  const [busy, setBusy] = useState(false);
  const isMgr = isManagerEmail(user?.email, user?.isManager);
  const flavor = getAppFlavor();

  const go = (path: string) => {
    closeDrawer();
    setTimeout(() => router.push(path as never), 80);
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={closeDrawer}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
        <View
          style={[
            styles.panel,
            {
              width: drawerWidth,
              backgroundColor: colors.card,
              paddingTop: insets.top + 8,
              paddingBottom: insets.bottom + 12,
              borderRightColor: colors.border,
            },
          ]}
        >
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headTitle, { color: colors.text }]}>Profil</Text>
              <Text style={{ color: flavor.accent, fontSize: 12, fontWeight: '800', marginTop: 4 }}>
                {flavor.shortName} · {flavor.label}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>
                {user ? `${user.name} · ${user.email}` : 'Non connecté — données locales'}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }}>
                v{getLocalAppVersion()}
                {info?.version ? ` · serveur ${info.version}` : ''}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 8, lineHeight: 16 }}>
                {info?.hubera?.message ||
                  'Hubera Fuel (ex Gasoil Tracking). Tes données restent. fuel.hubera.cloud — l’ancien gasoil-tracking.delhomme.ovh continue.'}
              </Text>
            </View>
            <Pressable
              onPress={closeDrawer}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Fermer le menu"
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {user ? (
              <>
                <Text style={[styles.section, { color: colors.textSecondary }]}>Compte</Text>
                <DrawerRow
                  icon="person-circle-outline"
                  label="Mon compte"
                  subtitle="Mot de passe, email, RGPD…"
                  onPress={() => go('/account')}
                />
                <DrawerRow
                  icon="cloud-upload-outline"
                  label="Pousser cet appareil → cloud"
                  subtitle="Source de vérité téléphone (jauge, trajets) → site web"
                  onPress={async () => {
                    setBusy(true);
                    try {
                      const res = await pushLocalNow();
                      await refresh();
                      if (res.ok) showToast('Données poussées vers le cloud');
                      else if (res.reason === 'active-trip')
                        notify('Sync', 'Terminez le trajet avant de pousser.');
                      else if (res.reason === 'no-auth') notify('Sync', 'Connectez-vous d’abord.');
                      else if (res.reason === 'local-empty')
                        notify('Sync', 'Appareil vide — utilisez « Actualiser depuis le cloud ».');
                      else if (res.reason === 'cloud-richer')
                        notify(
                          'Sync',
                          'Le cloud a plus de données — tirez d’abord depuis le cloud.'
                        );
                      else notify('Sync', 'Échec du push');
                      closeDrawer();
                    } catch (e) {
                      notify('Sync', e instanceof Error ? e.message : 'Échec');
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                <DrawerRow
                  icon="cloud-download-outline"
                  label="Actualiser depuis le cloud"
                  subtitle="Remplace le local par le snapshot cloud"
                  onPress={async () => {
                    setBusy(true);
                    try {
                      const res = await refreshCloudNow();
                      await refresh();
                      if (res.ok) {
                        showToast('Cloud appliqué');
                      } else if (res.reason === 'empty') {
                        showToast('Aucune donnée cloud');
                      } else {
                        showToast('Connexion requise');
                      }
                      closeDrawer();
                    } catch (e) {
                      notify('Cloud', e instanceof Error ? e.message : 'Échec');
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                {isMgr && (
                  <DrawerRow
                    icon="shield-checkmark-outline"
                    label="Administration"
                    subtitle={
                      pendingRegistrationsCount > 0
                        ? `${pendingRegistrationsCount} compte(s) à valider`
                        : 'Invitations, APK, validations…'
                    }
                    onPress={() => go('/admin')}
                  />
                )}
              </>
            ) : (
              <>
                <Text style={[styles.section, { color: colors.textSecondary }]}>Connexion</Text>
                <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 10 }}>
                    Hors ligne / non connecté : vos données restent. Site :
                    fuel.hubera.cloud (les anciens gasoil-tracking.hubera.cloud et
                    gasoil-tracking.delhomme.ovh restent valides). Connectez-vous pour les
                    recharger ici.
                  </Text>
                  <Button
                    title="Connexion"
                    onPress={() => go('/auth')}
                    disabled={busy}
                  />
                </View>
              </>
            )}

            <Text style={[styles.section, { color: colors.textSecondary }]}>Application</Text>
            <DrawerRow
              icon="help-circle-outline"
              label="Aide"
              subtitle="Guide, catégories, problèmes connus"
              onPress={() => go('/help')}
            />
            <DrawerRow
              icon="time-outline"
              label="Historique des trajets"
              subtitle="Trajets passés, validation, cartes"
              onPress={() => go('/(tabs)/trip?tab=history&filter=all')}
            />
            <DrawerRow
              icon="download-outline"
              label={
                updateAvailable
                  ? 'Mettre à jour maintenant'
                  : info?.buildingVersion
                    ? `Build v${info.buildingVersion} en cours…`
                    : 'Vérifier / installer la mise à jour'
              }
              subtitle={
                updateAvailable
                  ? `v${info?.version} prête — installation dans l’app`
                  : info?.buildingVersion
                    ? `APK en construction (~45–60 min). Local v${getLocalAppVersion()} · serveur v${info?.version || '—'}`
                    : `Local v${getLocalAppVersion()}${info?.version ? ` · serveur v${info.version}` : ''} — vérifie puis installe in-app`
              }
              onPress={async () => {
                closeDrawer();
                const found = await checkNow({ ignoreSnooze: true });
                if (found) {
                  await startUpdate();
                  return;
                }
                const local = getLocalAppVersion();
                try {
                  const remote = await fetchAppVersion();
                  if (
                    remote.buildingVersion &&
                    compareVersions(remote.buildingVersion, local) > 0
                  ) {
                    showToast(
                      `v${remote.buildingVersion} en build (~45–60 min). Pas encore installable. Serveur actuel v${remote.version}.`
                    );
                    return;
                  }
                  showToast(`À jour — local v${local} · serveur v${remote.version}`);
                } catch {
                  showToast(`À jour — v${local}`);
                }
              }}
            />
            <DrawerRow
              icon="phone-portrait-outline"
              label="Guide web / iPhone"
              subtitle="Page d’installation multi-supports"
              onPress={() => {
                closeDrawer();
                void Linking.openURL(`${API_URL}/download`);
              }}
            />

            <Text style={[styles.section, { color: colors.textSecondary }]}>Préférences</Text>
            <DrawerRow
              icon={scheme === 'dark' ? 'sunny-outline' : 'moon-outline'}
              label={scheme === 'dark' ? 'Mode clair' : 'Mode sombre'}
              subtitle={
                scheme === 'dark'
                  ? 'Apparence actuelle : sombre — toucher pour passer en clair'
                  : 'Apparence actuelle : clair — toucher pour passer en sombre'
              }
              onPress={() => {
                toggleScheme();
                showToast(scheme === 'dark' ? 'Mode clair activé' : 'Mode sombre activé');
              }}
            />
            <View style={{ paddingHorizontal: 12 }}>
              <CountryPickerCard />
            </View>
            <DrawerRow
              icon="car-outline"
              label="Véhicule actif"
              subtitle={activeVehicle?.name || 'Aucun'}
              onPress={() => go('/(tabs)/vehicles')}
            />
            <DrawerRow
              icon="school-outline"
              label="Relancer le guide"
              subtitle="Tutoriel interactif + données démo (nettoyées à la fin)"
              onPress={() => {
                closeDrawer();
                void import('@/components/OnboardingTutorial').then((m) => m.replayOnboarding());
              }}
            />
            <DrawerRow
              icon="git-branch-outline"
              label="Trajets programmés"
              subtitle="Trajets réguliers (domicile ↔ travail…)"
              onPress={() => go('/scheduled-trips')}
            />

            {user && (
              <>
                <Text style={[styles.section, { color: colors.textSecondary }]}>Session</Text>
                <DrawerRow
                  icon="log-out-outline"
                  label="Déconnexion"
                  danger
                  onPress={async () => {
                    await logout();
                    closeDrawer();
                    showToast('Déconnecté — données locales conservées');
                  }}
                />
              </>
            )}
          </ScrollView>

          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 11,
              textAlign: 'center',
              paddingHorizontal: 16,
            }}
          >
            {country.nameNative} · {country.currency}
            {busy ? ' · …' : ''}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  panel: {
    height: '100%',
    borderRightWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 4, height: 0 },
      },
      android: { elevation: 16 },
      default: {},
    }),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  headTitle: { fontSize: 20, fontWeight: '800' },
  section: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
