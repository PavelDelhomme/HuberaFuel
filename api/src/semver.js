/** Compare a.b.c — positif si a > b. */
export function compareSemver(a, b) {
  const pa = String(a || '0')
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0')
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export const FUEL_PKG_HUBERA = 'cloud.hubera.fuel';
export const FUEL_PKG_LEGACY = 'com.gasoiltracking.app';

/** Normalise le package OTA. Sans hint → legacy (jamais coller un APK Hubera sur l’ancien id). */
export function normalizeFuelPackage(pkg) {
  const p = String(pkg || '').trim();
  if (p === FUEL_PKG_HUBERA) return FUEL_PKG_HUBERA;
  if (p === FUEL_PKG_LEGACY) return FUEL_PKG_LEGACY;
  return FUEL_PKG_LEGACY;
}

function rowPackage(row) {
  const p = String(row?.package_name || '').trim();
  if (p === FUEL_PKG_HUBERA || p === FUEL_PKG_LEGACY) return p;
  return FUEL_PKG_LEGACY;
}

/** Dernière release = max semver, puis max version_code, puis max id. Filtre package obligatoire. */
export function pickLatestRelease(rows, packageName = FUEL_PKG_LEGACY) {
  const want = normalizeFuelPackage(packageName);
  let best = null;
  for (const row of rows || []) {
    if (!row?.apk_filename) continue;
    if (rowPackage(row) !== want) continue;
    if (!best) {
      best = row;
      continue;
    }
    const sem = compareSemver(row.version, best.version);
    if (sem > 0) {
      best = row;
      continue;
    }
    if (sem < 0) continue;
    const vc = Number(row.version_code) || 0;
    const bvc = Number(best.version_code) || 0;
    if (vc > bvc || (vc === bvc && Number(row.id) > Number(best.id))) {
      best = row;
    }
  }
  return best;
}
