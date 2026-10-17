import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
  Modal,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { QrWebLoginPanel } from '@/components/QrWebLoginPanel';
import { API_URL, forgotPassword } from '@/lib/api';
import { getAppFlavor } from '@/lib/appFlavor';
import {
  isHuberaIdInstalled,
  listHuberaAccounts,
  openHuberaIdInstall,
  type HuberaIdDeviceAccount,
} from '@/lib/huberaIdSso';

const AVATAR = ['#1A73E8', '#188038', '#E37400', '#9334E6', '#007B83', '#C5221F', '#1967D2', '#0D7377'];

function avatarColor(email: string) {
  let hash = 0;
  const key = email.toLowerCase();
  for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
  return AVATAR[hash % AVATAR.length];
}

function accountTitle(email: string) {
  const local = email.split('@')[0]?.trim() || email;
  if (!local) return email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function accountInitial(email: string) {
  const title = accountTitle(email);
  return title ? title.charAt(0).toUpperCase() : '?';
}

export default function AuthScreen() {
  const { login, loginWithHubera, register } = useAuth();
  const { refresh } = useApp();
  const { colors } = useTheme();
  const flavor = getAppFlavor();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [huberaAccounts, setHuberaAccounts] = useState<HuberaIdDeviceAccount[]>([]);
  const [chooserOpen, setChooserOpen] = useState(Platform.OS === 'android');
  const [idInstalled, setIdInstalled] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    Promise.all([listHuberaAccounts(), isHuberaIdInstalled()]).then(([rows, installed]) => {
      setHuberaAccounts(rows);
      setIdInstalled(installed);
      setChooserOpen(true);
    });
  }, []);

  const submit = async () => {
    setError('');
    setInfo('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
        await refresh();
        router.replace('/' as never);
      } else {
        if (!inviteCode.trim()) throw new Error('Code d’invitation requis');
        if (password !== passwordConfirm) {
          throw new Error('Les mots de passe ne correspondent pas');
        }
        if (password.length < 8) {
          throw new Error('Mot de passe : au moins 8 caractères');
        }
        const res = await register(
          email.trim(),
          password,
          name.trim() || email.split('@')[0],
          inviteCode.trim()
        );
        setInfo(
          res?.message ||
            'Email envoyé ! Ouvrez-le, cliquez « Ouvrir la page de validation », puis « Confirmer mon email ». Ensuite connectez-vous ici.'
        );
        setMode('login');
        setPassword('');
        setPasswordConfirm('');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur';
      setError(
        /network|fetch|failed/i.test(msg)
          ? `Réseau : impossible de joindre ${API_URL}. Vérifiez Wi‑Fi / données.`
          : msg
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Modal visible={chooserOpen && mode === 'login'} transparent animationType="fade">
        <View
          style={[
            styles.chooserBackdrop,
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <View style={[styles.chooserCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.chooserTitle, { color: colors.text }]}>Choisir un compte</Text>
            {huberaAccounts.map((acc) => (
              <Pressable
                key={acc.email}
                onPress={async () => {
                  setChooserOpen(false);
                  if (!acc.accessToken) {
                    setError('Session absente');
                    return;
                  }
                  setLoading(true);
                  try {
                    await loginWithHubera(acc.accessToken);
                    await refresh();
                    router.replace('/' as never);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'SSO refusé.');
                  } finally {
                    setLoading(false);
                  }
                }}
                style={styles.chooserRow}
              >
                <View style={[styles.avatar, { backgroundColor: avatarColor(acc.email) }]}>
                  <Text style={styles.avatarLetter}>{accountInitial(acc.email)}</Text>
                </View>
                <View style={styles.chooserText}>
                  <Text style={[styles.chooserName, { color: colors.text }]} numberOfLines={1}>
                    {accountTitle(acc.email)}
                  </Text>
                  <Text style={[styles.chooserMail, { color: colors.textSecondary }]} numberOfLines={1}>
                    {acc.email}
                  </Text>
                </View>
              </Pressable>
            ))}
            {!idInstalled && (
              <Pressable onPress={() => openHuberaIdInstall()} style={styles.chooserRow}>
                <View style={[styles.avatar, styles.avatarAdd, { borderColor: colors.textSecondary }]}>
                  <Text style={[styles.avatarAddMark, { color: colors.text }]}>+</Text>
                </View>
                <Text style={[styles.chooserName, { color: colors.text }]}>Installer Hubera ID</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                setEmail('');
                setPassword('');
                setChooserOpen(false);
              }}
              style={styles.chooserRow}
            >
              <View style={[styles.avatar, styles.avatarAdd, { borderColor: colors.textSecondary }]}>
                <Text style={[styles.avatarAddMark, { color: colors.text }]}>+</Text>
              </View>
              <Text style={[styles.chooserName, { color: colors.text }]}>Ajouter un compte</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <Text style={[styles.title, { color: colors.text }]}>
          {mode === 'login' ? 'Connexion' : 'Créer un compte'}
        </Text>
        <View
          style={[
            styles.flavorBanner,
            { backgroundColor: flavor.accent + '22', borderColor: flavor.accent },
          ]}
        >
          <Text style={{ color: flavor.accent, fontWeight: '800', fontSize: 13 }}>
            {flavor.shortName} · {flavor.label}
          </Text>
        </View>
        {mode === 'login' && Platform.OS === 'web' && (
          <QrWebLoginPanel
            onLoggedIn={async () => {
              await refresh();
              router.replace('/' as never);
            }}
          />
        )}
        {mode === 'login' && Platform.OS !== 'web' && (
          <Button
            title="Scanner un QR pour connecter cet appareil"
            variant="outline"
            onPress={() => router.push('/qr-login?scan=1' as never)}
            style={{ marginBottom: 16 }}
          />
        )}
        {mode === 'login' && huberaAccounts.length > 0 && (
          <View style={{ marginBottom: 8 }}>
            {huberaAccounts.map((acc) => (
              <Pressable
                key={acc.email}
                onPress={async () => {
                  setError('');
                  if (!acc.accessToken) {
                    setError('Session absente');
                    return;
                  }
                  setLoading(true);
                  try {
                    await loginWithHubera(acc.accessToken);
                    await refresh();
                    router.replace('/' as never);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'SSO refusé.');
                  } finally {
                    setLoading(false);
                  }
                }}
                style={styles.chooserRow}
              >
                <View style={[styles.avatar, { backgroundColor: avatarColor(acc.email) }]}>
                  <Text style={styles.avatarLetter}>{accountInitial(acc.email)}</Text>
                </View>
                <View style={styles.chooserText}>
                  <Text style={[styles.chooserName, { color: colors.text }]} numberOfLines={1}>
                    {accountTitle(acc.email)}
                  </Text>
                  <Text style={[styles.chooserMail, { color: colors.textSecondary }]} numberOfLines={1}>
                    {acc.email}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
        {mode === 'register' && (
          <>
            <Input label="Nom" value={name} onChangeText={setName} placeholder="Vous" />
            <Input
              label="Code d’invitation"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="none"
              placeholder="Fourni par l’admin"
            />
          </>
        )}
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="vous@exemple.fr"
        />
        <Input
          label="Mot de passe"
          value={password}
          onChangeText={setPassword}
          passwordToggle
          placeholder="••••••••"
        />
        {mode === 'register' && (
          <Input
            label="Confirmer le mot de passe"
            value={passwordConfirm}
            onChangeText={setPasswordConfirm}
            passwordToggle
            placeholder="••••••••"
          />
        )}
        {!!error && (
          <Text
            accessibilityRole="alert"
            style={{ color: colors.danger, marginBottom: 12 }}
          >
            {error}
          </Text>
        )}
        {!!info && <Text style={{ color: colors.success, marginBottom: 12 }}>{info}</Text>}
        <Button
          title={mode === 'login' ? 'Se connecter' : 'Recevoir l’email de validation'}
          onPress={submit}
          loading={loading}
        />
        <Button
          title={mode === 'login' ? 'Pas de compte ? S’inscrire' : 'Déjà un compte ? Connexion'}
          variant="outline"
          onPress={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
            setInfo('');
          }}
          style={{ marginTop: 12 }}
        />
        {mode === 'login' && (
          <Button
            title="Mot de passe oublié"
            variant="outline"
            onPress={async () => {
              if (!email.trim()) {
                setError('Indiquez votre email puis réessayez.');
                return;
              }
              setLoading(true);
              setError('');
              try {
                const r = await forgotPassword(email.trim());
                setInfo(r.message || 'Email envoyé si le compte existe.');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Échec');
              } finally {
                setLoading(false);
              }
            }}
            style={{ marginTop: 12 }}
          />
        )}
        <Button
          title="Installer / télécharger (Android, iPhone, web)"
          variant="secondary"
          onPress={() => Linking.openURL(`${API_URL}/download`)}
          style={{ marginTop: 12 }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingTop: 32 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  flavorBanner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  sub: { fontSize: 14, marginBottom: 20, lineHeight: 20 },
  chooserBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  chooserCard: { borderRadius: 28, paddingVertical: 12, paddingHorizontal: 8 },
  chooserTitle: { fontSize: 22, fontWeight: '400', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  chooserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarLetter: { color: '#fff', fontSize: 16, fontWeight: '600' },
  avatarAdd: { backgroundColor: 'transparent', borderWidth: 1 },
  avatarAddMark: { fontSize: 20 },
  chooserText: { flex: 1 },
  chooserName: { fontSize: 16, fontWeight: '500' },
  chooserMail: { fontSize: 14, marginTop: 2 },
});
