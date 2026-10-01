import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Network from 'expo-network';
import {
  clearSession,
  fetchMe,
  fetchSync,
  getRefreshToken,
  getStoredUser,
  getToken,
  login as apiLogin,
  logoutRemote,
  register as apiRegister,
  setSession,
  type AuthUser,
  type PendingRegistrationSummary,
} from '@/lib/api';
import { applySnapshot, hasLocalUserData, normalizeSnapshot } from '@/lib/dataSnapshot';
import { saveLocalBackup, refreshFromCloud, syncPreferNewer, forcePushLocalToCloud, type SyncPreferResult } from '@/lib/backup';

type AuthContextType = {
  user: AuthUser | null;
  loading: boolean;
  pendingRegistrationsCount: number;
  pendingRegistrations: PendingRegistrationSummary[];
  refreshMe: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    name: string,
    inviteCode: string
  ) => Promise<{ ok: boolean; pending?: boolean; message?: string }>;
  logout: () => Promise<void>;
  syncNow: () => Promise<SyncPreferResult | void>;
  /** Remplace le local par les données cloud du compte */
  refreshCloudNow: () => Promise<{ ok: boolean; reason: string; updatedAt?: string | null }>;
  /** Pousse le local vers le cloud sans tirer (appareil source). */
  pushLocalNow: () => Promise<{ ok: boolean; reason: string }>;
  applySession: (token: string, user: AuthUser, refreshToken?: string | null) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingRegistrationsCount, setPendingRegistrationsCount] = useState(0);
  const [pendingRegistrations, setPendingRegistrations] = useState<PendingRegistrationSummary[]>(
    []
  );
  const wasOnlineRef = useRef<boolean | null>(null);
  const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshMe = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setPendingRegistrationsCount(0);
      setPendingRegistrations([]);
      return;
    }
    try {
      const me = await fetchMe();
      const next: AuthUser = {
        id: me.user.id,
        email: me.user.email,
        name: me.user.name,
        isManager: !!me.user.isManager,
        huberaLink: me.user.huberaLink || null,
      };
      setUser(next);
      const refresh = await getRefreshToken();
      await setSession(token, next, refresh);
      setPendingRegistrationsCount(me.pendingRegistrationsCount || 0);
      setPendingRegistrations(me.pendingRegistrations || []);
    } catch {
      /* session invalide ou offline */
    }
  }, []);

  /** Sync seulement si connecté + pas de trajet actif (hash égal → skipped dans backup). */
  const syncIfLoggedInIdle = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      // finalize + tiny close sont dans syncPreferNewer
      await syncPreferNewer();
    } catch {
      /* ignore */
    }
  }, []);

  const hydrateAccountAfterLogin = useCallback(async () => {
    try {
      const localHas = await hasLocalUserData();
      const remote = await fetchSync();
      const remoteSnap = normalizeSnapshot(remote?.data);
      const remoteVehicles = remoteSnap?.vehicles?.length || 0;

      if (remoteSnap && remoteVehicles > 0 && !localHas) {
        await applySnapshot(remoteSnap, 'replace');
        await saveLocalBackup(remoteSnap);
        return;
      }
      if (remoteSnap && remoteVehicles > 0) {
        const result = await syncPreferNewer();
        if (result === 'skipped' && (remoteSnap.trips?.length || 0) > 0) {
          const stillEmpty = !(await hasLocalUserData());
          if (stillEmpty) {
            await applySnapshot(remoteSnap, 'replace');
            await saveLocalBackup(remoteSnap);
          }
        }
        return;
      }
      if (localHas && Platform.OS !== 'web') {
        await forcePushLocalToCloud();
        return;
      }
      await syncPreferNewer();
    } catch {
      try {
        await saveLocalBackup();
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const refresh = await getRefreshToken();
      const stored = await getStoredUser();
      if (stored && (token || refresh)) {
        setUser(stored);
        try {
          await refreshMe();
        } catch {
          /* hors ligne : on garde le compte affiché */
        }
        try {
          await syncPreferNewer();
        } catch {
          /* offline */
        }
      }
      setLoading(false);
    })();
  }, [refreshMe]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshMe();
        void syncIfLoggedInIdle();
      }
    });
    return () => sub.remove();
  }, [refreshMe, syncIfLoggedInIdle]);

  // Reconnect réseau (natif + web) : sync si session + idle.
  useEffect(() => {
    const onNetwork = (state: { isConnected?: boolean | null; isInternetReachable?: boolean | null }) => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      if (online && wasOnlineRef.current === false) {
        if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
        syncDebounceRef.current = setTimeout(() => {
          void refreshMe();
          void syncIfLoggedInIdle();
        }, 800);
      }
      wasOnlineRef.current = online;
    };

    const sub = Network.addNetworkStateListener(onNetwork);
    void Network.getNetworkStateAsync()
      .then(onNetwork)
      .catch(() => {
        /* ignore */
      });

    return () => {
      sub.remove();
      if (syncDebounceRef.current) clearTimeout(syncDebounceRef.current);
    };
  }, [refreshMe, syncIfLoggedInIdle]);

  // Web : resync au chargement (IndexedDB souvent en retard vs téléphone)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    void syncIfLoggedInIdle();
  }, [syncIfLoggedInIdle]);

  const syncNow = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    return syncPreferNewer();
  }, []);

  const refreshCloudNow = useCallback(async () => {
    return refreshFromCloud();
  }, []);

  const pushLocalNow = useCallback(async () => {
    return forcePushLocalToCloud();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    const next: AuthUser = {
      ...res.user,
      isManager: !!res.user.isManager,
    };
    setUser(next);
    await hydrateAccountAfterLogin();
    try {
      const me = await fetchMe();
      setPendingRegistrationsCount(me.pendingRegistrationsCount || 0);
      setPendingRegistrations(me.pendingRegistrations || []);
      if (me.user) {
        const u: AuthUser = {
          id: me.user.id,
          email: me.user.email,
          name: me.user.name,
          isManager: !!me.user.isManager,
          huberaLink: me.user.huberaLink || null,
        };
        setUser(u);
        const token = await getToken();
        const refresh = await getRefreshToken();
        if (token) await setSession(token, u, refresh);
      }
    } catch {
      setPendingRegistrationsCount(0);
      setPendingRegistrations([]);
    }
  }, [hydrateAccountAfterLogin]);

  const register = useCallback(
    async (email: string, password: string, name: string, inviteCode: string) => {
      const platform = Platform.OS === 'web' ? 'web' : 'mobile';
      return apiRegister(email, password, name, inviteCode, platform);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await saveLocalBackup();
    } catch {
      /* ignore */
    }
    await logoutRemote();
    await clearSession();
    setUser(null);
    setPendingRegistrationsCount(0);
    setPendingRegistrations([]);
  }, []);

  const applySession = useCallback(
    async (token: string, next: AuthUser, refreshToken?: string | null) => {
      await setSession(token, next, refreshToken);
      setUser(next);
      await hydrateAccountAfterLogin();
    },
    [hydrateAccountAfterLogin]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        pendingRegistrationsCount,
        pendingRegistrations,
        refreshMe,
        login,
        register,
        logout,
        syncNow,
        refreshCloudNow,
        pushLocalNow,
        applySession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
