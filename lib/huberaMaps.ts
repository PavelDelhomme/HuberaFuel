/**
 * Handoff Hubera Maps : suivi libre / navigation.
 * Fuel reste propriétaire du trajet GPS ; Maps affiche et commande pause/stop/plein.
 */
import { Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  buildHuberaMapsAppUrl,
  buildHuberaMapsWebUrl,
  type HuberaMapsTrackOpts,
} from '@/lib/huberaMapsUrl';

export type { HuberaMapsTrackOpts };
export { buildHuberaMapsAppUrl, buildHuberaMapsWebUrl } from '@/lib/huberaMapsUrl';

export type HuberaMapsOpenResult = 'app' | 'web' | false;

const APP_SCHEMES = ['hubera-maps', 'cloudity-maps'] as const;
const MAPS_PACKAGES = ['cloud.hubera.maps', 'ovh.delhomme.maps'] as const;
const MAPS_ACTIVITY = 'ovh.delhomme.maps.MainActivity';

async function tryOpen(url: string): Promise<boolean> {
  try {
    const can = await Linking.canOpenURL(url).catch(() => true);
    if (!can && Platform.OS === 'ios') return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Android : VIEW ciblé paquet Maps (plus fiable que canOpenURL seul). */
async function tryOpenMapsPackage(url: string): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  for (const pkg of MAPS_PACKAGES) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: url,
        packageName: pkg,
        className: MAPS_ACTIVITY,
      });
      return true;
    } catch {
      /* paquet absent ou filtre intent manquant */
    }
  }
  return false;
}

/**
 * Ouvre l’app Hubera Maps si elle est installée (deep link track/navigate).
 * Fallback web maps.hubera.cloud. Pas de Google ici.
 */
export async function openHuberaMapsForTrip(
  opts: HuberaMapsTrackOpts
): Promise<HuberaMapsOpenResult> {
  for (const scheme of APP_SCHEMES) {
    const url = buildHuberaMapsAppUrl(opts, scheme);
    if (await tryOpenMapsPackage(url)) return 'app';
    if (await tryOpen(url)) return 'app';
  }
  if (await tryOpen(buildHuberaMapsWebUrl(opts))) return 'web';
  return false;
}

/** Navigation A→B : Maps d’abord, sinon false (l’appelant peut tomber sur Google). */
export async function openHuberaMapsNavigate(
  opts: HuberaMapsTrackOpts
): Promise<HuberaMapsOpenResult> {
  return openHuberaMapsForTrip({ ...opts, mode: 'nav' });
}
