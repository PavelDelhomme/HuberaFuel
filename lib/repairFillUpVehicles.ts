import {
  getBudgets,
  getFillUps,
  getTrips,
  getVehicles,
  updateBudget,
  updateFillUp,
  updateVehicle,
  createFillUp,
  deactivateVehicleScopedBudgets,
} from '@/lib/database';
import { litersFromTicket } from '@/lib/fuelPrices';
import { hasMatchingFillUp, INTERMARCHE_GUERCHE_FILL } from '@/lib/intermarcheFillUp';
import { recomputeFuelFromLastFill } from '@/lib/fuelLevel';

/** Gazole TotalEnergies Thorigné-Fouillard (open data ~2,250 €/L, maj août 2026). */
export const TOTAL_THORIGNE_GAZOLE_EUR = 2.25;

/**
 * Tickets diesel Total Thorigné : montants payés exacts → litres recalculés au vrai prix/L.
 * (Les saisies avaient dérivé litres depuis defaultFuelPrice 1,72 € — irréaliste.)
 * Note : le 02/09 70,04 € est un plein **essence 206**, pas diesel 806.
 */
const DIESEL_TICKETS: { totalCost: number; day: string }[] = [
  { totalCost: 104.03, day: '2026-08-25' },
  { totalCost: 78.37, day: '2026-08-18' },
  { totalCost: 76.39, day: '2026-08-12' }, // Touran — même station
];

/** Tickets essence Total Thorigné (206). */
const ESSENCE_TICKETS: { totalCost: number; day: string }[] = [
  { totalCost: 70.04, day: '2026-09-02' },
];

function almostEq(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps;
}

/**
 * Corrige associations plein↔véhicule, prix/litres diesel Total, niveaux réservoir,
 * prix défaut véhicules diesel, enveloppe budget globale 250 €.
 * Idempotent.
 */
export async function repairFillUpVehiclesAndBudgets(): Promise<{
  fillUpsFixed: number;
  budgetsFixed: number;
  pricesFixed: number;
  levelsFixed: number;
}> {
  const vehicles = await getVehicles();
  const v806 = vehicles.find(
    (v) => /806/.test(v.name) || /806/.test(v.model || '') || /806/.test(v.brand || '')
  );
  const touran = vehicles.find(
    (v) => /touran/i.test(v.name) || /touran/i.test(v.model || '') || /touran/i.test(v.brand || '')
  );
  const is206 = (v: { name?: string; model?: string; brand?: string }) =>
    /206/.test(v.name || '') || /206/.test(v.model || '') || /206/.test(v.brand || '');
  const isGrey206 = (v: { name?: string; model?: string }) =>
    /gris/i.test(`${v.name || ''} ${v.model || ''}`);
  // Deux 206 dans le garage : les tickets historiques (août / 2 sept.) sont ceux
  // de la 2003, pas de la grise ajoutée ensuite. Ne pas prendre « la première »
  // selon isActive, sinon activer la grise déplace ces pleins.
  const v206 =
    vehicles.find((v) => is206(v) && Number(v.year) === 2003 && !isGrey206(v)) ||
    vehicles.find((v) => is206(v) && !isGrey206(v)) ||
    vehicles.find((v) => is206(v));

  let fillUpsFixed = 0;
  let pricesFixed = 0;
  let levelsFixed = 0;

  if (v806 || touran || v206) {
    const fills = await getFillUps();
    for (const f of fills) {
      const day = String(f.date).slice(0, 10);
      let nextId: number | null = null;
      let nextNote: string | undefined;
      // 02/09 70,04 € → 206 essence (corrigé : n’était pas le 806 diesel)
      if (v206 && day === '2026-09-02' && almostEq(f.totalCost, 70.04)) {
        nextId = v206.id;
      } else if (v806 && (day === '2026-08-25' || day === '2026-08-18')) {
        nextId = v806.id;
      } else if (touran && day === '2026-08-12') {
        nextId = touran.id;
        nextNote = 'Plein diesel — Touran (Total Thorigné)';
      } else if (v206 && day === '2026-08-20') {
        nextId = v206.id;
      }
      if (nextId != null && f.vehicleId !== nextId) {
        await updateFillUp(f.id, {
          vehicleId: nextId,
          ...(nextNote ? { note: nextNote } : {}),
        });
        fillUpsFixed += 1;
      } else if (nextNote && f.note !== nextNote && nextId != null && f.vehicleId === nextId) {
        await updateFillUp(f.id, { note: nextNote });
      }
    }
  }

  // Prix/L + litres : tickets diesel Total Thorigné
  let fills = await getFillUps();
  for (const f of fills) {
    const day = String(f.date).slice(0, 10);
    const ticket = DIESEL_TICKETS.find(
      (t) => t.day === day && almostEq(f.totalCost, t.totalCost)
    );
    if (!ticket) continue;

    const ppl = TOTAL_THORIGNE_GAZOLE_EUR;
    const liters = litersFromTicket(f.totalCost, ppl);
    if (almostEq(f.pricePerLiter, ppl) && almostEq(f.liters, liters)) continue;

    const noteBase =
      day === '2026-08-12'
        ? 'Plein diesel — Touran (Total Thorigné)'
        : `Plein diesel ${f.totalCost.toFixed(2).replace('.', ',')} € — Total Thorigné`;
    const note = `${noteBase} · ${ppl.toFixed(2).replace('.', ',')} €/L · ${liters
      .toFixed(2)
      .replace('.', ',')} L`;

    await updateFillUp(f.id, {
      pricePerLiter: ppl,
      liters,
      note,
    });
    pricesFixed += 1;
  }

  // Tickets essence 206 Total Thorigné
  fills = await getFillUps();
  for (const f of fills) {
    const day = String(f.date).slice(0, 10);
    const ticket = ESSENCE_TICKETS.find(
      (t) => t.day === day && almostEq(f.totalCost, t.totalCost)
    );
    if (!ticket || !v206 || f.vehicleId !== v206.id) continue;

    const ppl =
      v206.defaultFuelPrice > 0.7 && v206.defaultFuelPrice < 3.5
        ? v206.defaultFuelPrice
        : 1.79;
    const liters = litersFromTicket(f.totalCost, ppl);
    const note = `Plein essence ${f.totalCost.toFixed(2).replace('.', ',')} € — Total Thorigné · ${ppl
      .toFixed(2)
      .replace('.', ',')} €/L · ${liters.toFixed(2).replace('.', ',')} L`;

    const distPatch: { distanceSinceLastKm?: number } = {};
    // Distance depuis le plein 206 précédent (20/08) via trajets GPS
    try {
      const trips = await getTrips(v206.id);
      const prevFill = fills
        .filter(
          (x) =>
            x.vehicleId === v206.id &&
            x.id !== f.id &&
            String(x.date) < String(f.date)
        )
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      const from = prevFill ? String(prevFill.date) : '2026-08-20';
      const to = String(f.date);
      const km = trips
        .filter(
          (t) =>
            t.status !== 'rejected' &&
            String(t.startTime) >= from &&
            String(t.startTime) < to
        )
        .reduce((s, t) => s + (t.distanceKm || 0), 0);
      if (km > 1) {
        const implied = liters > 0 ? (liters / km) * 100 : 0;
        // Ne pas coller des km GPS partiels qui donnent une conso absurde (ex. 113 L/100)
        if (implied <= 0 || (implied >= 3 && implied <= 18)) {
          distPatch.distanceSinceLastKm = Math.round(km * 10) / 10;
        }
      }
    } catch {
      /* ignore */
    }

    if (
      almostEq(f.pricePerLiter, ppl) &&
      almostEq(f.liters, liters) &&
      (f.note || '') === note &&
      (distPatch.distanceSinceLastKm == null ||
        almostEq(f.distanceSinceLastKm ?? 0, distPatch.distanceSinceLastKm))
    ) {
      continue;
    }

    await updateFillUp(f.id, {
      pricePerLiter: ppl,
      liters,
      note,
      isFull: true,
      ...distPatch,
    });
    pricesFixed += 1;
  }

  // Plein 206 Intermarché La Guerche 12/09 (saisie utilisateur, idempotent)
  if (v206) {
    fills = await getFillUps();
    if (!hasMatchingFillUp(fills, v206.id, INTERMARCHE_GUERCHE_FILL)) {
      const spec = INTERMARCHE_GUERCHE_FILL;
      const prev = fills
        .filter((f) => f.vehicleId === v206.id)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      let distanceSinceLastKm: number | null = null;
      try {
        const trips = await getTrips(v206.id);
        const from = prev?.date || '';
        const km = trips
          .filter(
            (t) =>
              t.status !== 'rejected' &&
              (!from || String(t.startTime) >= from) &&
              String(t.startTime).slice(0, 10) <= spec.day
          )
          .reduce((s, t) => s + (t.distanceKm || 0), 0);
        if (km > 0.5) distanceSinceLastKm = Math.round(km * 10) / 10;
      } catch {
        /* ignore */
      }
      await createFillUp({
        vehicleId: v206.id,
        date: `${spec.day}T12:50:00+02:00`,
        liters: spec.liters,
        pricePerLiter: spec.pricePerLiter,
        totalCost: spec.totalCost,
        odometer: v206.hasOdometer ? v206.currentOdometer : null,
        distanceSinceLastKm,
        isFull: true,
        note: `Plein ${spec.stationName} — ${spec.liters.toFixed(2)} L · ${spec.totalCost.toFixed(2)} €`,
        tripId: null,
      });
      fillUpsFixed += 1;
      await updateVehicle(v206.id, {
        estimatedFuelLiters: v206.tankCapacity,
        defaultFuelPrice: spec.pricePerLiter,
      });
      levelsFixed += 1;
    }
  }

  // Prix défaut diesel — NE PLUS forcer estimatedFuelLiters = capacité
  // (ça créait des « plein fantômes » après chaque sync/refresh).
  fills = await getFillUps();
  for (const v of vehicles) {
    if (v.fuelType !== 'diesel') continue;
    if (!almostEq(v.defaultFuelPrice, TOTAL_THORIGNE_GAZOLE_EUR, 0.01)) {
      await updateVehicle(v.id, { defaultFuelPrice: TOTAL_THORIGNE_GAZOLE_EUR });
      levelsFixed += 1;
    }
  }

  // Tous véhicules : corriger seulement jauge inconnue ou « plein fantôme »
  // (ne jamais remonter un niveau déjà ajusté / brûlé).
  try {
    for (const v of vehicles) {
      if (v.fuelType === 'electrique') continue;
      const before = v.estimatedFuelLiters;
      const phantomFull =
        before != null && almostEq(before, v.tankCapacity, 1.0);
      if (before != null && !phantomFull) continue;
      const next = await recomputeFuelFromLastFill(v.id);
      if (next != null && (before == null || !almostEq(before, next, 0.15))) {
        levelsFixed += 1;
      }
    }
  } catch {
    /* ignore */
  }

  let budgetsFixed = await deactivateVehicleScopedBudgets();
  const budgets = await getBudgets();
  for (const b of budgets) {
    if (b.vehicleId == null && b.period === 'monthly') {
      if (b.amount !== 250 || b.name !== 'Carburant total') {
        await updateBudget(b.id, { amount: 250, name: 'Carburant total' });
        budgetsFixed += 1;
      }
    }
  }

  return { fillUpsFixed, budgetsFixed, pricesFixed, levelsFixed };
}
