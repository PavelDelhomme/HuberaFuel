#!/usr/bin/env python3
"""Vérifie qu’un APK release est installable (package, versionCode, ABI, certificat).

Le paquet et l’hôte viennent de api/src/releaseIdentity.js :
cloud.hubera.fuel, le legacy com.gasoiltracking.app, hôte fuel.hubera.cloud.
Un nom étranger est refusé. On ne revient pas à un ancien nom d’app.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

try:
    from pyaxmlparser import APK
except ModuleNotFoundError:
    APK = None  # repli aapt plus bas, pour une machine sans pyaxmlparser


class AaptApk:
    """Même infos que pyaxmlparser.APK, lues avec aapt et apksigner."""

    def __init__(self, path: str):
        self.path = path
        badging = subprocess.check_output(["aapt", "dump", "badging", path], text=True, stderr=subprocess.DEVNULL)
        pkg = ""
        vc = ""
        vn = ""
        for line in badging.splitlines():
            if line.startswith("package:"):
                for part in line.split():
                    if part.startswith("name="):
                        pkg = part.split("=", 1)[1].strip("'")
                    elif part.startswith("versionCode="):
                        vc = part.split("=", 1)[1].strip("'")
                    elif part.startswith("versionName="):
                        vn = part.split("=", 1)[1].strip("'")
        self.package = pkg
        self.version_code = vc
        self.version_name = vn
        self._cert_sha = ""
        signer = subprocess.check_output(["apksigner", "verify", "--print-certs", path], text=True, stderr=subprocess.DEVNULL)
        for line in signer.splitlines():
            if "SHA-256 digest" in line:
                self._cert_sha = line.split()[-1].replace(":", "").lower()
                break

    def get_certificates(self):
        return [self]

    def dump(self):
        # verify() compare sha256(der). On fournit déjà le digest, via un faux DER
        # dont le hash n'est pas le digest affiché. Le contrôle se fait dans main
        # si _cert_sha est posé. Ici on renvoie des octets stables seulement si besoin.
        return b""

EXPECTED_CERT = "13c3be90a99fb1a944bc5eedd782ae154ac4ab545bc4e92d53ba0040273ea5f2"
ROOT = Path(__file__).resolve().parents[1]

# Repli si node est absent — même liste que api/src/releaseIdentity.js
FALLBACK_ALLOW = {
    "packages": ["cloud.hubera.fuel", "com.gasoiltracking.app"],
    "hosts": [
        "fuel.hubera.cloud",
        "gasoil-tracking.hubera.cloud",
        "gasoil-tracking.delhomme.ovh",
    ],
    "names": ["Hubera Fuel"],
}


def load_allowlist() -> dict:
    code = (
        "import { fuelReleaseAllowlist } from './api/src/releaseIdentity.js';"
        "process.stdout.write(JSON.stringify(fuelReleaseAllowlist()));"
    )
    try:
        out = subprocess.check_output(
            ["node", "--input-type=module", "-e", code],
            cwd=ROOT,
            text=True,
        )
        data = json.loads(out)
        if data.get("packages") and data.get("hosts") and data.get("names"):
            return data
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError):
        pass
    return FALLBACK_ALLOW


def normalize_host(host: str) -> str:
    h = host.strip()
    if "://" in h:
        h = h.split("://", 1)[1]
    return h.split("/", 1)[0].lower()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("apk")
    p.add_argument(
        "--package",
        action="append",
        default=[],
        help="Paquet attendu (répétable). Doit être dans l’allowlist Fuel.",
    )
    p.add_argument("--host", default="", help="Hôte de publication, ex. fuel.hubera.cloud")
    p.add_argument("--app-name", default="", help="Nom d’app, ex. Hubera Fuel")
    p.add_argument("--version-code", required=True, type=int)
    p.add_argument("--version-name", required=True)
    p.add_argument("--cert-sha256", default=EXPECTED_CERT)
    args = p.parse_args()

    allow = load_allowlist()
    if APK is None:
        apk = AaptApk(args.apk)
    else:
        apk = APK(args.apk)
    errors: list[str] = []

    packages = allow["packages"]
    for req in args.package:
        if req not in packages:
            errors.append(f"package demandé {req!r} refusé (hors Fuel)")
    if apk.package not in packages:
        errors.append(f"package APK {apk.package!r} refusé")
    elif args.package and apk.package not in args.package:
        errors.append(f"package {apk.package!r} ≠ {args.package!r}")

    if args.host:
        host = normalize_host(args.host)
        if host not in allow["hosts"]:
            errors.append(f"hôte {host!r} refusé")
    if args.app_name and args.app_name not in allow["names"]:
        errors.append(f"nom d’app {args.app_name!r} refusé")
    try:
        vc = int(apk.version_code)
    except (TypeError, ValueError):
        vc = -1
        errors.append(f"versionCode illisible ({apk.version_code!r})")
    if vc != args.version_code:
        errors.append(
            f"versionCode APK={vc} ≠ attendu {args.version_code} "
            "(EAS remote a probablement écrasé app.json — OTA Android refuse le downgrade)"
        )
    if str(apk.version_name) != str(args.version_name):
        errors.append(f"versionName {apk.version_name!r} ≠ {args.version_name!r}")

    with zipfile.ZipFile(args.apk) as z:
        libs = {n.split("/")[1] for n in z.namelist() if n.startswith("lib/") and "/" in n[4:]}
    if "arm64-v8a" not in libs:
        errors.append(f"pas de lib/arm64-v8a (ABIs={sorted(libs)})")
    extra = libs - {"arm64-v8a"}
    if extra:
        errors.append(f"ABI en trop {sorted(extra)} (APK multi-ABI)")

    if isinstance(apk, AaptApk):
        sha = apk._cert_sha
        if not sha:
            errors.append("aucun certificat de signature")
        elif sha != args.cert_sha256.lower():
            errors.append(f"cert SHA-256 {sha} ≠ {args.cert_sha256}")
    else:
        certs = apk.get_certificates() or []
        if not certs:
            errors.append("aucun certificat de signature")
        else:
            der = certs[0].dump() if hasattr(certs[0], "dump") else bytes(certs[0])
            sha = hashlib.sha256(der).hexdigest()
            if sha != args.cert_sha256.lower():
                errors.append(f"cert SHA-256 {sha} ≠ {args.cert_sha256}")

    if errors:
        print("APK REFUSÉ :", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print(
        f"APK OK {apk.package} {apk.version_name} vc{vc} abi={sorted(libs)} cert={args.cert_sha256[:12]}…"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
