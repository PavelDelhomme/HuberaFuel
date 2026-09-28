/**
 * Rallonge le retour 28/09 12:43 (trajet 175) : départ Intermarché + arrivée domicile.
 * Le GPS n’avait commencé qu’à Bais et s’était arrêté 160 m avant chez toi.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  const v = m[2].replace(/^["']|["']$/g, '');
  if (!process.env[m[1]]) process.env[m[1]] = v;
}

const API = process.env.API_URL || 'https://gasoil-tracking.delhomme.ovh/api';
const email = process.env.PERSONAL_MAIL;
const password = process.env.PERSONAL_PASSWORD || process.env.HUBERA_OWNER_PASSWORD;
const HOME = { lat: 48.1571969, lng: -1.586983 };
const WORK = { lat: 47.9474563, lng: -1.2238268 };

function haversine(a, b) {
  const R = 6371;
  const p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p;
  const dLon = (b.lng - a.lng) * p;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function routeKm(pts) {
  let t = 0;
  for (let i = 1; i < pts.length; i++) {
    t += haversine(
      { lat: pts[i - 1].latitude, lng: pts[i - 1].longitude },
      { lat: pts[i].latitude, lng: pts[i].longitude }
    );
  }
  return Math.round(t * 1000) / 1000;
}

async function osrm(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const r = await fetch(url);
  const j = await r.json();
  const route = j.routes?.[0];
  if (!route) return [];
  return route.geometry.coordinates.map(([lng, lat]) => ({
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lng * 1e6) / 1e6,
  }));
}

function downsample(pts, max = 140) {
  if (pts.length <= max) return pts;
  const out = [];
  const step = (pts.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

function stamp(coords, t0, t1) {
  const n = Math.max(coords.length - 1, 1);
  return coords.map((c, i) => ({
    ...c,
    timestamp: Math.round(t0 + ((t1 - t0) * i) / n),
  }));
}

function dropJoin(seg, join, fromEnd) {
  if (!seg.length) return seg;
  const other = fromEnd ? seg[seg.length - 1] : seg[0];
  const d = haversine(
    { lat: other.latitude, lng: other.longitude },
    { lat: join.latitude, lng: join.longitude }
  );
  if (d < 0.04) return fromEnd ? seg.slice(0, -1) : seg.slice(1);
  return seg;
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
}).then((r) => r.json());
const token = login.token;
if (!token) {
  console.error('login fail', login);
  process.exit(1);
}

const sync = await fetch(`${API}/sync`, { headers: { Authorization: `Bearer ${token}` } }).then(
  (r) => r.json()
);
const data = sync.data;
if (!data?.trips) {
  console.error('no sync data');
  process.exit(1);
}

const trip = data.trips.find((t) => Number(t.id) === 175);
const zombie = data.trips.find((t) => Number(t.id) === 174);
if (!trip) {
  console.error('trip 175 missing');
  process.exit(1);
}

const recorded = JSON.parse(trip.routePoints || '[]');
const first = recorded[0];
const last = recorded[recorded.length - 1];
if (!first || !last) {
  console.error('175 sans points');
  process.exit(1);
}

const [head, tail] = await Promise.all([
  osrm(WORK, { lat: first.latitude, lng: first.longitude }),
  osrm({ lat: last.latitude, lng: last.longitude }, HOME),
]);
if (head.length < 2 || tail.length < 2) {
  console.error('OSRM fail', head.length, tail.length);
  process.exit(1);
}

const tFirst = first.timestamp;
const tLast = last.timestamp;
const prefix = dropJoin(stamp(head, tFirst - 10 * 60_000, tFirst), first, true);
const suffix = dropJoin(stamp(tail, tLast, tLast + 45_000), last, false);
const merged = downsample([...prefix, ...recorded, ...suffix], 160);
const km = routeKm(merged);

const vehicle = data.vehicles.find((v) => Number(v.id) === Number(trip.vehicleId));
const conso = vehicle?.consumptionPer100 || 8.06;
const diesel = 2.385;
const litres = Math.round((km * conso) / 10) / 10;
const cost = Math.round(litres * diesel * 100) / 100;

Object.assign(trip, {
  distanceKm: km,
  estimatedFuelUsed: litres,
  estimatedCost: cost,
  routePoints: JSON.stringify(merged),
  originName: 'Intermarché La Guerche',
  destinationName: 'Domicile — 1 Rue Camille Saint-Saëns, 35235 Thorigné-Fouillard',
  isActive: false,
  isPaused: false,
  status: 'confirmed',
  note: [
    (trip.note || '').replace(/\nAdresses :.*/s, '').trim(),
    'Rallongé : départ Intermarché + arrivée domicile (GPS coupé aux deux bouts)',
  ]
    .filter(Boolean)
    .join(' · '),
});

if (zombie) {
  zombie.status = 'rejected';
  zombie.isActive = false;
  zombie.note = `${zombie.note || ''} [fusionné dans trajet 175]`.trim();
}

data.exportedAt = new Date().toISOString();
data.appVersion = data.appVersion || '1.4.154';

const put = await fetch(`${API}/sync`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ data }),
}).then((r) => r.json());

console.log(
  JSON.stringify(
    {
      ok: Boolean(put?.ok || put?.data || put?.updatedAt),
      prevKm: 37.729,
      newKm: km,
      litres,
      cost,
      nPts: merged.length,
      first: merged[0],
      last: merged[merged.length - 1],
      origin: trip.originName,
      dest: trip.destinationName,
      zombie174: zombie ? zombie.status : null,
    },
    null,
    2
  )
);
