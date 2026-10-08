import { Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

export type HuberaSlug =
  | 'music'
  | 'maps'
  | 'fuel'
  | 'docs'
  | 'calendar'
  | 'drive'
  | 'mail'
  | 'pass'
  | 'jobs'
  | 'id'
  | 'tasks'
  | 'contacts'
  | 'photos'
  | 'notes'
  | 'cook'
  | 'office'
  | 'budget'
  | 'stream';

type Spec = { slug: HuberaSlug; host: string; packages: string[]; scheme: string };

const CATALOG: Spec[] = [
  { slug: 'music', host: 'music.hubera.cloud', packages: ['cloud.hubera.music', 'ovh.delhomme.ytmusic'], scheme: 'hubera-music' },
  { slug: 'maps', host: 'maps.hubera.cloud', packages: ['cloud.hubera.maps', 'ovh.delhomme.maps'], scheme: 'hubera-maps' },
  { slug: 'fuel', host: 'fuel.hubera.cloud', packages: ['cloud.hubera.fuel', 'com.gasoiltracking.app'], scheme: 'hubera-fuel' },
  { slug: 'docs', host: 'docs.hubera.cloud', packages: ['cloud.hubera.docs', 'ovh.delhomme.hubera.docs'], scheme: 'hubera-docs' },
  { slug: 'calendar', host: 'calendar.hubera.cloud', packages: ['cloud.hubera.calendar', 'fr.cloudity.cloudity_calendar'], scheme: 'hubera-calendar' },
  { slug: 'drive', host: 'drive.hubera.cloud', packages: ['cloud.hubera.drive', 'fr.cloudity.cloudity_drive'], scheme: 'hubera-drive' },
  { slug: 'mail', host: 'mail.hubera.cloud', packages: ['cloud.hubera.mail', 'fr.cloudity.cloudity_mail'], scheme: 'hubera-mail' },
  { slug: 'pass', host: 'pass.hubera.cloud', packages: ['cloud.hubera.pass', 'com.cloudity.cloudity_pass'], scheme: 'hubera-pass' },
  { slug: 'jobs', host: 'jobs.hubera.cloud', packages: ['cloud.hubera.jobs', 'ovh.delhomme.jobbingtrack'], scheme: 'hubera-jobs' },
  { slug: 'id', host: 'id.hubera.cloud', packages: ['cloud.hubera.id'], scheme: 'hubera-id' },
];

/** App installée d’abord (Intent MAIN/LAUNCHER), sinon schéma, sinon https. Jamais Custom Tabs si l’APK est là. */
export async function openOrWeb(slug: string): Promise<void> {
  const spec = CATALOG.find((s) => s.slug === slug) ?? {
    slug: slug as HuberaSlug,
    host: `${slug}.hubera.cloud`,
    packages: [`cloud.hubera.${slug}`],
    scheme: `hubera-${slug}`,
  };
  if (Platform.OS === 'android') {
    for (const pkg of spec.packages) {
      try {
        await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
          category: 'android.intent.category.LAUNCHER',
          packageName: pkg,
        });
        return;
      } catch {
        /* paquet absent */
      }
    }
  }
  const schemeUrl = `${spec.scheme}://open`;
  try {
    if (await Linking.canOpenURL(schemeUrl)) {
      await Linking.openURL(schemeUrl);
      return;
    }
  } catch {
    /* schéma inconnu */
  }
  await Linking.openURL(`https://${spec.host}`);
}
