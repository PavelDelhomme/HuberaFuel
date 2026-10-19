#!/usr/bin/env bash
# Upload APK prod signé vers /api/ci/releases (versionCode obligatoire).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
set -a
# charge .env
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" != *=* ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  val="${val%\"}"; val="${val#\"}"
  export "$key=$val"
done < .env
set +a

VERSION=$(node -p "require('./app.json').expo.version")
VERSION_CODE=$(node -p "require('./app.json').expo.android.versionCode")
APK="${1:-$ROOT/dist/gasoil-tracking-${VERSION}.apk}"
FORCE="${FORCE_UPDATE:-0}"
NOTES="${RELEASE_NOTES:-Correction OTA arm64 versionCode ${VERSION_CODE} (v${VERSION}).}"

if [[ ! -f "$APK" ]]; then
  echo "APK manquant: $APK — lancez ./scripts/build-release-apk.sh"
  exit 1
fi
: "${RELEASE_UPLOAD_TOKEN:?RELEASE_UPLOAD_TOKEN manquant dans .env}"

SIZE=$(wc -c < "$APK")
if [[ "$SIZE" -gt 80000000 ]]; then
  echo "REFUS local: APK trop gros ($SIZE) — multi-ABI ?"
  exit 2
fi

PKG=$(node -p "require('./app.json').expo.android.package")
NAME=$(node -p "require('./app.json').expo.name")
UPLOAD_PKG="$PKG"
if command -v python3 >/dev/null 2>&1; then
  VERIFY_OUT=$(python3 "$ROOT/scripts/verify-release-apk.py" "$APK" \
    --package "$PKG" \
    --package com.gasoiltracking.app \
    --host fuel.hubera.cloud \
    --app-name "$NAME" \
    --version-code "$VERSION_CODE" \
    --version-name "$VERSION")
  echo "$VERIFY_OUT"
  PARSED=$(printf '%s\n' "$VERIFY_OUT" | awk '/^APK OK / { print $3; exit }')
  if [[ -n "$PARSED" ]]; then
    UPLOAD_PKG="$PARSED"
  fi
fi

echo "==> Upload $APK (v$VERSION vc$VERSION_CODE force=$FORCE)"
curl -sf -X POST "https://gasoil-tracking.delhomme.ovh/api/ci/releases" \
  -H "x-release-token: $RELEASE_UPLOAD_TOKEN" \
  -F "apk=@${APK};filename=$(basename "$APK")" \
  -F "version=${VERSION}" \
  -F "versionCode=${VERSION_CODE}" \
  -F "packageName=${UPLOAD_PKG}" \
  -F "forceUpdate=${FORCE}" \
  -F "releaseNotes=${NOTES}" \
  | tee /tmp/gasoil-release-upload.json
echo
node -e "const j=require('/tmp/gasoil-release-upload.json'); if(!j.ok) process.exit(1); console.log('OK', j.version, 'vc', j.versionCode, j.apkSize, j.apkUrl)"
