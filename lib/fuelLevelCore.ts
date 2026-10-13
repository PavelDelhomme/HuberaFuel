/** Aperçu jauge après plein — sans sqlite (tests). */

export type FillFuelPreview = {
  beforeLiters: number | null;
  afterLiters: number;
  mode: 'full' | 'add' | 'replace_unknown' | 'overflow';
  summary: string;
  exceedsCapacity: boolean;
  neededCapacity: number;
};

type VehicleLite = {
  tankCapacity: number;
  estimatedFuelLiters: number | null;
  name?: string;
};

type FillLite = { liters: number; isFull: boolean };

/**
 * Aperçu avant enregistrement :
 * - plein complet (confirmé) → réservoir = capacité
 * - partiel + niveau connu → reste + litres ajoutés (pas de clamp silencieux à 100 %)
 * - partiel + niveau inconnu → seulement les litres saisis
 */
export function previewFillUpFuel(
  vehicle: VehicleLite,
  fill: FillLite,
  opts?: { ignorePrevious?: boolean }
): FillFuelPreview {
  const tank = vehicle.tankCapacity;
  const before = opts?.ignorePrevious ? null : vehicle.estimatedFuelLiters;
  const cap = (n: number) => Math.round(n * 10) / 10;
  if (fill.isFull) {
    return {
      beforeLiters: before,
      afterLiters: tank,
      mode: 'full',
      summary:
        before != null
          ? `Avant ~${before.toFixed(1)} L → plein = ${tank} L (capacité)`
          : `Plein complet → ${tank} L (capacité du réservoir)`,
      exceedsCapacity: false,
      neededCapacity: tank,
    };
  }
  if (before != null) {
    const after = cap(before + fill.liters);
    const exceeds = after > tank + 0.05;
    return {
      beforeLiters: before,
      afterLiters: after,
      mode: exceeds ? 'overflow' : 'add',
      summary: exceeds
        ? `Avant ~${before.toFixed(1)} L + ${fill.liters.toFixed(1)} L → ~${after.toFixed(1)} L (dépasse ${tank} L)`
        : `Avant ~${before.toFixed(1)} L + ${fill.liters.toFixed(1)} L → ~${after.toFixed(1)} L`,
      exceedsCapacity: exceeds,
      neededCapacity: exceeds ? cap(after) : tank,
    };
  }
  const after = cap(fill.liters);
  const exceeds = after > tank + 0.05;
  return {
    beforeLiters: null,
    afterLiters: after,
    mode: exceeds ? 'overflow' : 'replace_unknown',
    summary: exceeds
      ? `${fill.liters.toFixed(1)} L dépasse la capacité enregistrée (${tank} L)`
      : `Niveau inconnu → estime ~${after.toFixed(1)} L (litres de ce plein seulement)`,
    exceedsCapacity: exceeds,
    neededCapacity: exceeds ? cap(after) : tank,
  };
}
