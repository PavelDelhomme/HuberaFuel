#!/usr/bin/env bash
# Build APK release signé avec le keystore EAS (même cert que les installs utilisateurs).
# Refuse de publier un APK debug-signed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXPECTED_SHA256="${GASOIL_EXPECTED_CERT_SHA256:-13c3be90a99fb1a944bc5eedd782ae154ac4ab545bc4e92d53ba0040273ea5f2}"
PROPS="$ROOT/credentials/keystore.properties"
JKS="$ROOT/credentials/gasoil-release.jks"

# Variante prod utilisateurs par défaut (package cloud.hubera.fuel)
export APP_FLAVOR="${APP_FLAVOR:-prod}"
node "$ROOT/scripts/apply-android-flavor.cjs"

if [[ ! -f "$PROPS" || ! -f "$JKS" ]]; then
  echo "ERREUR: keystore EAS manquant ($PROPS / $JKS)"
  echo "Récupérer via: node scripts/fetch-eas-keystore.mjs"
  exit 1
fi

VERSION=$(node -p "require('./app.json').expo.version")
VERSION_CODE=$(node -p "require('./app.json').expo.android.versionCode")
sed -i "s/versionCode [0-9]*/versionCode ${VERSION_CODE}/" android/app/build.gradle
sed -i "s/versionName \"[^\"]*\"/versionName \"${VERSION}\"/" android/app/build.gradle

# Garantir signing release (pas debug)
if ! grep -q "signingConfig signingConfigs.release" android/app/build.gradle; then
  echo "ERREUR: android/app/build.gradle ne pointe pas vers signingConfigs.release"
  echo "Relancer prebuild avec le plugin withReleaseSigning, ou corriger à la main."
  exit 1
fi
if grep -q "release {" -A20 android/app/build.gradle | grep -q "signingConfig signingConfigs.debug"; then
  echo "ERREUR: release encore signé debug"
  exit 1
fi

echo "==> Assemble release $VERSION ($VERSION_CODE)"
cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
cd "$ROOT"

APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
echo "==> Vérif signature $APK"

CERT_SHA=""
find_apksigner() {
  if command -v apksigner >/dev/null 2>&1; then command -v apksigner; return; fi
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
  ls -1 "$sdk"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1
}
AS=$(find_apksigner || true)
if [[ -n "${AS:-}" ]]; then
  CERT_SHA=$("$AS" verify --print-certs "$APK" 2>/dev/null | grep -i 'SHA-256 digest' | head -1 | awk '{print $NF}' | tr -d ':' | tr 'A-F' 'a-f')
else
  TMP=$(mktemp -d)
  unzip -qq -o "$APK" "META-INF/*" -d "$TMP"
  CER=$(find "$TMP/META-INF" -type f \( -name '*.RSA' -o -name '*.DSA' -o -name '*.EC' \) | head -1)
  CERT_SHA=$(openssl pkcs7 -inform DER -in "$CER" -print_certs 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null \
    | awk -F= '{print tolower($2)}' | tr -d ':')
  # Detect debug CN
  if openssl pkcs7 -inform DER -in "$CER" -print_certs 2>/dev/null | grep -qi 'Android Debug'; then
    echo "REFUS: certificat Android Debug détecté"
    rm -rf "$TMP"
    exit 2
  fi
  rm -rf "$TMP"
fi

echo "SHA-256 cert APK: $CERT_SHA"
echo "SHA-256 attendu : $EXPECTED_SHA256"
if [[ "$CERT_SHA" != "$EXPECTED_SHA256" ]]; then
  echo "REFUS: signature incorrecte (probablement debug keystore). Ne pas publier."
  exit 2
fi

OUT="$ROOT/dist/gasoil-tracking-${VERSION}.apk"
mkdir -p "$ROOT/dist"
cp -f "$APK" "$OUT"
echo "OK APK prêt: $OUT"
