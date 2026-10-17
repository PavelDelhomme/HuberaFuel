#!/usr/bin/env bash
# Build APK release pour une variante APP_FLAVOR (prod|preprod|dev|feat|qa|admin).
# Ex: ./scripts/build-flavor-apk.sh qa
#     APP_FLAVOR=admin ./scripts/build-flavor-apk.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FLAVOR="${1:-${APP_FLAVOR:-prod}}"
export APP_FLAVOR="$FLAVOR"

echo "==> Flavor $APP_FLAVOR"
node scripts/apply-android-flavor.cjs

# Aligne versionName / versionCode depuis app.json (source de vérité)
VERSION=$(node -p "require('./app.json').expo.version")
VERSION_CODE=$(node -p "require('./app.json').expo.android.versionCode")
sed -i "s/versionCode [0-9]*/versionCode ${VERSION_CODE}/" android/app/build.gradle
sed -i "s/versionName \"[^\"]*\"/versionName \"${VERSION}\"/" android/app/build.gradle

# Rebuild JS embed with correct expo extra (APP_FLAVOR)
# assembleRelease lit le binaire déjà généré ; forcer un clean du bundle RN
cd android
GRADLE_ARGS=(-PreactNativeArchitectures=arm64-v8a --no-daemon)
if [[ "$FLAVOR" == "prod" ]]; then
  GRADLE_ARGS+=(-PhuberaAppId=true)
fi
./gradlew :app:clean :app:assembleRelease "${GRADLE_ARGS[@]}"
cd "$ROOT"

# Vérif signature (même keystore EAS que prod)
EXPECTED_SHA256="${GASOIL_EXPECTED_CERT_SHA256:-13c3be90a99fb1a944bc5eedd782ae154ac4ab545bc4e92d53ba0040273ea5f2}"
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
if [[ ! -f "$APK" ]]; then
  echo "ERREUR: APK manquant $APK"
  exit 1
fi

find_apksigner() {
  if command -v apksigner >/dev/null 2>&1; then command -v apksigner; return; fi
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
  ls -1 "$sdk"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1
}
AS=$(find_apksigner || true)
CERT_SHA=""
if [[ -n "${AS:-}" ]]; then
  CERT_SHA=$("$AS" verify --print-certs "$APK" 2>/dev/null | grep -i 'SHA-256 digest' | head -1 | awk '{print $NF}' | tr -d ':' | tr 'A-F' 'a-f')
else
  TMP=$(mktemp -d)
  unzip -qq -o "$APK" "META-INF/*" -d "$TMP"
  CER=$(find "$TMP/META-INF" -type f \( -name '*.RSA' -o -name '*.DSA' -o -name '*.EC' \) | head -1)
  CERT_SHA=$(openssl pkcs7 -inform DER -in "$CER" -print_certs 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null \
    | awk -F= '{print tolower($2)}' | tr -d ':')
  rm -rf "$TMP"
fi

echo "SHA-256 cert APK: $CERT_SHA"
if [[ "$CERT_SHA" != "$EXPECTED_SHA256" ]]; then
  echo "REFUS: signature incorrecte"
  exit 2
fi

PKG=$(node -p "require('./lib/appFlavors').resolveFlavor(process.env.APP_FLAVOR).androidPackage")
OUT="$ROOT/dist/gasoil-tracking-${FLAVOR}-${VERSION}.apk"
mkdir -p "$ROOT/dist"
cp -f "$APK" "$OUT"
# Alias prod inchangé pour CI / download utilisateurs
if [[ "$FLAVOR" == "prod" ]]; then
  cp -f "$APK" "$ROOT/dist/gasoil-tracking-${VERSION}.apk"
fi

echo "OK APK: $OUT (package=$PKG)"
echo "JSON:$(node -p "JSON.stringify({ok:true,flavor:'$FLAVOR',version:'$VERSION',package:'$PKG',out:'$OUT'})")"
