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

/**
 * Litres à écrire sur la jauge.
 * Dépassement : on garde le niveau précédent (pas de plafond silencieux à la capacité).
 */
export function acceptedGaugeLiters(preview: FillFuelPreview, previous: number | null): number | null {
  if (preview.exceedsCapacity) return previous;
  return preview.afterLiters;
}

export type UnknownGaugeChoice = {
  liters: null;
  /** Pas un pourcentage : distinct d’une jauge confirmée (y compris 0 % ou 100 %). */
  percent: null;
  knowledge: 'unknown';
  forcedFull: false;
};

/**
 * « Je ne sais pas » (voiture récupérée, reprise plusieurs jours après).
 * Ne force jamais un plein : le niveau reste inconnu.
 */
export function unknownGaugeChoice(): UnknownGaugeChoice {
  return { liters: null, percent: null, knowledge: 'unknown', forcedFull: false };
}

/** Une jauge confirmée à la capacité (plein). Inconnu → faux. */
export function gaugeDisplaysConfirmedFull(
  liters: number | null,
  tankCapacity: number
): boolean {
  if (liters == null || !(tankCapacity > 0)) return false;
  return liters >= tankCapacity - 0.05;
}
