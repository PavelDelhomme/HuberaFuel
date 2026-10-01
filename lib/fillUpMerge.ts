/**
 * Fusionne les pleins locaux absents du cloud (Maps / Nothing hors session).
 * Empreinte : véhicule + jour + litres + montant — pas l’id local.
 */

export type FillUpLike = {
  id: number;
  vehicleId: number;
  date: string;
  liters: number;
  totalCost: number;
};

export function fillUpFingerprint(f: {
  vehicleId?: number | null;
  date?: string | null;
  liters?: number | null;
  totalCost?: number | null;
}): string {
  const day = String(f.date || '').slice(0, 10);
  const L = Math.round((Number(f.liters) || 0) * 10) / 10;
  const eur = Math.round((Number(f.totalCost) || 0) * 100) / 100;
  return `${Number(f.vehicleId) || 0}|${day}|${L}|${eur}`;
}

export function mergeUniqueFillUps<T extends FillUpLike>(local: T[] | null | undefined, remote: T[] | null | undefined): {
  fills: T[];
  added: number;
} {
  const remoteList = Array.isArray(remote) ? remote.slice() : [];
  const seen = new Set(remoteList.map((f) => fillUpFingerprint(f)));
  let maxId = remoteList.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0);
  const extra: T[] = [];
  for (const f of local || []) {
    if (!f || !(Number(f.liters) > 0 || Number(f.totalCost) > 0)) continue;
    const fp = fillUpFingerprint(f);
    if (seen.has(fp)) continue;
    seen.add(fp);
    maxId += 1;
    extra.push({ ...f, id: maxId });
  }
  return { fills: extra.length ? remoteList.concat(extra) : remoteList, added: extra.length };
}
