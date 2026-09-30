#!/usr/bin/env bash
# Install Pixel Cat for the current user.
#
#   ./install.sh          copy the extension into ~/.local/share/gnome-shell/extensions
#   ./install.sh --link   symlink instead (edit the repo, changes apply on next shell reload)
#
# Safe to re-run. Does not need root.
set -euo pipefail

UUID="pixelcat@sakin"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/extension/$UUID"
DEST_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
DEST="$DEST_ROOT/$UUID"
MODE="copy"; [[ "${1:-}" == "--link" ]] && MODE="link"

say()  { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

command -v gnome-shell >/dev/null || die "gnome-shell not found. This extension needs GNOME (Fedora Workstation)."
command -v glib-compile-schemas >/dev/null || die "glib-compile-schemas missing. Run: sudo dnf install glib2-devel"
[[ -f "$SRC/assets/sprite.json" ]] || die "sprite assets missing. Run: make assets   (needs: pip install -r tools/requirements.txt)"

# 1. make sure metadata.json lists the installed GNOME major version
SHELL_MAJOR="$(gnome-shell --version | grep -oE '[0-9]+' | head -1)"
say "Detected GNOME Shell $SHELL_MAJOR (session: ${XDG_SESSION_TYPE:-unknown})"
python3 - "$SRC/metadata.json" "$SHELL_MAJOR" <<'PY'
import json, sys
path, major = sys.argv[1], sys.argv[2]
meta = json.load(open(path))
if major not in meta["shell-version"]:
    meta["shell-version"].append(major)
    meta["shell-version"].sort(key=int)
    json.dump(meta, open(path, "w"), indent=2)
    open(path, "a").write("\n")
    print(f"    added GNOME {major} to metadata.json (untested version: report problems if any)")
PY

# 2. compile the settings schema
say "Compiling settings schema"
glib-compile-schemas --strict "$SRC/schemas"

# 3. install
mkdir -p "$DEST_ROOT"
rm -rf "$DEST"
if [[ "$MODE" == "link" ]]; then
    ln -s "$SRC" "$DEST"
    say "Linked  $DEST -> $SRC"
else
    cp -a "$SRC" "$DEST"
    say "Copied to $DEST"
fi

# 4. mark as enabled (takes effect after the shell reloads / you log in again)
if command -v gsettings >/dev/null; then
    if [[ "$(gsettings get org.gnome.shell disable-user-extensions 2>/dev/null)" == "true" ]]; then
        gsettings set org.gnome.shell disable-user-extensions false
    fi
    current="$(gsettings get org.gnome.shell enabled-extensions)"
    if [[ "$current" != *"'$UUID'"* ]]; then
        if [[ "$current" == "@as []" || "$current" == "[]" ]]; then
            new="['$UUID']"
        else
            new="${current%]}, '$UUID']"
        fi
        gsettings set org.gnome.shell enabled-extensions "$new"
        say "Added $UUID to enabled extensions"
    fi
fi

cat <<MSG

Installed.

Wayland cannot restart GNOME Shell in place, so:
  -> log out and log back in ONCE. The cat appears in the corner.

Afterwards:
  gnome-extensions prefs $UUID        # settings window
  make logs                           # watch shell logs while testing
  ./uninstall.sh                      # remove it

Want to try it without logging out?   make nested   (see README)
MSG
