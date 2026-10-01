import Constants from 'expo-constants';

export type AppFlavorKey = 'prod' | 'preprod' | 'dev' | 'feat' | 'qa' | 'admin';

export type AppFlavorInfo = {
  key: AppFlavorKey;
  shortName: string;
  label: string;
  accent: string;
  defaultLoginEmail: string;
  followsProdOta: boolean;
  androidPackage: string;
};

function extra(): Record<string, unknown> {
  return (Constants.expoConfig?.extra || {}) as Record<string, unknown>;
}

export function getAppFlavor(): AppFlavorInfo {
  const e = extra();
  const key = String(e.appFlavor || 'prod') as AppFlavorKey;
  return {
    key: (['prod', 'preprod', 'dev', 'feat', 'qa', 'admin'] as AppFlavorKey[]).includes(key)
      ? key
      : 'prod',
    shortName: String(e.flavorShortName || 'Prod'),
    label: String(e.flavorLabel || 'Production'),
    accent: String(e.flavorAccent || '#c73a52'),
    defaultLoginEmail: String(e.defaultLoginEmail || ''),
    followsProdOta: Boolean(e.followsProdOta),
    androidPackage:
      Constants.expoConfig?.android?.package || 'cloud.hubera.fuel',
  };
}

export function followsProductionOta(): boolean {
  return getAppFlavor().followsProdOta;
}
