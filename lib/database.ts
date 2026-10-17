import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Budget,
  FillUp,
  FuelGaugeReading,
  FuelGaugeSource,
  Place,
  PlaceKind,
  RecurringRoute,
  Trip,
  Vehicle,
  VehicleMaintenance,
} from '@/types';
import { refreshMaintenanceStatus } from '@/lib/vehicleMaintenance';
import {
  LAST_VEHICLE_STORAGE_KEY,
  MAPS_FUEL_VEHICLE_KEY,
  firstStoredVehicleRaw,
  parseStoredVehicleId,
  resolveActiveVehicleId,
} from '@/lib/lastVehicle';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('gasoil_tracking.db');
    await initDatabase(db);
  }
  return db;
}

async function initDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      year INTEGER NOT NULL,
      fuel_type TEXT NOT NULL DEFAULT 'diesel',
      consumption_per_100 REAL NOT NULL DEFAULT 6.0,
      tank_capacity REAL NOT NULL DEFAULT 50,
      default_fuel_price REAL NOT NULL DEFAULT 1.75,
      current_odometer REAL NOT NULL DEFAULT 0,
      has_odometer INTEGER NOT NULL DEFAULT 1,
      tracked_km REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fill_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      liters REAL NOT NULL,
      price_per_liter REAL NOT NULL,
      total_cost REAL NOT NULL,
      odometer REAL,
      distance_since_last_km REAL,
      is_full INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      trip_id INTEGER,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      spent REAL NOT NULL DEFAULT 0,
      period TEXT NOT NULL DEFAULT 'monthly',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      distance_km REAL NOT NULL DEFAULT 0,
      estimated_fuel_used REAL NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      route_points TEXT NOT NULL DEFAULT '[]',
      origin_name TEXT,
      destination_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed',
      source TEXT NOT NULL DEFAULT 'gps',
      fill_up_id INTEGER,
      note TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'other',
      latitude REAL,
      longitude REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recurring_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER,
      name TEXT NOT NULL,
      from_place_id INTEGER NOT NULL,
      to_place_id INTEGER NOT NULL,
      distance_km REAL NOT NULL DEFAULT 0,
      times_per_week REAL NOT NULL DEFAULT 5,
      work_days_per_week REAL NOT NULL DEFAULT 5,
      is_on_vacation INTEGER NOT NULL DEFAULT 0,
      vacation_until TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (from_place_id) REFERENCES places(id) ON DELETE CASCADE,
      FOREIGN KEY (to_place_id) REFERENCES places(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vehicle_maintenances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      amount REAL,
      done_at TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fuel_gauge_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      liters REAL NOT NULL,
      tank_capacity REAL NOT NULL,
      source TEXT NOT NULL,
      trip_id INTEGER,
      fill_up_id INTEGER,
      odometer REAL
    );
    CREATE INDEX IF NOT EXISTS idx_gauge_vehicle_at ON fuel_gauge_readings(vehicle_id, recorded_at);
  `);

  // Migrations douces (anciennes bases)
  const alterSafe = async (sql: string) => {
    try {
      await database.execAsync(sql);
    } catch {
      /* colonne déjà présente */
    }
  };
  await alterSafe('ALTER TABLE vehicles ADD COLUMN has_odometer INTEGER NOT NULL DEFAULT 1');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN tracked_km REAL NOT NULL DEFAULT 0');
  await alterSafe('ALTER TABLE fill_ups ADD COLUMN distance_since_last_km REAL');
  await alterSafe('ALTER TABLE fill_ups ADD COLUMN trip_id INTEGER');
  await alterSafe('ALTER TABLE trips ADD COLUMN origin_name TEXT');
  await alterSafe("ALTER TABLE trips ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'");
  await alterSafe("ALTER TABLE trips ADD COLUMN source TEXT NOT NULL DEFAULT 'gps'");
  await alterSafe('ALTER TABLE trips ADD COLUMN fill_up_id INTEGER');
  await alterSafe('ALTER TABLE trips ADD COLUMN note TEXT');
  await alterSafe('ALTER TABLE trips ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0');
  await alterSafe('ALTER TABLE recurring_routes ADD COLUMN work_days_per_week REAL NOT NULL DEFAULT 5');
  await alterSafe('ALTER TABLE recurring_routes ADD COLUMN is_on_vacation INTEGER NOT NULL DEFAULT 0');
  await alterSafe('ALTER TABLE recurring_routes ADD COLUMN vacation_until TEXT');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN estimated_fuel_liters REAL');
  await alterSafe(
    'ALTER TABLE vehicles ADD COLUMN consumption_auto_adapt INTEGER NOT NULL DEFAULT 1'
  );
  await alterSafe('ALTER TABLE vehicles ADD COLUMN notify_maintenance INTEGER NOT NULL DEFAULT 1');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN notify_low_fuel INTEGER NOT NULL DEFAULT 0');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN low_fuel_threshold_liters REAL');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN consumption_learn_factor REAL NOT NULL DEFAULT 1');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN transmission_gears INTEGER');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN curb_weight_kg REAL');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN drag_area_scx REAL');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN vehicle_segment TEXT');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN payload_kg REAL');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN maintenance_up_to_date INTEGER');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN maintenance_checklist TEXT');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN plate_number TEXT');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN vin TEXT');
  await alterSafe('ALTER TABLE vehicles ADD COLUMN registration_photo_uri TEXT');
  await alterSafe('ALTER TABLE vehicle_maintenances ADD COLUMN photo_uri TEXT');
  await alterSafe('ALTER TABLE vehicle_maintenances ADD COLUMN due_odometer REAL');
  await alterSafe('ALTER TABLE places ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
}

function mapVehicle(row: unknown): Vehicle {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    name: r.name as string,
    brand: r.brand as string,
    model: r.model as string,
    year: r.year as number,
    fuelType: r.fuel_type as Vehicle['fuelType'],
    consumptionPer100: r.consumption_per_100 as number,
    tankCapacity: r.tank_capacity as number,
    defaultFuelPrice: r.default_fuel_price as number,
    currentOdometer: r.current_odometer as number,
    hasOdometer: r.has_odometer === undefined ? true : Boolean(r.has_odometer),
    trackedKm: (r.tracked_km as number) ?? 0,
    estimatedFuelLiters:
      r.estimated_fuel_liters === null || r.estimated_fuel_liters === undefined
        ? null
        : (r.estimated_fuel_liters as number),
    consumptionAutoAdapt:
      r.consumption_auto_adapt === undefined || r.consumption_auto_adapt === null
        ? true
        : Boolean(r.consumption_auto_adapt),
    notifyMaintenance:
      r.notify_maintenance === undefined || r.notify_maintenance === null
        ? true
        : Boolean(r.notify_maintenance),
    notifyLowFuel: Boolean(r.notify_low_fuel),
    lowFuelThresholdLiters:
      r.low_fuel_threshold_liters === null || r.low_fuel_threshold_liters === undefined
        ? null
        : (r.low_fuel_threshold_liters as number),
    consumptionLearnFactor:
      r.consumption_learn_factor === null || r.consumption_learn_factor === undefined
        ? 1
        : (r.consumption_learn_factor as number),
    transmissionGears:
      r.transmission_gears === null || r.transmission_gears === undefined
        ? null
        : (r.transmission_gears as number),
    curbWeightKg:
      r.curb_weight_kg === null || r.curb_weight_kg === undefined
        ? null
        : (r.curb_weight_kg as number),
    dragAreaScx:
      r.drag_area_scx === null || r.drag_area_scx === undefined
        ? null
        : (r.drag_area_scx as number),
    vehicleSegment:
      r.vehicle_segment === null || r.vehicle_segment === undefined
        ? null
        : (r.vehicle_segment as Vehicle['vehicleSegment']),
    payloadKg:
      r.payload_kg === null || r.payload_kg === undefined
        ? null
        : (r.payload_kg as number),
    maintenanceUpToDate:
      r.maintenance_up_to_date === null || r.maintenance_up_to_date === undefined
        ? null
        : Boolean(r.maintenance_up_to_date),
    maintenanceChecklist: (() => {
      const raw = r.maintenance_checklist as string | null | undefined;
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as Record<string, boolean>;
      } catch {
        return undefined;
      }
    })(),
    plateNumber:
      r.plate_number === null || r.plate_number === undefined
        ? null
        : String(r.plate_number),
    vin: r.vin === null || r.vin === undefined ? null : String(r.vin),
    registrationPhotoUri:
      r.registration_photo_uri === null || r.registration_photo_uri === undefined
        ? null
        : String(r.registration_photo_uri),
    isActive: Boolean(r.is_active),
    createdAt: r.created_at as string,
  };
}

function mapMaintenance(row: unknown, currentOdometer?: number | null): VehicleMaintenance {
  const r = row as Record<string, unknown>;
  const base: VehicleMaintenance = {
    id: r.id as number,
    vehicleId: r.vehicle_id as number,
    kind: r.kind as VehicleMaintenance['kind'],
    title: r.title as string,
    amount: r.amount === null || r.amount === undefined ? null : (r.amount as number),
    doneAt: (r.done_at as string) || null,
    dueDate: (r.due_date as string) || null,
    status: (r.status as VehicleMaintenance['status']) || 'pending',
    note: (r.note as string) || undefined,
    photoUri:
      r.photo_uri === null || r.photo_uri === undefined ? null : String(r.photo_uri),
    dueOdometer:
      r.due_odometer === null || r.due_odometer === undefined
        ? null
        : Number(r.due_odometer),
    createdAt: (r.created_at as string) || new Date().toISOString(),
  };
  return { ...base, status: refreshMaintenanceStatus(base, currentOdometer) };
}

/** Compteur affiché sans importer calculations (évite cycle). */
function vehicleDisplayOdo(row: { current_odometer?: unknown; tracked_km?: unknown }): number {
  return Math.round((Number(row.current_odometer) || 0) + (Number(row.tracked_km) || 0));
}

function mapFillUp(row: unknown): FillUp {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    vehicleId: r.vehicle_id as number,
    date: r.date as string,
    liters: r.liters as number,
    pricePerLiter: r.price_per_liter as number,
    totalCost: r.total_cost as number,
    odometer: r.odometer === null || r.odometer === undefined ? null : (r.odometer as number),
    distanceSinceLastKm:
      r.distance_since_last_km === null || r.distance_since_last_km === undefined
        ? null
        : (r.distance_since_last_km as number),
    isFull: Boolean(r.is_full),
    note: r.note as string | undefined,
    tripId: r.trip_id === null || r.trip_id === undefined ? null : (r.trip_id as number),
  };
}

export async function getMaintenances(vehicleId?: number): Promise<VehicleMaintenance[]> {
  const database = await getDatabase();
  const rows = vehicleId
    ? await database.getAllAsync(
        'SELECT * FROM vehicle_maintenances WHERE vehicle_id = ? ORDER BY COALESCE(due_date, done_at, created_at) DESC',
        [vehicleId]
      )
    : await database.getAllAsync(
        'SELECT * FROM vehicle_maintenances ORDER BY COALESCE(due_date, done_at, created_at) DESC'
      );
  const vehicles = await database.getAllAsync(
    'SELECT id, current_odometer, tracked_km FROM vehicles'
  );
  const odoById = new Map<number, number>();
  for (const v of vehicles || []) {
    const r = v as { id: number; current_odometer?: unknown; tracked_km?: unknown };
    odoById.set(r.id, vehicleDisplayOdo(r));
  }
  return (rows || []).map((row) => {
    const r = row as { vehicle_id: number };
    return mapMaintenance(row, odoById.get(r.vehicle_id) ?? null);
  });
}

export async function createMaintenance(
  m: Omit<VehicleMaintenance, 'id' | 'createdAt'>
): Promise<number> {
  const database = await getDatabase();
  const vrow = await database.getFirstAsync(
    'SELECT current_odometer, tracked_km FROM vehicles WHERE id = ?',
    [m.vehicleId]
  );
  const odo = vrow
    ? vehicleDisplayOdo(vrow as { current_odometer?: unknown; tracked_km?: unknown })
    : null;
  const status = refreshMaintenanceStatus(
    {
      ...m,
      id: 0,
      createdAt: new Date().toISOString(),
    },
    odo
  );
  const result = await database.runAsync(
    `INSERT INTO vehicle_maintenances (vehicle_id, kind, title, amount, done_at, due_date, status, note, photo_uri, due_odometer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      m.vehicleId,
      m.kind,
      m.title,
      m.amount,
      m.doneAt,
      m.dueDate,
      status,
      m.note ?? null,
      m.photoUri ?? null,
      m.dueOdometer ?? null,
    ]
  );
  return Number(result.lastInsertRowId);
}

export async function updateMaintenance(
  id: number,
  patch: Partial<VehicleMaintenance>
): Promise<void> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.kind !== undefined) {
    fields.push('kind = ?');
    values.push(patch.kind);
  }
  if (patch.title !== undefined) {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (patch.amount !== undefined) {
    fields.push('amount = ?');
    values.push(patch.amount);
  }
  if (patch.doneAt !== undefined) {
    fields.push('done_at = ?');
    values.push(patch.doneAt);
  }
  if (patch.dueDate !== undefined) {
    fields.push('due_date = ?');
    values.push(patch.dueDate);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.note !== undefined) {
    fields.push('note = ?');
    values.push(patch.note ?? null);
  }
  if (patch.photoUri !== undefined) {
    fields.push('photo_uri = ?');
    values.push(patch.photoUri ?? null);
  }
  if (patch.dueOdometer !== undefined) {
    fields.push('due_odometer = ?');
    values.push(patch.dueOdometer ?? null);
  }
  if (!fields.length) return;
  values.push(id);
  await database.runAsync(`UPDATE vehicle_maintenances SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteMaintenance(id: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM vehicle_maintenances WHERE id = ?', [id]);
}

function mapBudget(row: unknown): Budget {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    vehicleId: r.vehicle_id as number | null,
    name: r.name as string,
    amount: r.amount as number,
    spent: r.spent as number,
    period: r.period as Budget['period'],
    startDate: r.start_date as string,
    endDate: r.end_date as string,
    isActive: Boolean(r.is_active),
  };
}

function mapTrip(row: unknown): Trip {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    vehicleId: r.vehicle_id as number,
    startTime: r.start_time as string,
    endTime: r.end_time as string | null,
    distanceKm: r.distance_km as number,
    estimatedFuelUsed: r.estimated_fuel_used as number,
    estimatedCost: r.estimated_cost as number,
    routePoints: r.route_points as string,
    originName: (r.origin_name as string) || undefined,
    destinationName: r.destination_name as string | undefined,
    isActive: Boolean(r.is_active),
    isPaused: Boolean(r.is_paused),
    status: ((r.status as string) || 'confirmed') as Trip['status'],
    source: ((r.source as string) || 'gps') as Trip['source'],
    fillUpId: r.fill_up_id === null || r.fill_up_id === undefined ? null : (r.fill_up_id as number),
    note: (r.note as string) || undefined,
  };
}

// --- Vehicles ---

export async function getVehicles(): Promise<Vehicle[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync('SELECT * FROM vehicles ORDER BY is_active DESC, name ASC');
  return rows.map(mapVehicle);
}

export async function getActiveVehicle(): Promise<Vehicle | null> {
  const database = await getDatabase();
  const allIds = (
    await database.getAllAsync('SELECT id FROM vehicles')
  ).map((r) => Number((r as { id: number }).id));
  const activeRows = await database.getAllAsync('SELECT id FROM vehicles WHERE is_active = 1');
  const dbActiveIds = activeRows.map((r) => Number((r as { id: number }).id));
  const lastTripAtByVehicle: Record<number, number> = {};
  try {
    const tripRows = await database.getAllAsync(
      `SELECT vehicle_id AS id, MAX(COALESCE(end_time, start_time)) AS last_at
       FROM trips WHERE status IS NULL OR status != 'rejected' GROUP BY vehicle_id`
    );
    for (const r of tripRows as { id: number; last_at?: string | null }[]) {
      const ms = Date.parse(String(r.last_at || '')) || 0;
      if (r.id) lastTripAtByVehicle[Number(r.id)] = ms;
    }
  } catch {
    /* base ancienne */
  }
  let storedId: number | null = null;
  try {
    const primary = await AsyncStorage.getItem(LAST_VEHICLE_STORAGE_KEY);
    const shared = await AsyncStorage.getItem(MAPS_FUEL_VEHICLE_KEY);
    storedId = parseStoredVehicleId(firstStoredVehicleRaw(primary, shared));
  } catch {
    storedId = null;
  }
  const resolved = resolveActiveVehicleId({
    storedId,
    dbActiveIds,
    lastTripAtByVehicle,
    vehicleIds: allIds,
  });
  if (resolved != null) {
    const v = await getVehicleById(resolved);
    if (v) {
      await database.runAsync('UPDATE vehicles SET is_active = 0 WHERE id != ?', [resolved]);
      await database.runAsync('UPDATE vehicles SET is_active = 1 WHERE id = ?', [resolved]);
      try {
        await AsyncStorage.setItem(LAST_VEHICLE_STORAGE_KEY, String(resolved));
      } catch {
        /* ignore */
      }
      return { ...v, isActive: true };
    }
  }
  const rows = await database.getAllAsync('SELECT * FROM vehicles WHERE is_active = 1');
  if (rows.length === 1) {
    const v = mapVehicle(rows[0]);
    try {
      await AsyncStorage.setItem(LAST_VEHICLE_STORAGE_KEY, String(v.id));
    } catch {
      /* ignore */
    }
    return v;
  }
  const first = await database.getFirstAsync('SELECT * FROM vehicles ORDER BY id ASC LIMIT 1');
  if (first && rows.length === 0) {
    const v = mapVehicle(first);
    await database.runAsync('UPDATE vehicles SET is_active = 1 WHERE id = ?', [v.id]);
    return { ...v, isActive: true };
  }
  return rows.length === 1 ? mapVehicle(rows[0]) : null;
}

export async function getVehicleById(id: number): Promise<Vehicle | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync('SELECT * FROM vehicles WHERE id = ?', [id]);
  return row ? mapVehicle(row) : null;
}

export async function createVehicle(vehicle: Omit<Vehicle, 'id' | 'createdAt'>): Promise<number> {
  const database = await getDatabase();
  try {
    if (vehicle.isActive) {
      await database.runAsync('UPDATE vehicles SET is_active = 0');
    }
    const result = await database.runAsync(
      `INSERT INTO vehicles (name, brand, model, year, fuel_type, consumption_per_100, tank_capacity, default_fuel_price, current_odometer, has_odometer, tracked_km, estimated_fuel_liters, consumption_auto_adapt, notify_maintenance, notify_low_fuel, low_fuel_threshold_liters, consumption_learn_factor, transmission_gears, curb_weight_kg, drag_area_scx, vehicle_segment, payload_kg, is_active, plate_number, vin, registration_photo_uri)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vehicle.name,
        vehicle.brand,
        vehicle.model,
        vehicle.year,
        vehicle.fuelType,
        vehicle.consumptionPer100,
        vehicle.tankCapacity,
        vehicle.defaultFuelPrice,
        vehicle.currentOdometer,
        vehicle.hasOdometer ? 1 : 0,
        vehicle.trackedKm ?? 0,
        vehicle.estimatedFuelLiters ?? null,
        vehicle.consumptionAutoAdapt === false ? 0 : 1,
        vehicle.notifyMaintenance === false ? 0 : 1,
        vehicle.notifyLowFuel ? 1 : 0,
        vehicle.lowFuelThresholdLiters ?? null,
        vehicle.consumptionLearnFactor ?? 1,
        vehicle.transmissionGears ?? null,
        vehicle.curbWeightKg ?? null,
        vehicle.dragAreaScx ?? null,
        vehicle.vehicleSegment ?? null,
        vehicle.payloadKg ?? null,
        vehicle.isActive ? 1 : 0,
        vehicle.plateNumber ?? null,
        vehicle.vin ?? null,
        vehicle.registrationPhotoUri ?? null,
      ]
    );
    const id = Number(result.lastInsertRowId);
    if (!id) {
      // Fallback : relire le dernier véhicule
      const row = await database.getFirstAsync<{ id: number }>(
        'SELECT id FROM vehicles ORDER BY id DESC LIMIT 1'
      );
      if (!row?.id) throw new Error('INSERT OK mais id introuvable');
      return row.id;
    }
    return id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`SQLite createVehicle: ${msg}`);
  }
}

export async function updateVehicle(id: number, vehicle: Partial<Vehicle>): Promise<void> {
  const database = await getDatabase();
  if (vehicle.isActive) {
    await database.runAsync('UPDATE vehicles SET is_active = 0');
  }
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (vehicle.name !== undefined) { fields.push('name = ?'); values.push(vehicle.name); }
  if (vehicle.brand !== undefined) { fields.push('brand = ?'); values.push(vehicle.brand); }
  if (vehicle.model !== undefined) { fields.push('model = ?'); values.push(vehicle.model); }
  if (vehicle.year !== undefined) { fields.push('year = ?'); values.push(vehicle.year); }
  if (vehicle.fuelType !== undefined) { fields.push('fuel_type = ?'); values.push(vehicle.fuelType); }
  if (vehicle.consumptionPer100 !== undefined) { fields.push('consumption_per_100 = ?'); values.push(vehicle.consumptionPer100); }
  if (vehicle.tankCapacity !== undefined) { fields.push('tank_capacity = ?'); values.push(vehicle.tankCapacity); }
  if (vehicle.defaultFuelPrice !== undefined) { fields.push('default_fuel_price = ?'); values.push(vehicle.defaultFuelPrice); }
  if (vehicle.currentOdometer !== undefined) { fields.push('current_odometer = ?'); values.push(vehicle.currentOdometer); }
  if (vehicle.hasOdometer !== undefined) { fields.push('has_odometer = ?'); values.push(vehicle.hasOdometer ? 1 : 0); }
  if (vehicle.trackedKm !== undefined) { fields.push('tracked_km = ?'); values.push(vehicle.trackedKm); }
  if (vehicle.estimatedFuelLiters !== undefined) {
    fields.push('estimated_fuel_liters = ?');
    values.push(vehicle.estimatedFuelLiters);
  }
  if (vehicle.consumptionAutoAdapt !== undefined) {
    fields.push('consumption_auto_adapt = ?');
    values.push(vehicle.consumptionAutoAdapt ? 1 : 0);
  }
  if (vehicle.notifyMaintenance !== undefined) {
    fields.push('notify_maintenance = ?');
    values.push(vehicle.notifyMaintenance ? 1 : 0);
  }
  if (vehicle.notifyLowFuel !== undefined) {
    fields.push('notify_low_fuel = ?');
    values.push(vehicle.notifyLowFuel ? 1 : 0);
  }
  if (vehicle.lowFuelThresholdLiters !== undefined) {
    fields.push('low_fuel_threshold_liters = ?');
    values.push(vehicle.lowFuelThresholdLiters);
  }
  if (vehicle.consumptionLearnFactor !== undefined) {
    fields.push('consumption_learn_factor = ?');
    values.push(vehicle.consumptionLearnFactor);
  }
  if (vehicle.transmissionGears !== undefined) {
    fields.push('transmission_gears = ?');
    values.push(vehicle.transmissionGears);
  }
  if (vehicle.curbWeightKg !== undefined) {
    fields.push('curb_weight_kg = ?');
    values.push(vehicle.curbWeightKg);
  }
  if (vehicle.dragAreaScx !== undefined) {
    fields.push('drag_area_scx = ?');
    values.push(vehicle.dragAreaScx);
  }
  if (vehicle.vehicleSegment !== undefined) {
    fields.push('vehicle_segment = ?');
    values.push(vehicle.vehicleSegment);
  }
  if (vehicle.payloadKg !== undefined) {
    fields.push('payload_kg = ?');
    values.push(vehicle.payloadKg);
  }
  if (vehicle.maintenanceUpToDate !== undefined) {
    fields.push('maintenance_up_to_date = ?');
    values.push(
      vehicle.maintenanceUpToDate === null ? null : vehicle.maintenanceUpToDate ? 1 : 0
    );
  }
  if (vehicle.maintenanceChecklist !== undefined) {
    fields.push('maintenance_checklist = ?');
    values.push(JSON.stringify(vehicle.maintenanceChecklist ?? {}));
  }
  if (vehicle.plateNumber !== undefined) {
    fields.push('plate_number = ?');
    values.push(vehicle.plateNumber);
  }
  if (vehicle.vin !== undefined) {
    fields.push('vin = ?');
    values.push(vehicle.vin);
  }
  if (vehicle.registrationPhotoUri !== undefined) {
    fields.push('registration_photo_uri = ?');
    values.push(vehicle.registrationPhotoUri);
  }
  if (vehicle.isActive !== undefined) { fields.push('is_active = ?'); values.push(vehicle.isActive ? 1 : 0); }

  if (fields.length === 0) return;
  values.push(id);
  await database.runAsync(`UPDATE vehicles SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function addTrackedKm(vehicleId: number, km: number): Promise<void> {
  if (km <= 0) return;
  const database = await getDatabase();
  await database.runAsync(
    'UPDATE vehicles SET tracked_km = tracked_km + ? WHERE id = ?',
    [km, vehicleId]
  );
}

/** Aligne tracked_km sur les trajets depuis le dernier plein (pas toute l’historique). */
export async function reconcileTrackedKmFromTrips(vehicleId: number): Promise<number> {
  const [trips, fills] = await Promise.all([
    getTrips(vehicleId, { omitRoutePoints: true }),
    getFillUps(vehicleId),
  ]);
  const lastFill = fills[0] || null;
  const since = lastFill?.date || null;
  const sum = trips
    .filter((t) => !t.isActive && t.status !== 'rejected')
    .filter((t) => !since || t.startTime >= since)
    .reduce((acc, t) => acc + (Number(t.distanceKm) || 0), 0);
  const rounded = Math.round(sum * 10) / 10;
  const database = await getDatabase();
  await database.runAsync('UPDATE vehicles SET tracked_km = ? WHERE id = ?', [rounded, vehicleId]);
  return rounded;
}

export async function createFillUp(fillUp: Omit<FillUp, 'id'>): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync(
    `INSERT INTO fill_ups (vehicle_id, date, liters, price_per_liter, total_cost, odometer, distance_since_last_km, is_full, note, trip_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fillUp.vehicleId,
      fillUp.date,
      fillUp.liters,
      fillUp.pricePerLiter,
      fillUp.totalCost,
      fillUp.odometer,
      fillUp.distanceSinceLastKm,
      fillUp.isFull ? 1 : 0,
      fillUp.note ?? null,
      fillUp.tripId ?? null,
    ]
  );
  if (fillUp.odometer != null) {
    // odometer = compteur affiché (base + trajets). On fige la base et on remet
    // tracked_km à 0 sinon le prochain affichage double-compte les km GPS.
    await database.runAsync(
      'UPDATE vehicles SET current_odometer = ?, tracked_km = 0 WHERE id = ?',
      [fillUp.odometer, fillUp.vehicleId]
    );
  }
  if (fillUp.tripId) {
    await database.runAsync('UPDATE trips SET fill_up_id = ? WHERE id = ?', [
      result.lastInsertRowId,
      fillUp.tripId,
    ]);
  }
  return result.lastInsertRowId;
}

export async function deleteVehicle(id: number): Promise<void> {
  const database = await getDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM fill_ups WHERE vehicle_id = ?', [id]);
    await database.runAsync('DELETE FROM trips WHERE vehicle_id = ?', [id]);
    await database.runAsync('DELETE FROM fuel_gauge_readings WHERE vehicle_id = ?', [id]);
    await database.runAsync(
      'UPDATE budgets SET vehicle_id = NULL WHERE vehicle_id = ?',
      [id]
    );
    await database.runAsync(
      'UPDATE recurring_routes SET vehicle_id = NULL WHERE vehicle_id = ?',
      [id]
    );
    await database.runAsync('DELETE FROM vehicles WHERE id = ?', [id]);
  });
}

export async function setActiveVehicle(id: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('UPDATE vehicles SET is_active = 0');
  await database.runAsync('UPDATE vehicles SET is_active = 1 WHERE id = ?', [id]);
  try {
    await AsyncStorage.setItem(LAST_VEHICLE_STORAGE_KEY, String(id));
  } catch {
    /* ignore */
  }
}

export async function getFillUps(vehicleId?: number): Promise<FillUp[]> {
  const database = await getDatabase();
  if (vehicleId) {
    const rows = await database.getAllAsync(
      'SELECT * FROM fill_ups WHERE vehicle_id = ? ORDER BY date DESC',
      [vehicleId]
    );
    return rows.map(mapFillUp);
  }
  const rows = await database.getAllAsync('SELECT * FROM fill_ups ORDER BY date DESC');
  return rows.map(mapFillUp);
}

export async function getFillUpById(id: number): Promise<FillUp | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync('SELECT * FROM fill_ups WHERE id = ?', [id]);
  return row ? mapFillUp(row) : null;
}

export async function updateFillUp(
  id: number,
  patch: Partial<
    Pick<
      FillUp,
      | 'vehicleId'
      | 'date'
      | 'liters'
      | 'pricePerLiter'
      | 'totalCost'
      | 'odometer'
      | 'distanceSinceLastKm'
      | 'isFull'
      | 'note'
    >
  >
): Promise<void> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.vehicleId !== undefined) {
    fields.push('vehicle_id = ?');
    values.push(patch.vehicleId);
  }
  if (patch.date !== undefined) {
    fields.push('date = ?');
    values.push(patch.date);
  }
  if (patch.liters !== undefined) {
    fields.push('liters = ?');
    values.push(patch.liters);
  }
  if (patch.pricePerLiter !== undefined) {
    fields.push('price_per_liter = ?');
    values.push(patch.pricePerLiter);
  }
  if (patch.totalCost !== undefined) {
    fields.push('total_cost = ?');
    values.push(patch.totalCost);
  }
  if (patch.odometer !== undefined) {
    fields.push('odometer = ?');
    values.push(patch.odometer);
  }
  if (patch.distanceSinceLastKm !== undefined) {
    fields.push('distance_since_last_km = ?');
    values.push(patch.distanceSinceLastKm);
  }
  if (patch.isFull !== undefined) {
    fields.push('is_full = ?');
    values.push(patch.isFull ? 1 : 0);
  }
  if (patch.note !== undefined) {
    fields.push('note = ?');
    values.push(patch.note);
  }
  if (!fields.length) return;
  values.push(id);
  await database.runAsync(`UPDATE fill_ups SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteFillUp(id: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM fill_ups WHERE id = ?', [id]);
}

// --- Budgets ---

export async function getBudgets(vehicleId?: number): Promise<Budget[]> {
  const database = await getDatabase();
  let rows;
  if (vehicleId) {
    rows = await database.getAllAsync(
      'SELECT * FROM budgets WHERE (vehicle_id = ? OR vehicle_id IS NULL) AND is_active = 1 ORDER BY start_date DESC',
      [vehicleId]
    );
  } else {
    rows = await database.getAllAsync('SELECT * FROM budgets WHERE is_active = 1 ORDER BY start_date DESC');
  }
  return rows.map(mapBudget);
}

export async function createBudget(budget: Omit<Budget, 'id' | 'spent'>): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync(
    `INSERT INTO budgets (vehicle_id, name, amount, period, start_date, end_date, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      budget.vehicleId,
      budget.name,
      budget.amount,
      budget.period,
      budget.startDate,
      budget.endDate,
      budget.isActive ? 1 : 0,
    ]
  );
  return result.lastInsertRowId;
}

export async function updateBudgetSpent(id: number, spent: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('UPDATE budgets SET spent = ? WHERE id = ?', [spent, id]);
}

export async function updateBudget(
  id: number,
  patch: {
    amount?: number;
    name?: string;
    spent?: number;
    isActive?: boolean;
    startDate?: string;
    endDate?: string;
  }
): Promise<void> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (patch.amount !== undefined) {
    fields.push('amount = ?');
    values.push(patch.amount);
  }
  if (patch.name !== undefined) {
    fields.push('name = ?');
    values.push(patch.name);
  }
  if (patch.spent !== undefined) {
    fields.push('spent = ?');
    values.push(patch.spent);
  }
  if (patch.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(patch.isActive ? 1 : 0);
  }
  if (patch.startDate !== undefined) {
    fields.push('start_date = ?');
    values.push(patch.startDate);
  }
  if (patch.endDate !== undefined) {
    fields.push('end_date = ?');
    values.push(patch.endDate);
  }
  if (!fields.length) return;
  values.push(id);
  await database.runAsync(`UPDATE budgets SET ${fields.join(', ')} WHERE id = ?`, values);
}

/** Désactive les budgets mensuels liés à un véhicule (garde l’enveloppe globale). */
export async function deactivateVehicleScopedBudgets(): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync(
    'UPDATE budgets SET is_active = 0 WHERE vehicle_id IS NOT NULL AND is_active = 1'
  );
  return result.changes ?? 0;
}

export async function updateFillUpMoney(
  id: number,
  pricePerLiter: number,
  totalCost: number
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    'UPDATE fill_ups SET price_per_liter = ?, total_cost = ? WHERE id = ?',
    [pricePerLiter, totalCost, id]
  );
}

export async function deleteBudget(id: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM budgets WHERE id = ?', [id]);
}

// --- Trips ---

export async function getTrips(
  vehicleId?: number,
  opts?: { includeRejected?: boolean; omitRoutePoints?: boolean }
): Promise<Trip[]> {
  const database = await getDatabase();
  const includeRejected = opts?.includeRejected === true;
  const omitPts = opts?.omitRoutePoints === true;
  const cols = omitPts
    ? `id, vehicle_id, start_time, end_time, distance_km, estimated_fuel_used, estimated_cost,
       origin_name, destination_name, is_active, status, source, fill_up_id, note, is_paused,
       '[]' AS route_points`
    : '*';
  if (vehicleId) {
    const rows = includeRejected
      ? await database.getAllAsync(
          `SELECT ${cols} FROM trips WHERE vehicle_id = ? ORDER BY start_time DESC`,
          [vehicleId]
        )
      : await database.getAllAsync(
          `SELECT ${cols} FROM trips WHERE vehicle_id = ? AND status != 'rejected' ORDER BY start_time DESC`,
          [vehicleId]
        );
    return rows.map(mapTrip);
  }
  const rows = includeRejected
    ? await database.getAllAsync(`SELECT ${cols} FROM trips ORDER BY start_time DESC`)
    : await database.getAllAsync(
        `SELECT ${cols} FROM trips WHERE status != 'rejected' ORDER BY start_time DESC`
      );
  return rows.map(mapTrip);
}

export async function getPendingTrips(vehicleId?: number): Promise<Trip[]> {
  const database = await getDatabase();
  if (vehicleId) {
    const rows = await database.getAllAsync(
      "SELECT * FROM trips WHERE vehicle_id = ? AND status = 'pending' ORDER BY start_time DESC",
      [vehicleId]
    );
    return rows.map(mapTrip);
  }
  const rows = await database.getAllAsync(
    "SELECT * FROM trips WHERE status = 'pending' ORDER BY start_time DESC"
  );
  return rows.map(mapTrip);
}

export async function getActiveTrip(): Promise<Trip | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync('SELECT * FROM trips WHERE is_active = 1 LIMIT 1');
  return row ? mapTrip(row) : null;
}

/**
 * Trajet actif sans colonne route_points (évite OOM UI pendant le live).
 * Les points restent en SQLite ; utiliser getTripById / getActiveTrip pour clôturer.
 */
export async function getActiveTripLite(): Promise<Trip | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync(
    `SELECT id, vehicle_id, start_time, end_time, distance_km, estimated_fuel_used, estimated_cost,
            origin_name, destination_name, is_active, status, source, fill_up_id, note, is_paused,
            '[]' AS route_points
     FROM trips WHERE is_active = 1 LIMIT 1`
  );
  return row ? mapTrip(row) : null;
}

export async function getTripById(id: number): Promise<Trip | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync('SELECT * FROM trips WHERE id = ?', [id]);
  return row ? mapTrip(row) : null;
}

export async function createTrip(trip: Omit<Trip, 'id'>): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync(
    `INSERT INTO trips (vehicle_id, start_time, end_time, distance_km, estimated_fuel_used, estimated_cost, route_points, origin_name, destination_name, is_active, status, source, fill_up_id, note, is_paused)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      trip.vehicleId,
      trip.startTime,
      trip.endTime,
      trip.distanceKm,
      trip.estimatedFuelUsed,
      trip.estimatedCost,
      trip.routePoints,
      trip.originName ?? null,
      trip.destinationName ?? null,
      trip.isActive ? 1 : 0,
      trip.status || 'confirmed',
      trip.source || 'gps',
      trip.fillUpId ?? null,
      trip.note ?? null,
      trip.isPaused ? 1 : 0,
    ]
  );
  return result.lastInsertRowId;
}

export async function updateTrip(id: number, trip: Partial<Trip>): Promise<void> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (trip.endTime !== undefined) { fields.push('end_time = ?'); values.push(trip.endTime); }
  if (trip.distanceKm !== undefined) { fields.push('distance_km = ?'); values.push(trip.distanceKm); }
  if (trip.estimatedFuelUsed !== undefined) { fields.push('estimated_fuel_used = ?'); values.push(trip.estimatedFuelUsed); }
  if (trip.estimatedCost !== undefined) { fields.push('estimated_cost = ?'); values.push(trip.estimatedCost); }
  if (trip.routePoints !== undefined) { fields.push('route_points = ?'); values.push(trip.routePoints); }
  if (trip.originName !== undefined) { fields.push('origin_name = ?'); values.push(trip.originName); }
  if (trip.destinationName !== undefined) { fields.push('destination_name = ?'); values.push(trip.destinationName); }
  if (trip.isActive !== undefined) { fields.push('is_active = ?'); values.push(trip.isActive ? 1 : 0); }
  if (trip.isPaused !== undefined) { fields.push('is_paused = ?'); values.push(trip.isPaused ? 1 : 0); }
  if (trip.status !== undefined) { fields.push('status = ?'); values.push(trip.status); }
  if (trip.source !== undefined) { fields.push('source = ?'); values.push(trip.source); }
  if (trip.fillUpId !== undefined) { fields.push('fill_up_id = ?'); values.push(trip.fillUpId); }
  if (trip.note !== undefined) { fields.push('note = ?'); values.push(trip.note); }

  if (fields.length === 0) return;
  values.push(id);
  await database.runAsync(`UPDATE trips SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteTrip(id: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM trips WHERE id = ?', [id]);
}

function mapFuelGaugeReading(row: unknown): FuelGaugeReading {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    vehicleId: r.vehicle_id as number,
    recordedAt: r.recorded_at as string,
    liters: r.liters as number,
    tankCapacity: r.tank_capacity as number,
    source: r.source as FuelGaugeSource,
    tripId: r.trip_id === null || r.trip_id === undefined ? null : (r.trip_id as number),
    fillUpId: r.fill_up_id === null || r.fill_up_id === undefined ? null : (r.fill_up_id as number),
    odometer: r.odometer === null || r.odometer === undefined ? null : (r.odometer as number),
  };
}

export async function createFuelGaugeReading(
  input: Omit<FuelGaugeReading, 'id'>
): Promise<FuelGaugeReading> {
  const database = await getDatabase();
  const result = await database.runAsync(
    `INSERT INTO fuel_gauge_readings (
      vehicle_id, recorded_at, liters, tank_capacity, source, trip_id, fill_up_id, odometer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.vehicleId,
      input.recordedAt,
      input.liters,
      input.tankCapacity,
      input.source,
      input.tripId ?? null,
      input.fillUpId ?? null,
      input.odometer ?? null,
    ]
  );
  const id = Number(result.lastInsertRowId);
  return { ...input, id };
}

export async function getFuelGaugeReadings(
  vehicleId?: number,
  opts?: { tripId?: number; limit?: number }
): Promise<FuelGaugeReading[]> {
  const database = await getDatabase();
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (vehicleId != null) {
    clauses.push('vehicle_id = ?');
    params.push(vehicleId);
  }
  if (opts?.tripId != null) {
    clauses.push('trip_id = ?');
    params.push(opts.tripId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  if (opts?.limit != null && Number.isFinite(opts.limit) && opts.limit > 0) {
    params.push(Math.floor(opts.limit));
  }
  const limitSql =
    opts?.limit != null && Number.isFinite(opts.limit) && opts.limit > 0 ? ' LIMIT ?' : '';
  const rows = await database.getAllAsync(
    `SELECT * FROM fuel_gauge_readings ${where} ORDER BY recorded_at DESC${limitSql}`,
    params
  );
  return (rows || []).map(mapFuelGaugeReading);
}

export async function getTripGaugeReadings(tripId: number): Promise<FuelGaugeReading[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync(
    `SELECT * FROM fuel_gauge_readings
     WHERE trip_id = ? AND source IN ('trip_start', 'trip_end')
     ORDER BY recorded_at DESC`,
    [tripId]
  );
  return (rows || []).map(mapFuelGaugeReading);
}

/** Supprime les trajets de test (simulateur) — notes / lieux « (sim) » / SIMULATEUR. */
export async function purgeSimulatorTrips(vehicleId?: number): Promise<number> {
  const trips = await getTrips(vehicleId, { includeRejected: true });
  const sims = trips.filter(
    (t) =>
      /SIMULATEUR/i.test(t.note || '') ||
      /\(sim\)/i.test(t.originName || '') ||
      /\(sim\)/i.test(t.destinationName || '')
  );
  for (const t of sims) {
    await deleteTrip(t.id);
  }
  return sims.length;
}

export async function stopActiveTrips(): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    "UPDATE trips SET is_active = 0, end_time = datetime('now') WHERE is_active = 1"
  );
}

// --- Places & trajets réguliers ---

function mapPlace(row: unknown): Place {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    name: r.name as string,
    address: (r.address as string) || '',
    kind: (r.kind as PlaceKind) || 'other',
    latitude: r.latitude == null ? null : (r.latitude as number),
    longitude: r.longitude == null ? null : (r.longitude as number),
    sortOrder: (r.sort_order as number) ?? 0,
    createdAt: r.created_at as string,
  };
}

function mapRoute(row: unknown): RecurringRoute {
  const r = row as Record<string, unknown>;
  const times = (r.times_per_week as number) ?? 5;
  return {
    id: r.id as number,
    vehicleId: r.vehicle_id == null ? null : (r.vehicle_id as number),
    name: r.name as string,
    fromPlaceId: r.from_place_id as number,
    toPlaceId: r.to_place_id as number,
    distanceKm: r.distance_km as number,
    timesPerWeek: times,
    workDaysPerWeek: (r.work_days_per_week as number) ?? times,
    isOnVacation: Boolean(r.is_on_vacation),
    vacationUntil: (r.vacation_until as string) || null,
    isActive: Boolean(r.is_active),
  };
}

export async function getPlaces(): Promise<Place[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync(
    'SELECT * FROM places ORDER BY sort_order ASC, kind ASC, name ASC'
  );
  return rows.map(mapPlace);
}

export async function createPlace(place: Omit<Place, 'id' | 'createdAt'>): Promise<number> {
  const database = await getDatabase();
  const maxRow = await database.getFirstAsync<{ m: number }>(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM places'
  );
  const sortOrder = place.sortOrder ?? ((maxRow?.m ?? -1) + 1);
  const result = await database.runAsync(
    `INSERT INTO places (name, address, kind, latitude, longitude, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
    [place.name, place.address || '', place.kind, place.latitude, place.longitude, sortOrder]
  );
  return Number(result.lastInsertRowId);
}

export async function updatePlace(id: number, place: Partial<Place>): Promise<void> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (place.name !== undefined) { fields.push('name = ?'); values.push(place.name); }
  if (place.address !== undefined) { fields.push('address = ?'); values.push(place.address); }
  if (place.kind !== undefined) { fields.push('kind = ?'); values.push(place.kind); }
  if (place.latitude !== undefined) { fields.push('latitude = ?'); values.push(place.latitude); }
  if (place.longitude !== undefined) { fields.push('longitude = ?'); values.push(place.longitude); }
  if (place.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(place.sortOrder); }
  if (!fields.length) return;
  values.push(id);
  await database.runAsync(`UPDATE places SET ${fields.join(', ')} WHERE id = ?`, values);
}

/** Échange l’ordre de deux lieux (↑ / ↓ dans la liste). */
export async function swapPlaceOrder(idA: number, idB: number): Promise<void> {
  const places = await getPlaces();
  const a = places.find((p) => p.id === idA);
  const b = places.find((p) => p.id === idB);
  if (!a || !b) return;
  const orderA = a.sortOrder ?? 0;
  const orderB = b.sortOrder ?? 0;
  await updatePlace(idA, { sortOrder: orderB });
  await updatePlace(idB, { sortOrder: orderA });
}

export async function deletePlace(id: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM recurring_routes WHERE from_place_id = ? OR to_place_id = ?', [id, id]);
  await database.runAsync('DELETE FROM places WHERE id = ?', [id]);
}

export async function getRecurringRoutes(vehicleId?: number): Promise<RecurringRoute[]> {
  const database = await getDatabase();
  if (vehicleId) {
    const rows = await database.getAllAsync(
      'SELECT * FROM recurring_routes WHERE is_active = 1 AND (vehicle_id = ? OR vehicle_id IS NULL) ORDER BY name',
      [vehicleId]
    );
    return rows.map(mapRoute);
  }
  const rows = await database.getAllAsync(
    'SELECT * FROM recurring_routes WHERE is_active = 1 ORDER BY name'
  );
  return rows.map(mapRoute);
}

export async function createRecurringRoute(
  route: Omit<RecurringRoute, 'id'>
): Promise<number> {
  const database = await getDatabase();
  const workDays = route.workDaysPerWeek ?? route.timesPerWeek ?? 5;
  const result = await database.runAsync(
    `INSERT INTO recurring_routes (vehicle_id, name, from_place_id, to_place_id, distance_km, times_per_week, work_days_per_week, is_on_vacation, vacation_until, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      route.vehicleId,
      route.name,
      route.fromPlaceId,
      route.toPlaceId,
      route.distanceKm,
      route.timesPerWeek ?? workDays,
      workDays,
      route.isOnVacation ? 1 : 0,
      route.vacationUntil || null,
      route.isActive ? 1 : 0,
    ]
  );
  return Number(result.lastInsertRowId);
}

export async function updateRecurringRoute(
  id: number,
  patch: Partial<Omit<RecurringRoute, 'id'>>
): Promise<void> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    fields.push('name = ?');
    values.push(patch.name);
  }
  if (patch.distanceKm !== undefined) {
    fields.push('distance_km = ?');
    values.push(patch.distanceKm);
  }
  if (patch.timesPerWeek !== undefined) {
    fields.push('times_per_week = ?');
    values.push(patch.timesPerWeek);
  }
  if (patch.workDaysPerWeek !== undefined) {
    fields.push('work_days_per_week = ?');
    values.push(patch.workDaysPerWeek);
  }
  if (patch.isOnVacation !== undefined) {
    fields.push('is_on_vacation = ?');
    values.push(patch.isOnVacation ? 1 : 0);
  }
  if (patch.vacationUntil !== undefined) {
    fields.push('vacation_until = ?');
    values.push(patch.vacationUntil);
  }
  if (patch.fromPlaceId !== undefined) {
    fields.push('from_place_id = ?');
    values.push(patch.fromPlaceId);
  }
  if (patch.toPlaceId !== undefined) {
    fields.push('to_place_id = ?');
    values.push(patch.toPlaceId);
  }
  if (patch.vehicleId !== undefined) {
    fields.push('vehicle_id = ?');
    values.push(patch.vehicleId);
  }
  if (patch.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(patch.isActive ? 1 : 0);
  }
  if (!fields.length) return;
  values.push(id);
  await database.runAsync(`UPDATE recurring_routes SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteRecurringRoute(id: number): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM recurring_routes WHERE id = ?', [id]);
}

export async function getMonthlySpend(
  months = 6,
  vehicleId?: number
): Promise<{ month: string; spent: number }[]> {
  const database = await getDatabase();
  const rows = vehicleId
    ? await database.getAllAsync<{ month: string; spent: number }>(
        `SELECT substr(date, 1, 7) AS month, SUM(total_cost) AS spent
         FROM fill_ups
         WHERE vehicle_id = ?
         GROUP BY substr(date, 1, 7)
         ORDER BY month DESC
         LIMIT ?`,
        [vehicleId, months]
      )
    : await database.getAllAsync<{ month: string; spent: number }>(
        `SELECT substr(date, 1, 7) AS month, SUM(total_cost) AS spent
         FROM fill_ups
         GROUP BY substr(date, 1, 7)
         ORDER BY month DESC
         LIMIT ?`,
        [months]
      );
  return rows.map((r) => ({ month: r.month, spent: Number(r.spent) || 0 })).reverse();
}

/** Dépenses mensuelles ventilées par véhicule (tous véhicules). */
export async function getMonthlySpendByVehicle(
  months = 6
): Promise<{ month: string; vehicleId: number; spent: number }[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ month: string; vehicle_id: number; spent: number }>(
    `SELECT substr(date, 1, 7) AS month, vehicle_id, SUM(total_cost) AS spent
     FROM fill_ups
     GROUP BY substr(date, 1, 7), vehicle_id
     ORDER BY month DESC`,
    []
  );
  const monthSet = new Set<string>();
  for (const r of rows) monthSet.add(r.month);
  const sortedMonths = [...monthSet].sort((a, b) => b.localeCompare(a)).slice(0, months);
  const allowed = new Set(sortedMonths);
  return rows
    .filter((r) => allowed.has(r.month))
    .map((r) => ({
      month: r.month,
      vehicleId: r.vehicle_id,
      spent: Number(r.spent) || 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** expo-sqlite refuse / compte mal les `undefined` dans les binds → toujours null. */
function sqlBind(values: unknown[]): (string | number | null)[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number' || typeof v === 'string') return v;
    return String(v);
  });
}

async function runInsert(
  database: SQLite.SQLiteDatabase,
  sql: string,
  values: unknown[]
): Promise<void> {
  const binds = sqlBind(values);
  const placeholders = (sql.match(/\?/g) || []).length;
  if (binds.length !== placeholders) {
    throw new Error(
      `SQLite bind mismatch: ${binds.length} values for ${placeholders} placeholders`
    );
  }
  await database.runAsync(sql, binds);
}

/** Remplace tout le contenu local (préserve les ids) — utilisé backup / sync. */
export async function replaceAllData(data: {
  vehicles: Vehicle[];
  fillUps: FillUp[];
  budgets: Budget[];
  trips: Trip[];
  places: Place[];
  recurringRoutes: RecurringRoute[];
  maintenances?: VehicleMaintenance[];
  gaugeReadings?: FuelGaugeReading[];
}): Promise<void> {
  const database = await getDatabase();
  await database.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await database.withTransactionAsync(async () => {
      await database.execAsync(`
        DELETE FROM vehicle_maintenances;
        DELETE FROM recurring_routes;
        DELETE FROM places;
        DELETE FROM fill_ups;
        DELETE FROM trips;
        DELETE FROM budgets;
        DELETE FROM vehicles;
        ${data.gaugeReadings !== undefined ? 'DELETE FROM fuel_gauge_readings;' : ''}
      `);

      for (const v of data.vehicles || []) {
        const checklist =
          v.maintenanceChecklist == null
            ? null
            : typeof v.maintenanceChecklist === 'string'
              ? v.maintenanceChecklist
              : JSON.stringify(v.maintenanceChecklist);
        await runInsert(
          database,
          `INSERT INTO vehicles (
            id, name, brand, model, year, fuel_type, consumption_per_100, tank_capacity,
            default_fuel_price, current_odometer, has_odometer, tracked_km, estimated_fuel_liters,
            consumption_auto_adapt, notify_maintenance, notify_low_fuel, low_fuel_threshold_liters,
            consumption_learn_factor, transmission_gears, curb_weight_kg, drag_area_scx,
            vehicle_segment, payload_kg, maintenance_up_to_date, maintenance_checklist,
            is_active, created_at, plate_number, vin, registration_photo_uri
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            v.id,
            v.name,
            v.brand,
            v.model,
            v.year,
            v.fuelType,
            v.consumptionPer100,
            v.tankCapacity,
            v.defaultFuelPrice,
            v.currentOdometer,
            v.hasOdometer ? 1 : 0,
            v.trackedKm ?? 0,
            v.estimatedFuelLiters ?? null,
            v.consumptionAutoAdapt === false ? 0 : 1,
            v.notifyMaintenance === false ? 0 : 1,
            v.notifyLowFuel ? 1 : 0,
            v.lowFuelThresholdLiters ?? null,
            v.consumptionLearnFactor ?? 1,
            v.transmissionGears ?? null,
            v.curbWeightKg ?? null,
            v.dragAreaScx ?? null,
            v.vehicleSegment ?? null,
            v.payloadKg ?? null,
            v.maintenanceUpToDate == null ? null : v.maintenanceUpToDate ? 1 : 0,
            checklist,
            v.isActive ? 1 : 0,
            v.createdAt || new Date().toISOString(),
            v.plateNumber ?? null,
            v.vin ?? null,
            v.registrationPhotoUri ?? null,
          ]
        );
      }

      for (const t of data.trips || []) {
        await runInsert(
          database,
          `INSERT INTO trips (
            id, vehicle_id, start_time, end_time, distance_km, estimated_fuel_used, estimated_cost,
            route_points, origin_name, destination_name, is_active, status, source, fill_up_id,
            note, is_paused
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            t.id,
            t.vehicleId,
            t.startTime,
            t.endTime,
            t.distanceKm,
            t.estimatedFuelUsed,
            t.estimatedCost,
            t.routePoints || '[]',
            t.originName || null,
            t.destinationName || null,
            t.isActive ? 1 : 0,
            t.status || 'confirmed',
            t.source || 'gps',
            t.fillUpId ?? null,
            t.note || null,
            t.isPaused ? 1 : 0,
          ]
        );
      }

      for (const f of data.fillUps || []) {
        await runInsert(
          database,
          `INSERT INTO fill_ups (
            id, vehicle_id, date, liters, price_per_liter, total_cost, odometer,
            distance_since_last_km, is_full, note, trip_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            f.id,
            f.vehicleId,
            f.date,
            f.liters,
            f.pricePerLiter,
            f.totalCost,
            f.odometer ?? null,
            f.distanceSinceLastKm ?? null,
            f.isFull ? 1 : 0,
            f.note || null,
            f.tripId ?? null,
          ]
        );
      }

      for (const b of data.budgets || []) {
        await runInsert(
          database,
          `INSERT INTO budgets (
            id, vehicle_id, name, amount, spent, period, start_date, end_date, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            b.id,
            b.vehicleId,
            b.name,
            b.amount,
            b.spent ?? 0,
            b.period,
            b.startDate,
            b.endDate,
            b.isActive ? 1 : 0,
          ]
        );
      }

      for (const p of data.places || []) {
        await runInsert(
          database,
          `INSERT INTO places (
            id, name, address, kind, latitude, longitude, created_at, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            p.name,
            p.address || '',
            p.kind || 'other',
            p.latitude ?? null,
            p.longitude ?? null,
            p.createdAt || new Date().toISOString(),
            p.sortOrder ?? 0,
          ]
        );
      }

      for (const r of data.recurringRoutes || []) {
        await runInsert(
          database,
          `INSERT INTO recurring_routes (
            id, vehicle_id, name, from_place_id, to_place_id, distance_km, times_per_week,
            work_days_per_week, is_on_vacation, vacation_until, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.id,
            r.vehicleId,
            r.name,
            r.fromPlaceId,
            r.toPlaceId,
            r.distanceKm,
            r.timesPerWeek,
            r.workDaysPerWeek ?? r.timesPerWeek ?? 5,
            r.isOnVacation ? 1 : 0,
            r.vacationUntil || null,
            r.isActive ? 1 : 0,
          ]
        );
      }

      if (data.gaugeReadings !== undefined) {
        for (const g of data.gaugeReadings || []) {
          await runInsert(
            database,
            `INSERT INTO fuel_gauge_readings (
              id, vehicle_id, recorded_at, liters, tank_capacity, source, trip_id, fill_up_id, odometer
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              g.id,
              g.vehicleId,
              g.recordedAt,
              g.liters,
              g.tankCapacity,
              g.source,
              g.tripId ?? null,
              g.fillUpId ?? null,
              g.odometer ?? null,
            ]
          );
        }
      }

      for (const m of data.maintenances || []) {
        await runInsert(
          database,
          `INSERT INTO vehicle_maintenances (
            id, vehicle_id, kind, title, amount, done_at, due_date, status, note, created_at,
            photo_uri, due_odometer
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.id,
            m.vehicleId,
            m.kind,
            m.title,
            m.amount ?? null,
            m.doneAt ?? null,
            m.dueDate ?? null,
            m.status || 'pending',
            m.note ?? null,
            m.createdAt || new Date().toISOString(),
            m.photoUri ?? null,
            m.dueOdometer ?? null,
          ]
        );
      }
    });
  } finally {
    await database.execAsync('PRAGMA foreign_keys = ON;');
  }
}

export async function hasLocalUserData(): Promise<boolean> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ n: number }>(
    `SELECT (
       (SELECT COUNT(*) FROM vehicles) +
       (SELECT COUNT(*) FROM fill_ups) +
       (SELECT COUNT(*) FROM trips) +
       (SELECT COUNT(*) FROM budgets) +
       (SELECT COUNT(*) FROM places)
     ) AS n`
  );
  return (row?.n || 0) > 0;
}
