/**
 * Maps ouvre Fuel en silencieux (snapshot / start GPS).
 * Pendant ce hop : pas de splash, pas de modale de mise à jour.
 */
import * as Linking from 'expo-linking';

let mapsSilentUntil = 0;

export function markMapsSilent(ms = 15000) {
  mapsSilentUntil = Date.now() + ms;
}

export function isMapsSilentHop(): boolean {
  return Date.now() < mapsSilentUntil;
}

function maybeMark(url: string | null | undefined) {
  if (url && /[?&]silent=1(?:&|$)/.test(url)) markMapsSilent();
}

void Linking.getInitialURL().then((url) => maybeMark(url));
Linking.addEventListener('url', ({ url }) => maybeMark(url));
