/**
 * Garde une correction d'attribution véhicule face à un téléphone
 * qui renvoie encore l'ancien snapshot (autre 206 active, trajets inclus).
 * Le fichier /data/vehicle-attribution-keep.json borne le comportement
 * à un compte et à des ids précis. Sans fichier, la sync est inchangée.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function findVehicle(data, id) {
  return (data.vehicles || []).find((v) => Number(v.id) === Number(id)) || null;
}

function newestTripVehicleId(data) {
  let bestId = null;
  let bestMs = 0;
  for (const t of data.trips || []) {
    if (t.status === 'rejected') continue;
    const ms = Date.parse(t.endTime || t.startTime || '') || 0;
    if (ms > bestMs) {
      bestMs = ms;
      bestId = num(t.vehicleId);
    }
  }
  return bestId;
}

function hasFillOn(data, vehicleId, sinceIso) {
  return (data.fillUps || []).some((f) => {
    if (Number(f.vehicleId) !== Number(vehicleId)) return false;
    if (!sinceIso) return true;
    return String(f.date || '') >= sinceIso;
  });
}

/**
 * @param {object} data payload sync entrant (muté)
 * @param {object|null} keep
 * @param {number} [nowMs]
 */
export function applyAttributionKeep(data, keep, nowMs = Date.now()) {
  const notes = [];
  if (!data || !keep || typeof keep !== 'object') return { changed: false, notes };
  let changed = false;

  const tripVehicle = keep.tripVehicle || {};
  const lockedIds = new Set(Object.keys(tripVehicle).map((id) => Number(id)));
  for (const t of data.trips || []) {
    const want = tripVehicle[String(t.id)];
    if (want == null) continue;
    if (Number(t.vehicleId) !== Number(want)) {
      notes.push({ kind: 'trip', id: t.id, from: t.vehicleId, to: Number(want) });
      t.vehicleId = Number(want);
      changed = true;
    }
  }

  const gaugeVehicle = keep.gaugeVehicle || {};
  const gaugeOdo = keep.gaugeOdometer || {};
  for (const g of data.gaugeReadings || []) {
    const want = gaugeVehicle[String(g.id)];
    if (want != null && Number(g.vehicleId) !== Number(want)) {
      notes.push({ kind: 'gauge', id: g.id, from: g.vehicleId, to: Number(want) });
      g.vehicleId = Number(want);
      changed = true;
    }
    const odo = gaugeOdo[String(g.id)];
    if (odo != null && Number(g.odometer) > 10000 && Math.abs(Number(g.odometer) - Number(odo)) > 1) {
      notes.push({ kind: 'gauge-odo', id: g.id, from: g.odometer, to: Number(odo) });
      g.odometer = Number(odo);
      changed = true;
    }
  }

  const fillVehicle = keep.fillVehicle || {};
  for (const f of data.fillUps || []) {
    const want = fillVehicle[String(f.id)];
    if (want == null) continue;
    if (Number(f.vehicleId) !== Number(want)) {
      notes.push({ kind: 'fill', id: f.id, from: f.vehicleId, to: Number(want) });
      f.vehicleId = Number(want);
      changed = true;
    }
  }

  const activeId = num(keep.activeVehicleId);
  const staleId = num(keep.staleVehicleId);
  const until = Date.parse(keep.reassignNewTripsUntil || '') || 0;
  const stale = staleId != null ? findVehicle(data, staleId) : null;
  const active = activeId != null ? findVehicle(data, activeId) : null;
  const inverted =
    !!stale &&
    !!active &&
    Number(stale.estimatedFuelLiters) < 12 &&
    Number(active.estimatedFuelLiters) > 15 &&
    Number(stale.estimatedFuelLiters) + 0.4 < Number(active.estimatedFuelLiters);

  const since = keep.fillsSince || '2026-10-15T00:00:00.000Z';
  const staleFilled = staleId != null && hasFillOn(data, staleId, since);

  if (inverted && !staleFilled && keep.corrected) {
    for (const spec of keep.corrected) {
      const v = findVehicle(data, spec.id);
      if (!v) continue;
      if (spec.estimatedFuelLiters != null) v.estimatedFuelLiters = spec.estimatedFuelLiters;
      if (spec.trackedKm != null) v.trackedKm = spec.trackedKm;
      if (spec.isActive != null) v.isActive = spec.isActive;
      changed = true;
      notes.push({ kind: 'levels', id: v.id, liters: v.estimatedFuelLiters, trackedKm: v.trackedKm });
    }
  }

  if (until > nowMs && activeId != null && staleId != null && !staleFilled) {
    for (const t of data.trips || []) {
      if (lockedIds.has(Number(t.id))) continue;
      if (Number(t.vehicleId) !== staleId) continue;
      const km = t.status === 'rejected' ? 0 : Number(t.distanceKm) || 0;
      const fuel = t.status === 'rejected' ? 0 : Number(t.estimatedFuelUsed) || 0;
      t.vehicleId = activeId;
      changed = true;
      notes.push({ kind: 'new-trip', id: t.id, from: staleId, to: activeId, km, fuel });
      if (stale) {
        stale.trackedKm = Math.max(0, Math.round(((Number(stale.trackedKm) || 0) - km) * 10) / 10);
        if (stale.estimatedFuelLiters != null) {
          const cap = Number(stale.tankCapacity) || 999;
          stale.estimatedFuelLiters = Math.min(
            cap,
            Math.round((Number(stale.estimatedFuelLiters) + fuel) * 10) / 10
          );
        }
      }
      if (active) {
        active.trackedKm = Math.round(((Number(active.trackedKm) || 0) + km) * 10) / 10;
        if (active.estimatedFuelLiters != null) {
          active.estimatedFuelLiters = Math.max(
            0,
            Math.round((Number(active.estimatedFuelLiters) - fuel) * 10) / 10
          );
        }
      }
      for (const g of data.gaugeReadings || []) {
        if (Number(g.tripId) === Number(t.id) && Number(g.vehicleId) === staleId) {
          g.vehicleId = activeId;
        }
      }
    }
  }

  const newest = newestTripVehicleId(data);
  if (activeId != null && newest === activeId) {
    for (const v of data.vehicles || []) {
      const next = Number(v.id) === activeId;
      if (Boolean(v.isActive) !== next) {
        v.isActive = next;
        changed = true;
        notes.push({ kind: 'active', id: v.id, isActive: next });
      }
    }
  }

  return { changed, notes };
}
