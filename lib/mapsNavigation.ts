/**
 * Lance la navigation externe (Google Maps / Apple Maps).
 * Les waypoints `via:` biaisent l’itinéraire sans créer d’arrêt — toujours encodés.
 */
import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildViaWaypoints, samplePassThroughViasFromRoute } from '@/lib/routeVias';
import {
  buildAppleMapsUrl,
  buildGoogleMapsDirUrl as buildDirUrlPure,
  formatDestinationParam,
  formatViaPassThrough,
  fmtLatLng,
  type MapsLatLng,
} from '@/lib/mapsUrl';

export type { MapsLatLng };
export type MapsAppChoice = 'google' | 'apple';

export {
  buildViaWaypoints,
  samplePassThroughViasFromRoute,
  formatViaPassThrough,
  formatDestinationParam,
};

const MAPS_PREF_KEY = 'gasoil_maps_app_pref_v1';
const HUBERA_MAPS_PACKAGES = ['cloud.hubera.maps', 'ovh.delhomme.maps'] as const;
const HUBERA_MAPS_ACTIVITY = 'ovh.delhomme.maps.MainActivity';
const HUBERA_MAPS_OTA = 'https://maps.hubera.cloud';

function fmt(p: MapsLatLng): string {
  return fmtLatLng(p);
}

/** URL HTTPS directions — délègue au builder pur (+ platform). */
export function buildGoogleMapsDirUrl(opts: {
  destination: MapsLatLng;
  origin?: MapsLatLng | null;
  waypoints?: MapsLatLng[];
  navigate?: boolean;
  destinationLabel?: string | null;
}): string {
  return buildDirUrlPure({ ...opts, platform: Platform.OS });
}

export { buildAppleMapsUrl };

/** Ouvre Hubera Maps (paquet explicite). Jamais un geo: nu, qui part vers Organic Maps. */
async function openHuberaMaps(data?: string): Promise<boolean> {
  if (Platform.OS === 'android') {
    for (const pkg of HUBERA_MAPS_PACKAGES) {
      if (data) {
        try {
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data,
            packageName: pkg,
            className: HUBERA_MAPS_ACTIVITY,
          });
          return true;
        } catch {
          /* cette activité ne prend pas l’URI */
        }
      }
      try {
        await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
          category: 'android.intent.category.LAUNCHER',
          packageName: pkg,
          className: HUBERA_MAPS_ACTIVITY,
        });
        return true;
      } catch {
        /* paquet absent */
      }
    }
  }
  return tryOpen(HUBERA_MAPS_OTA);
}

async function tryOpen(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function getPreferredMapsApp(): Promise<MapsAppChoice | null> {
  try {
    const v = await AsyncStorage.getItem(MAPS_PREF_KEY);
    if (v === 'google' || v === 'apple') return v;
  } catch {
    /* ignore */
  }
  return null;
}

export async function setPreferredMapsApp(app: MapsAppChoice): Promise<void> {
  try {
    await AsyncStorage.setItem(MAPS_PREF_KEY, app);
  } catch {
    /* ignore */
  }
}

/** Demande Google vs Apple (iOS) ; mémorise le choix. */
export function askMapsAppPreference(): Promise<MapsAppChoice> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Navigation',
          message: 'Quelle app utiliser pour ce trajet ?',
          options: ['Google Maps', 'Plans (Apple)', 'Annuler'],
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) {
            void setPreferredMapsApp('google');
            resolve('google');
          } else if (idx === 1) {
            void setPreferredMapsApp('apple');
            resolve('apple');
          } else {
            resolve('apple');
          }
        }
      );
      return;
    }
    Alert.alert('Navigation', 'Quelle app utiliser ?', [
      {
        text: 'Google Maps',
        onPress: () => {
          void setPreferredMapsApp('google');
          resolve('google');
        },
      },
      {
        text: 'Plans Apple',
        onPress: () => {
          void setPreferredMapsApp('apple');
          resolve('apple');
        },
      },
      { text: 'Annuler', style: 'cancel', onPress: () => resolve('google') },
    ]);
  });
}

async function resolveMapsApp(): Promise<MapsAppChoice> {
  if (Platform.OS === 'android') return 'google';
  if (Platform.OS === 'web') return 'google';
  const pref = await getPreferredMapsApp();
  if (pref) return pref;
  return askMapsAppPreference();
}

async function openGoogleMaps(opts: {
  destination: MapsLatLng;
  origin?: MapsLatLng | null;
  waypoints?: MapsLatLng[];
  label?: string | null;
}): Promise<boolean> {
  const dest = fmt(opts.destination);
  const wps = (opts.waypoints || []).slice(0, 2);
  const hasVia = wps.length > 0;
  const label = opts.label;

  if (Platform.OS === 'android') {
    const q = label?.trim()
      ? encodeURIComponent(`${label.trim()}@${dest}`)
      : dest;
    return openHuberaMaps(`geo:0,0?q=${q}`);
  }

  if (Platform.OS === 'ios') {
    if (hasVia) {
      const pathUrl = buildGoogleMapsDirUrl({
        destination: opts.destination,
        origin: opts.origin,
        waypoints: wps,
        navigate: true,
        destinationLabel: label,
      });
      if (await tryOpen(pathUrl)) return true;
    }
    const gmaps = hasVia
      ? buildGoogleMapsDirUrl({
          destination: opts.destination,
          origin: opts.origin,
          waypoints: wps,
          navigate: true,
          destinationLabel: label,
        })
      : opts.origin
        ? `comgooglemaps://?saddr=${fmt(opts.origin)}&daddr=${dest}&directionsmode=driving`
        : `comgooglemaps://?daddr=${dest}&directionsmode=driving`;
    if (await tryOpen(gmaps)) return true;
  }

  return tryOpen(
    buildGoogleMapsDirUrl({
      destination: opts.destination,
      origin: opts.origin,
      waypoints: hasVia ? wps : undefined,
      navigate: true,
      destinationLabel: label,
    })
  );
}

async function openAppleMaps(opts: {
  destination: MapsLatLng;
  origin?: MapsLatLng | null;
}): Promise<boolean> {
  if (await tryOpen(buildAppleMapsUrl(opts))) return true;
  return tryOpen(
    `maps://?daddr=${fmt(opts.destination)}${opts.origin ? `&saddr=${fmt(opts.origin)}` : ''}&dirflg=d`
  );
}

export async function openGoogleMapsHere(opts?: {
  latitude?: number;
  longitude?: number;
}): Promise<boolean> {
  const lat = opts?.latitude;
  const lon = opts?.longitude;
  const hasFix =
    lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon);
  if (Platform.OS === 'android') {
    if (hasFix) return openHuberaMaps(`geo:${lat},${lon}?q=${lat},${lon}`);
    return openHuberaMaps();
  }
  if (hasFix) {
    return tryOpen(`https://www.google.com/maps/@${lat},${lon},17z`);
  }
  return tryOpen('https://www.google.com/maps');
}

export async function launchGoogleMapsNavigation(opts: {
  destination: MapsLatLng;
  origin?: MapsLatLng | null;
  waypoints?: MapsLatLng[];
  label?: string;
  preferGoogle?: boolean;
}): Promise<boolean> {
  const wps = opts.waypoints || [];
  const app =
    opts.preferGoogle || wps.length > 0 || Platform.OS === 'android'
      ? 'google'
      : await resolveMapsApp();
  if (app === 'apple' && Platform.OS === 'ios') {
    return openAppleMaps({
      destination: opts.destination,
      origin: opts.origin,
    });
  }
  return openGoogleMaps(opts);
}

export const launchMapsNavigation = launchGoogleMapsNavigation;
