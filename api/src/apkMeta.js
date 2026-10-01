/**
 * Identité réelle d’un APK (package / versionName / versionCode / ABI)
 * lue dans le ZIP + AndroidManifest binaire — sans aapt ni pyaxmlparser.
 */
import fs from 'fs';
import zlib from 'zlib';

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;
const TYPE_STR_POOL = 0x0001;
const TYPE_RES_MAP = 0x0180;
const TYPE_START = 0x0102;
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

export const PROD_ANDROID_PACKAGE = 'cloud.hubera.fuel';

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  return -1;
}

function parseZipCentral(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('ZIP EOCD introuvable — fichier non-APK');
  const nEntries = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (nEntries === 0xffff || cdOff === 0xffffffff) {
    throw new Error('APK ZIP64 non supporté');
  }
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < nEntries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN) {
      throw new Error('ZIP central directory corrompu');
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const lp = entry.localOff;
  if (lp + 30 > buf.length || buf.readUInt32LE(lp) !== LOC) {
    throw new Error(`ZIP local header manquant (${entry.name})`);
  }
  const nameLen = buf.readUInt16LE(lp + 26);
  const extraLen = buf.readUInt16LE(lp + 28);
  const dataStart = lp + 30 + nameLen + extraLen;
  const compressed = buf.slice(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`ZIP méthode ${entry.method} non supportée (${entry.name})`);
}

function readUtf16(buf, offset, count) {
  const chars = [];
  for (let i = 0; i < count; i++) chars.push(buf.readUInt16LE(offset + i * 2));
  return String.fromCharCode(...chars);
}

function parseStringPool(buf, poolStart) {
  const headerSize = buf.readUInt16LE(poolStart + 2);
  const stringCount = buf.readUInt32LE(poolStart + 8);
  const flags = buf.readUInt32LE(poolStart + 16);
  const stringsOffset = buf.readUInt32LE(poolStart + 20);
  const utf8 = (flags & (1 << 8)) !== 0;
  const offsets = [];
  for (let i = 0; i < stringCount; i++) {
    offsets.push(buf.readUInt32LE(poolStart + headerSize + i * 4));
  }
  const strData = poolStart + stringsOffset;
  function get(i) {
    if (i < 0 || i >= stringCount) return '';
    let o = strData + offsets[i];
    if (utf8) {
      let u16len = buf[o];
      o += 1;
      if (u16len & 0x80) {
        u16len = ((u16len & 0x7f) << 8) | buf[o];
        o += 1;
      }
      let u8len = buf[o];
      o += 1;
      if (u8len & 0x80) {
        u8len = ((u8len & 0x7f) << 8) | buf[o];
        o += 1;
      }
      return buf.slice(o, o + u8len).toString('utf8');
    }
    let u16len = buf.readUInt16LE(o);
    o += 2;
    if (u16len & 0x8000) {
      u16len = ((u16len & 0x7fff) << 16) | buf.readUInt16LE(o);
      o += 2;
    }
    return readUtf16(buf, o, u16len);
  }
  return { get, stringCount };
}

export function parseAxmlManifest(buf) {
  if (!buf || buf.length < 8) throw new Error('AndroidManifest vide');
  const fileSize = buf.readUInt32LE(4);
  let p = 8;
  let strings = null;
  const resMap = [];
  let packageName = null;
  let versionName = null;
  let versionCode = null;

  while (p + 8 <= buf.length && p < fileSize) {
    const type = buf.readUInt16LE(p);
    const headerSize = buf.readUInt16LE(p + 2);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8) break;
    if (type === TYPE_STR_POOL && !strings) {
      strings = parseStringPool(buf, p);
    } else if (type === TYPE_RES_MAP) {
      const n = Math.floor((size - headerSize) / 4);
      for (let i = 0; i < n; i++) {
        resMap[i] = buf.readUInt32LE(p + headerSize + i * 4);
      }
    } else if (type === TYPE_START && strings) {
      let q = p + headerSize;
      q += 4; // ns
      const nameIdx = buf.readUInt32LE(q);
      q += 4;
      q += 4; // flags
      const attrCountPacked = buf.readUInt32LE(q);
      q += 4;
      q += 4; // class attr
      const attrCount = attrCountPacked & 0xffff;
      const tag = strings.get(nameIdx);
      const attrs = {};
      for (let i = 0; i < attrCount; i++) {
        q += 4; // attr ns
        const aName = buf.readUInt32LE(q);
        q += 4;
        const aRaw = buf.readUInt32LE(q);
        q += 4;
        const valueSizeAndType = buf.readUInt32LE(q);
        q += 4;
        const data = buf.readUInt32LE(q);
        q += 4;
        const dataType = (valueSizeAndType >> 24) & 0xff;
        const rid = resMap[aName];
        let key = strings.get(aName);
        if (rid === ATTR_VERSION_CODE) key = 'versionCode';
        if (rid === ATTR_VERSION_NAME) key = 'versionName';
        let val = data;
        if (dataType === TYPE_STRING) val = strings.get(data);
        else if (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX) val = data;
        else if (aRaw !== 0xffffffff) val = strings.get(aRaw);
        attrs[key] = val;
      }
      if (tag === 'manifest') {
        packageName = attrs.package != null ? String(attrs.package) : packageName;
        if (attrs.versionCode != null) versionCode = Number(attrs.versionCode);
        if (attrs.versionName != null) versionName = String(attrs.versionName);
        break;
      }
    }
    p += size;
  }

  if (!packageName || versionCode == null) {
    throw new Error('AndroidManifest : package/versionCode illisibles');
  }
  return { packageName, versionName, versionCode };
}

export function readApkIdentity(apkPath) {
  const buf = fs.readFileSync(apkPath);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('Fichier non-APK (magique ZIP manquante)');
  }
  const entries = parseZipCentral(buf);
  const names = entries.map((e) => e.name);
  const abis = [
    ...new Set(
      names.filter((n) => n.startsWith('lib/') && n.split('/').length > 1).map((n) => n.split('/')[1])
    ),
  ].filter(Boolean);
  const man = entries.find((e) => e.name === 'AndroidManifest.xml');
  if (!man) throw new Error('AndroidManifest.xml absent de l’APK');
  const identity = parseAxmlManifest(extractEntry(buf, man));
  return { ...identity, abis, size: buf.length };
}

/**
 * Refuse un APK qui casserait l’OTA Android (mauvais package, versionCode
 * tamponné par EAS remote, multi-ABI, etc.).
 */
export function assertApkIdentity(apkPath, expected = {}) {
  const meta = readApkIdentity(apkPath);
  const pkg = expected.packageName || PROD_ANDROID_PACKAGE;
  if (meta.packageName !== pkg) {
    throw new Error(`package APK ${meta.packageName} ≠ ${pkg}`);
  }
  if (expected.versionCode != null && Number(meta.versionCode) !== Number(expected.versionCode)) {
    throw new Error(
      `versionCode DANS l’APK = ${meta.versionCode} ≠ déclaré ${expected.versionCode} ` +
        '(EAS remote a probablement écrasé app.json — OTA Android refuse le downgrade)'
    );
  }
  if (
    expected.versionName != null &&
    String(meta.versionName) !== String(expected.versionName)
  ) {
    throw new Error(`versionName APK ${meta.versionName} ≠ ${expected.versionName}`);
  }
  if (!meta.abis.includes('arm64-v8a')) {
    throw new Error(`APK sans lib/arm64-v8a (ABIs=${meta.abis.join(',') || 'aucun'})`);
  }
  const extra = meta.abis.filter((a) => a !== 'arm64-v8a');
  if (extra.length) {
    throw new Error(`APK multi-ABI détecté (${extra.join(',')}) — republier arm64-v8a uniquement`);
  }
  return meta;
}
