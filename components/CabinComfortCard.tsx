import React, { useState, useSyncExternalStore } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import {
  cabinComfortFactor,
  getCabinComfort,
  setCabinComfort,
  subscribeCabinComfort,
} from '@/lib/cabinComfort';

export function CabinComfortCard() {
  const { colors } = useTheme();
  const comfort = useSyncExternalStore(subscribeCabinComfort, getCabinComfort, getCabinComfort);
  const [open, setOpen] = useState(false);
  const factor = cabinComfortFactor(comfort);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Habitacle</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8 }}>
        Entré dans le calcul · × {factor.toFixed(2)}
      </Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => setCabinComfort({ ac: !comfort.ac })}
          style={[styles.switch, { borderColor: colors.border, backgroundColor: comfort.ac ? colors.accent : 'transparent' }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: comfort.ac }}
        >
          <Text style={{ color: comfort.ac ? '#fff' : colors.text, fontWeight: '700' }}>
            Clim {comfort.ac ? 'on' : 'off'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setCabinComfort({ heat: !comfort.heat })}
          style={[styles.switch, { borderColor: colors.border, backgroundColor: comfort.heat ? colors.accent : 'transparent' }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: comfort.heat }}
        >
          <Text style={{ color: comfort.heat ? '#fff' : colors.text, fontWeight: '700' }}>
            Chauffage {comfort.heat ? 'on' : 'off'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setOpen(true)}
          style={[styles.switch, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.text, fontWeight: '800' }}>{comfort.deg}°</Text>
        </Pressable>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.popup, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>Température habitacle</Text>
            <Text style={{ color: colors.text, fontSize: 36, fontWeight: '800', textAlign: 'center' }}>
              {comfort.deg}°
            </Text>
            <View style={styles.gaugeRow}>
              {[-5, 0, 10, 18, 21, 24, 28, 35].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setCabinComfort({ deg: n })}
                  style={[
                    styles.tick,
                    {
                      borderColor: colors.border,
                      backgroundColor: comfort.deg === n ? colors.accent : 'transparent',
                    },
                  ]}
                >
                  <Text style={{ color: comfort.deg === n ? '#fff' : colors.text, fontWeight: '700' }}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setOpen(false)} style={{ alignSelf: 'flex-end', padding: 8 }}>
              <Text style={{ color: colors.accent, fontWeight: '800' }}>Fermer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10 },
  title: { fontWeight: '800', fontSize: 16, marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switch: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  popup: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  gaugeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  tick: { borderWidth: 1, borderRadius: 10, minWidth: 44, paddingVertical: 8, alignItems: 'center' },
});
