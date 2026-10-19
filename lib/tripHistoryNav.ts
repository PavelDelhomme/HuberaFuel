import { toLocalYmd } from '@/lib/dates';
import { ymdInInclusiveRange } from '@/lib/tripHistoryCalendar';

export type TripHistoryFilter = 'all' | 'today' | 'sinceFill' | 'date' | 'range';

export type TripHistoryNavParams = {
  tab: 'history';
  filter: TripHistoryFilter;
  vehicleId?: string;
  from?: string;
  to?: string;
};

/** Href expo-router vers l’historique trajets (filtres + véhicule). */
export function tripHistoryNav(opts?: {
  filter?: TripHistoryFilter;
  vehicleId?: number | null;
  from?: string;
  to?: string;
}): { pathname: '/(tabs)/trip'; params: TripHistoryNavParams } {
  const params: TripHistoryNavParams = {
    tab: 'history',
    filter: opts?.filter ?? 'all',
  };
  if (opts?.vehicleId != null && Number.isFinite(opts.vehicleId) && opts.vehicleId > 0) {
    params.vehicleId = String(opts.vehicleId);
  }
  if (opts?.from && isYmd(opts.from)) params.from = opts.from;
  if (opts?.to && isYmd(opts.to)) params.to = opts.to;
  return { pathname: '/(tabs)/trip', params };
}

export function isYmd(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

export function parseYmdParam(raw: unknown): string | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string' || !isYmd(s)) return null;
  return s;
}

function hasZone(raw: string): boolean {
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
}

/** Instant d’un horodatage trajet ou plein, y compris `AAAA-MM-JJ HH:MM:SS` sans fuseau. */
export function tripInstantMs(raw: string): number {
  const s = String(raw || '').trim();
  if (!s) return NaN;
  if (hasZone(s)) {
    const d = new Date(s);
    return d.getTime();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) {
    const d = new Date(s);
    return d.getTime();
  }
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] || 0),
    Number(m[5] || 0),
    Number(m[6] || 0)
  ).getTime();
}

export function tripStartedOnYmd(startTime: string, ymd: string): boolean {
  return tripYmd(startTime) === ymd;
}

export function tripYmd(startTime: string): string {
  const s = String(startTime || '').trim();
  if (!s) return '';
  if (hasZone(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return toLocalYmd(d);
  }
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (day) return day[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toLocalYmd(d);
  return '';
}

/** Trajet compté depuis un plein, même si les chaînes n’ont pas le même format. */
export function tripAtOrAfter(startTime: string, fillDate: string): boolean {
  const a = tripInstantMs(startTime);
  const b = tripInstantMs(fillDate);
  if (Number.isFinite(a) && Number.isFinite(b)) return a + 500 >= b;
  return String(startTime || '') >= String(fillDate || '');
}

export function tripIsToday(startTime: string, now = new Date()): boolean {
  return tripStartedOnYmd(startTime, toLocalYmd(now));
}

export function parseHistoryFilter(raw: unknown): TripHistoryFilter | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s === 'today' || s === 'sinceFill' || s === 'all' || s === 'date' || s === 'range') {
    return s;
  }
  return null;
}

export function parseVehicleIdParam(raw: unknown): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function collectTripYmds(trips: Array<{ startTime: string }>): Set<string> {
  const out = new Set<string>();
  for (const t of trips) {
    const ymd = tripYmd(t.startTime);
    if (isYmd(ymd)) out.add(ymd);
  }
  return out;
}

export function filterTripsByHistory<T extends { startTime: string }>(
  trips: T[],
  opts: {
    filter: TripHistoryFilter;
    fillDate?: string | null;
    from?: string | null;
    to?: string | null;
    now?: Date;
  }
): T[] {
  const { filter, fillDate, from, to, now = new Date() } = opts;
  if (filter === 'today') {
    const ymd = toLocalYmd(now);
    return trips.filter((t) => tripStartedOnYmd(t.startTime, ymd));
  }
  if (filter === 'sinceFill' && fillDate) {
    return trips.filter((t) => tripAtOrAfter(t.startTime, fillDate));
  }
  if ((filter === 'date' || filter === 'range') && from) {
    const end = to || from;
    return trips.filter((t) => ymdInInclusiveRange(tripYmd(t.startTime), from, end));
  }
  return trips;
}

export function historyDateChipLabel(from: string | null, to: string | null): string {
  if (!from) return 'Date sélectionnée';
  const a = from.slice(8, 10) + '/' + from.slice(5, 7);
  if (!to || to === from) return a;
  const b = to.slice(8, 10) + '/' + to.slice(5, 7);
  return `${a} → ${b}`;
}
