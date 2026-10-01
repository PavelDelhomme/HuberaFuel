/**
 * Scan / deep-link QR :
 * - ?c=… → téléphone connecté approuve la connexion d’un navigateur (/auth)
 * - ?claim=… → cet appareil récupère la session (QR pair depuis Mon compte web)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/Button';
import { InlineBackBar } from '@/components/HeaderBackButton';
import { approveQrLogin, parseQrLoginChallenge, pollQrLogin } from '@/lib/api';
import { notify } from '@/lib/notify';

function parseClaimId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    if (s.includes('claim=')) {
      const u = s.includes('://') ? new URL(s) : new URL(s, 'https://x.local');
      const c = u.searchParams.get('claim');
      if (c && c.length >= 8) return c;
    }
  } catch {
    /* ignore */
  }
  const m = /(?:^|[?&#])claim=([^&#]+)/i.exec(s);
  if (m?.[1]) return decodeURIComponent(m[1]);
  // UUID challengeId brut
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return s;
  return null;
}

export default function QrLoginScreen() {
  const { colors } = useTheme();
  const { user, applySession } = useAuth();
  const { refresh } = useApp();
  const params = useLocalSearchParams<{
    c?: string;
    challenge?: string;
    scan?: string;
    claim?: string;
  }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [scanning, setScanning] = useState(Platform.OS !== 'web' && !params.claim);
  const handled = React.useRef(false);

  const claimSession = useCallback(
    async (challengeId: string) => {
      if (busy) return;
      setBusy(true);
      setMsg('Connexion de cet appareil…');
      setScanning(false);
      try {
        const res = await pollQrLogin(challengeId);
        if (res.status === 'approved' && res.token && res.user) {
          await applySession(res.token, res.user, res.refreshToken);
          await refresh();
          notify('Connecté', res.user.email || 'Session importée');
          setMsg('OK — cet appareil est connecté.');
          setTimeout(() => router.replace('/' as never), 700);
          return;
        }
        if (res.status === 'expired' || res.status === 'consumed') {
          setMsg('QR déjà utilisé ou expiré — régénérez-le sur Mon compte (web).');
          return;
        }
        setMsg(res.error || 'En attente… réessayez.');
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Échec');
      } finally {
        setBusy(false);
      }
    },
    [applySession, busy, refresh]
  );

  const approve = useCallback(
    async (raw: string) => {
      const claimId = parseClaimId(raw);
      if (claimId) {
        await claimSession(claimId);
        return;
      }
      const challenge = parseQrLoginChallenge(raw);
      if (!challenge) {
        setMsg('QR non reconnu. Scannez le code affiché sur le site.');
        return;
      }
      if (!user) {
        setMsg('Connectez-vous d’abord dans l’app, puis rescannez.');
        return;
      }
      if (busy) return;
      setBusy(true);
      setMsg('Autorisation…');
      try {
        const res = await approveQrLogin(challenge);
        notify('Site web', res.message || 'Connexion autorisée');
        setMsg('OK — le site est connecté. Vous pouvez fermer.');
        setTimeout(() => router.back(), 900);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Échec');
      } finally {
        setBusy(false);
      }
    },
    [busy, claimSession, user]
  );

  useEffect(() => {
    if (handled.current) return;
    if (params.claim) {
      handled.current = true;
      void claimSession(String(params.claim));
      return;
    }
    const fromParams = params.c || params.challenge;
    if (!fromParams) return;
    handled.current = true;
    setScanning(false);
    void approve(String(fromParams));
  }, [params.c, params.challenge, params.claim, approve, claimSession]);

  // Web + claim : récupérer la session directement
  if (Platform.OS === 'web' && params.claim) {
    return (
      <View style={[styles.wrap, { backgroundColor: colors.background }]}>
        <InlineBackBar />
        <Text style={[styles.title, { color: colors.text }]}>Connexion appareil</Text>
        {busy ? <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} /> : null}
        {!!msg && (
          <Text
            style={{
              color: /OK|connecté/i.test(msg) ? colors.success : colors.textSecondary,
              marginTop: 14,
              fontWeight: '700',
              lineHeight: 20,
            }}
          >
            {msg}
          </Text>
        )}
        {!busy && !/OK/i.test(msg) && (
          <Button
            title="Réessayer"
            onPress={() => {
              handled.current = false;
              void claimSession(String(params.claim));
            }}
            style={{ marginTop: 16 }}
          />
        )}
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.wrap, { backgroundColor: colors.background }]}>
        <InlineBackBar />
        <Text style={[styles.title, { color: colors.text }]}>Connexion QR</Text>
        <Text style={{ color: colors.textSecondary, lineHeight: 20 }}>
          Pour connecter ce navigateur : ouvrez Connexion (QR à scanner avec le téléphone déjà
          connecté). Pour connecter un autre appareil depuis un compte web : Mon compte → QR.
        </Text>
        <Button
          title="Aller à la connexion"
          onPress={() => router.replace('/auth' as never)}
          style={{ marginTop: 16 }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <InlineBackBar />
      <Text style={[styles.title, { color: colors.text }]}>
        {params.claim ? 'Connexion appareil' : 'Scanner le QR du site'}
      </Text>
      <Text style={{ color: colors.textSecondary, marginBottom: 12, lineHeight: 18 }}>
        {params.claim
          ? 'Récupération de la session depuis Mon compte (web)…'
          : user
            ? `Connecté en tant que ${user.email}. Pointez la caméra vers le QR du site, ou vers un QR « autre appareil ».`
            : 'Sans session : scannez un QR « Connecter un autre appareil » (Mon compte web). Avec session : autorisez la connexion d’un navigateur.'}
      </Text>

      {!user && !params.claim ? (
        <Button title="Se connecter" onPress={() => router.push('/auth' as never)} />
      ) : null}

      {scanning ? (
        !permission?.granted ? (
          <View>
            <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>
              Autorisez la caméra pour scanner le QR.
            </Text>
            <Button title="Autoriser la caméra" onPress={() => void requestPermission()} />
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={
                busy
                  ? undefined
                  : ({ data }) => {
                      setScanning(false);
                      void approve(data);
                    }
              }
            />
            <View style={styles.frame} pointerEvents="none" />
          </View>
        )
      ) : null}

      {!!msg && (
        <Text
          style={{
            color: /OK|autoris|connecté/i.test(msg) ? colors.success : colors.danger,
            marginTop: 14,
            fontWeight: '700',
          }}
        >
          {msg}
        </Text>
      )}

      {!scanning && (
        <Button
          title="Scanner à nouveau"
          onPress={() => {
            handled.current = false;
            setMsg('');
            setScanning(true);
          }}
          style={{ marginTop: 16 }}
          loading={busy}
        />
      )}

      <Pressable onPress={() => router.back()} style={{ marginTop: 20 }}>
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>Fermer</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 8, marginTop: 4 },
  cameraWrap: {
    height: 320,
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 8,
    backgroundColor: '#000',
  },
  frame: {
    position: 'absolute',
    left: '15%',
    right: '15%',
    top: '20%',
    bottom: '20%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 12,
  },
});
