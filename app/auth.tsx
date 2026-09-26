import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/hooks/useTheme';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { QrWebLoginPanel } from '@/components/QrWebLoginPanel';
import { API_URL, forgotPassword } from '@/lib/api';
import { getAppFlavor } from '@/lib/appFlavor';

export default function AuthScreen() {
  const { login, register, huberaIdDetected, continueWithHuberaId } = useAuth();
  const { refresh } = useApp();
  const { colors } = useTheme();
  const flavor = getAppFlavor();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(flavor.defaultLoginEmail || '');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [huberaLoading, setHuberaLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (flavor.defaultLoginEmail && !email) {
      setEmail(flavor.defaultLoginEmail);
    }
  }, [flavor.defaultLoginEmail, email]);

  const handleContinueWithHuberaId = async () => {
    setError('');
    setInfo('');
    setHuberaLoading(true);
    try {
      const success = await continueWithHuberaId();
      if (success) {
        await refresh();
        router.replace('/' as never);
      } else {
        setError('Connexion Hubera ID impossible. Essayez avec email/mot de passe.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur Hubera ID');
    } finally {
      setHuberaLoading(false);
    }
  };

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
      <ScrollView contentContainerStyle={styles.content}>
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
          <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
            Package {flavor.androidPackage} — même compte que l’app Hubera Fuel (Nothing / Android)
          </Text>
        </View>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {mode === 'login'
            ? `Connexion cloud (sync). Serveur : ${API_URL}`
            : 'Compte utilisateur standard (pas admin). Code d’invitation requis. Un email de validation sera envoyé ; un gestionnaire peut aussi valider depuis Administration.'}
        </Text>
        {mode === 'login' && huberaIdDetected?.found && huberaIdDetected.email && (
          <View style={[styles.huberaIdBanner, { backgroundColor: '#4F46E5' + '15', borderColor: '#4F46E5' }]}>
            <Text style={{ color: '#4F46E5', fontWeight: '600', fontSize: 14, marginBottom: 8 }}>
              Compte Hubera ID détecté
            </Text>
            <TouchableOpacity
              onPress={handleContinueWithHuberaId}
              disabled={huberaLoading}
              style={[styles.huberaIdButton, { backgroundColor: '#4F46E5', opacity: huberaLoading ? 0.7 : 1 }]}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                {huberaLoading ? 'Connexion...' : `Continuer avec ${huberaIdDetected.email}`}
              </Text>
            </TouchableOpacity>
            <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 8, textAlign: 'center' }}>
              Connexion automatique via Hubera ID (SSO cross-app)
            </Text>
          </View>
        )}
        {mode === 'login' && (
          <QrWebLoginPanel
            onLoggedIn={async () => {
              await refresh();
              router.replace('/' as never);
            }}
          />
        )}
        {mode === 'login' && (
          <Text style={{ color: colors.textSecondary, fontWeight: '700', marginBottom: 10 }}>
            {huberaIdDetected?.found ? 'Ou avec email / mot de passe' : 'Avec email / mot de passe'}
          </Text>
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
          placeholder="vous@email.com"
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
  huberaIdBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  huberaIdButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  sub: { fontSize: 14, marginBottom: 20, lineHeight: 20 },
});
