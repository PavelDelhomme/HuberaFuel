/**
 * Pont GPS Android natif (tous les providers, mock huberalab).
 * Expo Fused ignore souvent cmd location — Maps a le même pont.
 */
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type NativeFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  mocked: boolean;
  provider: string;
  timestamp: number;
};

type HuberaLocationNative = {
  startWatch: () => void;
  stopWatch: () => void;
  addListener?: (event: string) => void;
  removeListeners?: (n: number) => void;
};

function module(): HuberaLocationNative | null {
  if (Platform.OS !== 'android') return null;
  const m = NativeModules.HuberaLocation as HuberaLocationNative | undefined;
  return m ?? null;
}

export function subscribeNativeFixes(onFix: (fix: NativeFix) => void): () => void {
  const native = module();
  if (!native) return () => {};
  const emitter = new NativeEventEmitter(native as never);
  const sub = emitter.addListener('huberaFix', (raw: NativeFix) => {
    if (!raw || !Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude)) return;
    onFix(raw);
  });
  native.startWatch();
  return () => {
    sub.remove();
    native.stopWatch();
  };
}
