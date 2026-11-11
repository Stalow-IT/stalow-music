#!/usr/bin/env bash
# Makes the two files to upload for a Stalow Music update:
#   stalow-music.apk   (the new app)
#   stalow-music.json  (the update file the app checks)
# Usage: scripts/publish-update.sh "What changed in this version"
# Then upload both files to https://stalow.netlify.app/downloads/ (the downloads folder of the website).
set -euo pipefail
cd "$(dirname "$0")/.."
NOTES="${1:-}"
./gradlew :app:assembleRelease
APK=app/build/outputs/apk/release/app-release.apk
CODE=$(grep -E '^\s*versionCode = ' app/build.gradle.kts | head -1 | grep -oE '[0-9]+')
NAME=$(grep -E '^\s*versionName = ' app/build.gradle.kts | head -1 | sed -E 's/.*"(.*)".*/\1/')
mkdir -p release
cp "$APK" release/stalow-music.apk
SHA=$(sha256sum release/stalow-music.apk | cut -d' ' -f1)
SIZE=$(stat -c%s release/stalow-music.apk)
python3 - "$CODE" "$NAME" "$SHA" "$SIZE" "$NOTES" > release/stalow-music.json <<'PY'
import json, sys
code, name, sha, size, notes = sys.argv[1:6]
print(json.dumps({"versionCode": int(code), "versionName": name, "apk": "stalow-music.apk",
                  "sha256": sha, "size": int(size), "notes": notes}, ensure_ascii=False))
PY
echo "Ready in release/: stalow-music.apk and stalow-music.json (version $NAME, code $CODE)"
