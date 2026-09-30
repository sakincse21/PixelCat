#!/usr/bin/env bash
# Run a throw-away nested GNOME Shell so you can test without logging out.
# Needs the extension installed first (./install.sh --link).
#
# GNOME 49+ uses --devkit (package name may vary: `dnf search mutter devkit`);
# older releases use --nested.
set -euo pipefail

if gnome-shell --help 2>&1 | grep -q -- '--devkit'; then
    exec dbus-run-session -- gnome-shell --devkit --wayland
else
    exec dbus-run-session -- gnome-shell --nested --wayland
fi
