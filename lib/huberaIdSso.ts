import { NativeModules, Platform } from 'react-native';

export type HuberaIdDeviceAccount = {
  email: string;
  accessToken: string;
  refreshToken: string;
  issuer: string;
};

const native = NativeModules.HuberaIdSso as
  | {
      listAccounts: () => Promise<HuberaIdDeviceAccount[]>;
      saveSession: (email: string, accessToken: string, refreshToken: string) => Promise<void>;
      idInstalled: () => Promise<boolean>;
      openIdInstall: () => Promise<void>;
    }
  | undefined;

export async function listHuberaAccounts(): Promise<HuberaIdDeviceAccount[]> {
  if (Platform.OS !== 'android' || !native?.listAccounts) return [];
  try {
    const rows = await native.listAccounts();
    return (rows || []).filter((a) => a?.email);
  } catch {
    return [];
  }
}

export async function isHuberaIdInstalled(): Promise<boolean> {
  if (Platform.OS !== 'android' || !native?.idInstalled) return true;
  try {
    return await native.idInstalled();
  } catch {
    return false;
  }
}

export async function openHuberaIdInstall(): Promise<void> {
  if (Platform.OS !== 'android' || !native?.openIdInstall) return;
  try {
    await native.openIdInstall();
  } catch {
    /* page d’install indisponible */
  }
}

export async function publishHuberaSession(
  email: string,
  accessToken: string,
  refreshToken = '',
): Promise<void> {
  if (Platform.OS !== 'android' || !native?.saveSession || !email) return;
  try {
    await native.saveSession(email, accessToken || '', refreshToken || '');
  } catch {
    /* plugin absent */
  }
}
