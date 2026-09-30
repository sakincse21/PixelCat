#!/usr/bin/env bash
# Remove Pixel Cat for the current user.
set -euo pipefail

UUID="pixelcat@sakin"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

command -v gnome-extensions >/dev/null && gnome-extensions disable "$UUID" 2>/dev/null || true

if command -v gsettings >/dev/null; then
    current="$(gsettings get org.gnome.shell enabled-extensions)"
    if [[ "$current" == *"'$UUID'"* ]]; then
        new="$(python3 - "$current" "$UUID" <<'PY'
import ast, sys
items = ast.literal_eval(sys.argv[1].replace("@as ", ""))
print(repr([i for i in items if i != sys.argv[2]]))
PY
)"
        gsettings set org.gnome.shell enabled-extensions "$new"
    fi
fi

rm -rf "$DEST"
# per-user settings (dconf) are harmless leftovers; drop them too:
command -v dconf >/dev/null && dconf reset -f /org/gnome/shell/extensions/pixelcat/ || true
echo "Removed $UUID. Log out and in to unload it from a running session."
