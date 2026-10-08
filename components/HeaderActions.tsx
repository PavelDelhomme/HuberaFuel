import React, { useRef } from 'react';
import { Pressable, View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/context/ToastContext';
import { pingApiHealth, syncFailureMessage } from '@/lib/api';

/** Sync manuelle (icône animée) — le thème clair/sombre est dans Préférences (menu). */
export function HeaderActions() {
  const { colors } = useTheme();
  const { user, syncNow } = useAuth();
  const { refresh } = useApp();
  const { showToast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const spin = useRef(new Animated.Value(0)).current;
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ok = await pingApiHealth();
      if (!cancelled && ok) setOffline(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const startSpin = () => {
    spin.setValue(0);
    loop.current = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      })
    );
    loop.current.start();
  };

  const stopSpin = () => {
    loop.current?.stop();
    loop.current = null;
    spin.setValue(0);
  };

  const onSync = async () => {
    if (!user || busy) return;
    setBusy(true);
    startSpin();
    try {
      const result = await syncNow();
      await refresh();
      setOffline(false);
      const hhmm = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      if (result === 'pulled') showToast(`Cloud téléchargé · ${hhmm}`);
      else if (result === 'pushed') showToast(`Sauvegarde envoyée · ${hhmm}`);
      else if (result === 'blocked-trip')
        showToast(`Sync reportée — terminez le trajet d’abord · ${hhmm}`);
      else if (result === 'up-to-date') showToast(`Déjà synchronisé · ${hhmm}`);
      else showToast(`Synchronisation à jour · ${hhmm}`);
    } catch (e) {
      const fail = syncFailureMessage(e);
      setOffline(fail.offline);
      showToast(fail.message);
    } finally {
      stopSpin();
      setBusy(false);
    }
  };

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => router.push('/account' as never)}
        accessibilityRole="button"
        accessibilityLabel="Compte Hubera"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[
          styles.actionBtn,
          {
            borderColor: colors.border,
            backgroundColor: colors.card,
            marginRight: 4,
          },
        ]}
      >
        <Ionicons name="person-circle-outline" size={22} color={colors.text} />
      </Pressable>
      {!!user && (
        <Pressable
          onPress={onSync}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ busy }}
          accessibilityLabel={busy ? 'Synchronisation en cours…' : 'Synchroniser manuellement'}
          accessibilityHint={
            offline ? 'Hors ligne — dernière synchronisation échouée' : 'Synchroniser avec le cloud'
          }
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[
            styles.actionBtn,
            {
              borderColor: colors.border,
              backgroundColor: busy ? colors.accent + '18' : colors.card,
              marginRight: Platform.OS === 'web' ? 12 : 4,
            },
          ]}
        >
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Ionicons
              name={offline ? 'cloud-offline-outline' : 'sync-outline'}
              size={18}
              color={busy ? colors.accent : offline ? colors.warning : colors.text}
            />
          </Animated.View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: Platform.OS === 'web' ? 4 : 0,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
