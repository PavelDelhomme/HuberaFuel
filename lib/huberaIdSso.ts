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
