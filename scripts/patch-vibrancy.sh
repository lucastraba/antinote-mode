#!/usr/bin/env bash
# Patch Obsidian so vibrancy stays "active" when the window loses focus.
#
# Why: Electron reads `visualEffectState` once in the BrowserWindow
# constructor; Obsidian doesn't pass it, so the glass dims whenever the
# window is unfocused. There is no runtime setter — the only fix is adding
# the option to Obsidian's own window creation, which lives inside the
# versioned asar under ~/Library/Application Support/obsidian/.
#
# Obsidian UPDATES REPLACE that asar, deleting the patch. Re-run this
# script after every update, or pass --disable-updates to pin the version
# (you then update Obsidian manually by downloading a new installer).
#
# A .bak backup is written next to the asar. Requires node/npx.
set -euo pipefail

APPDIR="$HOME/Library/Application Support/obsidian"
ASAR=$(ls -t "$APPDIR"/obsidian-*.asar 2>/dev/null | head -1)
[ -n "$ASAR" ] || { echo "No obsidian-*.asar found in $APPDIR" >&2; exit 1; }
echo "Target: $ASAR"

# The main window's options. 1.15.0 has backgroundColor:"#00000000"; 1.15.1
# made it backgroundColor:F||"#00000000" with a minified variable name that
# can change on any release, so match it loosely.
PATTERN='(backgroundColor:(?:[A-Za-z_$][\w$]*\|\|)?"#00000000",)(trafficLightPosition:)'

if grep -q 'visualEffectState:"active"' "$ASAR"; then
  echo "Already patched."
else
  pgrep -xq Obsidian && { echo "Quit Obsidian first." >&2; exit 1; }
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  cp "$ASAR" "$ASAR.bak"
  echo "Backup: $ASAR.bak"
  npx --yes @electron/asar extract "$ASAR" "$TMP/app"
  python3 - "$TMP/app/main.js" "$PATTERN" <<'PY'
import re, sys
path, pattern = sys.argv[1:3]
src = open(path).read()
out, n = re.subn(pattern, r'\1visualEffectState:"active",\2', src, count=1)
if n != 1:
    sys.exit("Pattern not found: Obsidian changed; patch script needs updating.")
open(path, "w").write(out)
PY
  npx --yes @electron/asar pack "$TMP/app" "$ASAR"
  echo "Patched."
fi

if [ "${1:-}" = "--disable-updates" ]; then
  python3 - "$APPDIR/obsidian.json" <<'PY'
import json, sys
path = sys.argv[1]
cfg = json.load(open(path))
cfg["updateDisabled"] = True
json.dump(cfg, open(path, "w"), indent=2)
print("Auto-updates disabled (updateDisabled: true).")
PY
fi
