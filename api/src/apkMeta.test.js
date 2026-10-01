import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { assertApkIdentity, parseAxmlManifest, readApkIdentity } from './apkMeta.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(here, '__fixtures__/AndroidManifest.bin');

function zipStore(files) {
  const chunks = [];
  const locals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const data = f.data;
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localOff = offset;
    chunks.push(local, name, data);
    offset += local.length + name.length + data.length;
    locals.push({ name, data, crc, localOff });
  }
  const cdStart = offset;
  for (const e of locals) {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(e.crc >>> 0, 16);
    c.writeUInt32LE(e.data.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(e.name.length, 28);
    c.writeUInt32LE(e.localOff, 42);
    chunks.push(c, e.name);
    offset += 46 + e.name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(locals.length, 8);
  eocd.writeUInt16LE(locals.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

function writeFakeApk(abis = ['arm64-v8a']) {
  const man = fs.readFileSync(MANIFEST);
  const files = [{ name: 'AndroidManifest.xml', data: man }];
  for (const abi of abis) {
    files.push({ name: `lib/${abi}/libapp.so`, data: Buffer.from('so') });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-meta-'));
  const apk = path.join(dir, 't.apk');
  fs.writeFileSync(apk, zipStore(files));
  return apk;
}

describe('parseAxmlManifest (fixture live 1.4.120)', () => {
  it('lit le versionCode réel 137 (pas le 146 déclaré à l’API)', () => {
    const man = fs.readFileSync(MANIFEST);
    expect(parseAxmlManifest(man)).toEqual({
      packageName: 'com.gasoiltracking.app',
      versionName: '1.4.120',
      versionCode: 137,
    });
  });
});

describe('readApkIdentity / assertApkIdentity', () => {
  it('accepte un APK arm64 dont le manifeste matche', () => {
    const apk = writeFakeApk();
    const meta = readApkIdentity(apk);
    expect(meta.packageName).toBe('com.gasoiltracking.app');
    expect(meta.versionCode).toBe(137);
    expect(meta.abis).toEqual(['arm64-v8a']);
    expect(() =>
      assertApkIdentity(apk, {
        packageName: 'com.gasoiltracking.app',
        versionName: '1.4.120',
        versionCode: 137,
      })
    ).not.toThrow();
  });

  it('refuse un versionCode déclaré plus haut que celui du binaire', () => {
    const apk = writeFakeApk();
    expect(() =>
      assertApkIdentity(apk, {
        packageName: 'com.gasoiltracking.app',
        versionName: '1.4.120',
        versionCode: 146,
      })
    ).toThrow(/versionCode DANS l’APK = 137 ≠ déclaré 146/);
  });

  it('refuse un APK multi-ABI', () => {
    const apk = writeFakeApk(['arm64-v8a', 'x86_64']);
    expect(() =>
      assertApkIdentity(apk, {
        packageName: 'com.gasoiltracking.app',
        versionCode: 137,
      })
    ).toThrow(/multi-ABI/);
  });
});
