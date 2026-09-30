UUID := pixelcat@sakin
EXT  := extension/$(UUID)

.PHONY: help assets check test schemas install link uninstall pack logs nested prefs clean

help:
	@echo "make assets     rebuild sprites (developer only, pre-built in extension/)"
	@echo "make check      syntax-check JS + run unit tests"
	@echo "make install    copy the extension into your user extensions dir"
	@echo "make link       symlink it instead (best while developing)"
	@echo "make logs       follow GNOME Shell logs (Ctrl+C to stop)"
	@echo "make nested     test in a nested shell, no logout needed"
	@echo "make prefs      open the settings window"
	@echo "make pack       build dist/$(UUID).shell-extension.zip"
	@echo "make uninstall  remove it"

assets:
	@if [ -f tools/build_reference_sprites.py ]; then \
		python3 tools/build_reference_sprites.py; \
	else \
		echo "Pre-built assets are already included in $(EXT)/assets"; \
	fi

schemas:
	glib-compile-schemas --strict $(EXT)/schemas

check:
	node tests/check-syntax.mjs
	node --test tests/*.test.js

test: check

install: schemas
	bash ./install.sh

link: schemas
	bash ./install.sh --link

uninstall:
	bash ./uninstall.sh

pack: schemas check
	mkdir -p dist
	gnome-extensions pack $(EXT) --force --out-dir dist \
		--extra-source=cat.js --extra-source=constants.js --extra-source=logic.js \
		--extra-source=assets

logs:
	journalctl -f -o cat /usr/bin/gnome-shell | grep --line-buffered -i -E "pixelcat|error|JS ERROR"

nested:
	bash ./dev-nested.sh

prefs:
	gnome-extensions prefs $(UUID)

clean:
	rm -rf dist $(EXT)/schemas/gschemas.compiled
