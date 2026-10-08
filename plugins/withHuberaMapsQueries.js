/**
 * Android 11+ : Fuel voit les apps sœurs Hubera (package + schémas).
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const PACKAGES = [
  'cloud.hubera.music',
  'ovh.delhomme.ytmusic',
  'cloud.hubera.maps',
  'ovh.delhomme.maps',
  'cloud.hubera.docs',
  'ovh.delhomme.hubera.docs',
  'cloud.hubera.mail',
  'fr.cloudity.cloudity_mail',
  'cloud.hubera.id',
  'cloud.hubera.drive',
  'cloud.hubera.pass',
  'cloud.hubera.calendar',
];
const SCHEMES = ['hubera-maps', 'cloudity-maps', 'hubera-music', 'hubera-docs', 'hubera-mail', 'hubera-id'];

function ensureQueries(manifest) {
  if (!manifest.queries) manifest.queries = [];
  let block = manifest.queries[0];
  if (!block) {
    block = {};
    manifest.queries.push(block);
  }
  if (!Array.isArray(block.package)) {
    block.package = block.package ? [block.package] : [];
  }
  for (const name of PACKAGES) {
    const exists = block.package.some((p) => p.$?.['android:name'] === name);
    if (!exists) block.package.push({ $: { 'android:name': name } });
  }
  if (!Array.isArray(block.intent)) {
    block.intent = block.intent ? [block.intent] : [];
  }
  const hasLauncher = block.intent.some(
    (it) => it?.action?.some?.((a) => a.$?.['android:name'] === 'android.intent.action.MAIN'),
  );
  if (!hasLauncher) {
    block.intent.push({
      action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
    });
  }
  for (const scheme of SCHEMES) {
    const exists = block.intent.some(
      (it) =>
        it?.data?.some?.((d) => d.$?.['android:scheme'] === scheme) ||
        it?.data?.$?.['android:scheme'] === scheme,
    );
    if (exists) continue;
    block.intent.push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      data: [{ $: { 'android:scheme': scheme } }],
    });
  }
  return manifest;
}

function withHuberaMapsQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest = ensureQueries(cfg.modResults.manifest);
    return cfg;
  });
}

module.exports = withHuberaMapsQueries;
