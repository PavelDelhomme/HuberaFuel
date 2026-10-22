export type CabinComfort = {
  ac: boolean;
  heat: boolean;
  deg: number;
};

let cabin: CabinComfort = { ac: false, heat: false, deg: 20 };
const listeners = new Set<() => void>();

export function getCabinComfort(): CabinComfort {
  return cabin;
}

export function subscribeCabinComfort(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setCabinComfort(next: Partial<CabinComfort>) {
  const deg = Number.isFinite(Number(next.deg))
    ? Math.max(-10, Math.min(40, Math.round(Number(next.deg))))
    : cabin.deg;
  let ac = next.ac == null ? cabin.ac : !!next.ac;
  let heat = next.heat == null ? cabin.heat : !!next.heat;
  if (next.ac === true) heat = false;
  if (next.heat === true) ac = false;
  cabin = { ac, heat, deg };
  listeners.forEach((fn) => fn());
}

/** Clim, chauffage, température extrême. 1 = aucun ajout. */
export function cabinComfortFactor(p: CabinComfort = cabin): number {
  let f = 1;
  if (p.ac) f += 0.08;
  if (p.heat) f += 0.06;
  if (p.deg < 5) f += 0.05;
  if (p.deg > 28) f += 0.04;
  return Math.round(f * 100) / 100;
}
