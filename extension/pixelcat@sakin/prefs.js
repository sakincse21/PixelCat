// Settings window (opens from the Extensions app). GTK4 + libadwaita.

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { CORNERS, SCALES } from "./constants.js";

const CORNER_LABELS = ["Bottom right", "Bottom left", "Top right", "Top left"];

export default class PixelCatPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    window._settings = settings; // keep alive as long as the window
    window.set_default_size(560, 760);

    const page = new Adw.PreferencesPage({
      title: "Pixel Cat",
      icon_name: "preferences-system-symbolic",
    });
    window.add(page);

    // ---- Appearance ------------------------------------------------
    const look = new Adw.PreferencesGroup({
      title: "Appearance",
      description:
        "Hold Super (Windows key) or Alt and drag to move the cat anywhere on screen.",
    });
    page.add(look);

    look.add(
      this._combo(
        settings,
        "scale",
        "Size",
        SCALES.map((s) => `${s}×`),
        SCALES,
        "int",
      ),
    );
    look.add(
      this._combo(
        settings,
        "corner",
        "Default corner",
        CORNER_LABELS,
        CORNERS,
        "string",
      ),
    );
    look.add(
      this._spin(settings, "margin", "Margin from corner (px)", 0, 400, 2),
    );

    const resetPosRow = new Adw.ActionRow({
      title: "Snap back to corner",
      subtitle: "Clear custom drag position and use corner placement",
    });
    const resetPosBtn = new Gtk.Button({
      label: "Reset",
      valign: Gtk.Align.CENTER,
    });
    resetPosBtn.connect("clicked", () => {
      settings.set_int("position-x", -1);
      settings.set_int("position-y", -1);
    });
    resetPosRow.add_suffix(resetPosBtn);
    look.add(resetPosRow);

    look.add(
      this._switch(
        settings,
        "fade-on-hover",
        "Fade when the pointer is over the cat",
        "The cat never blocks clicks; this only keeps it from hiding content.",
      ),
    );

    // ---- Sleep & Drowsiness -----------------------------------------
    const sleepGroup = new Adw.PreferencesGroup({
      title: "Sleep & Drowsiness",
      description:
        "Controls when the cat gets drowsy, yawns, and falls asleep. Any mouse movement wakes him up!",
    });
    page.add(sleepGroup);

    sleepGroup.add(
      this._switch(settings, "sleep-enabled", "Fall asleep when idle"),
    );
    sleepGroup.add(
      this._spin(
        settings,
        "sleep-seconds",
        "Fall asleep after (seconds idle)",
        5,
        7200,
        5,
        "Seconds of inactivity before sleeping. Try 5–15 seconds for quick testing!",
      ),
    );
    sleepGroup.add(
      this._switch(
        settings,
        "yawn-enabled",
        "Yawn when getting drowsy",
        "Plays cute yawning animations before falling asleep.",
      ),
    );
    sleepGroup.add(
      this._spin(
        settings,
        "yawn-interval-seconds",
        "Seconds between yawns",
        2,
        30,
        1,
      ),
    );
    sleepGroup.add(
      this._spin(
        settings,
        "yawn-count",
        "Number of yawns before deep sleep",
        1,
        10,
        1,
      ),
    );

    // ---- Hunger & Feeding ------------------------------------------
    const hungerGroup = new Adw.PreferencesGroup({
      title: "Hunger & Feeding",
      description:
        "When hungry, the cat displays an angry face 😾💢 until you click directly on him to feed a cookie treat.",
    });
    page.add(hungerGroup);

    hungerGroup.add(
      this._switch(settings, "hunger-enabled", "Cat gets hungry over time"),
    );
    hungerGroup.add(
      this._spin(
        settings,
        "hunger-seconds",
        "Gets hungry after (seconds)",
        5,
        7200,
        5,
        "Seconds before the cat gets hungry. Try 5–15 seconds for quick testing!",
      ),
    );

    // ---- Instant Test Actions --------------------------------------
    const testGroup = new Adw.PreferencesGroup({
      title: "Instant Test Actions",
      description:
        "Trigger animations and states immediately on screen without waiting for timers.",
    });
    page.add(testGroup);

    const testRow = new Adw.ActionRow({
      title: "Trigger state now",
      subtitle: "Click a button to test that state on screen immediately",
    });

    const testBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
      valign: Gtk.Align.CENTER,
    });

    const makeTestBtn = (label, action) => {
      const btn = new Gtk.Button({
        label,
        valign: Gtk.Align.CENTER,
      });
      btn.connect("clicked", () => {
        settings.set_string("test-action", action);
      });
      return btn;
    };

    testBox.append(makeTestBtn("🥱 Yawn", "yawn"));
    testBox.append(makeTestBtn("😾 Hungry", "hunger"));
    testBox.append(makeTestBtn("😴 Sleep", "sleep"));
    testBox.append(makeTestBtn("👀 Wake", "wake"));

    testRow.add_suffix(testBox);
    testGroup.add(testRow);

    // ---- Blinking --------------------------------------------------
    const blinkGroup = new Adw.PreferencesGroup({ title: "Blinking" });
    page.add(blinkGroup);

    blinkGroup.add(
      this._spin(
        settings,
        "blink-min-ms",
        "Blink: shortest gap (ms)",
        500,
        20000,
        100,
      ),
    );
    blinkGroup.add(
      this._spin(
        settings,
        "blink-max-ms",
        "Blink: longest gap (ms)",
        500,
        30000,
        100,
      ),
    );

    // ---- Messages --------------------------------------------------
    const msgs = new Adw.PreferencesGroup({
      title: "Messages",
      description: "One message per line. Keep them short (max 80 characters).",
    });
    page.add(msgs);

    const buffer = new Gtk.TextBuffer();
    const view = new Gtk.TextView({
      buffer,
      wrap_mode: Gtk.WrapMode.WORD_CHAR,
      top_margin: 8,
      bottom_margin: 8,
      left_margin: 10,
      right_margin: 10,
    });
    const scroller = new Gtk.ScrolledWindow({
      child: view,
      min_content_height: 180,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    const frame = new Gtk.Frame({ child: scroller });
    msgs.add(frame);

    const load = () => {
      buffer.set_text(settings.get_strv("messages").join("\n"), -1);
    };
    load();
    buffer.connect("changed", () => {
      const [start, end] = [buffer.get_start_iter(), buffer.get_end_iter()];
      const lines = buffer
        .get_text(start, end, false)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      settings.set_strv("messages", lines);
    });

    const reset = new Gtk.Button({
      label: "Restore default messages",
      halign: Gtk.Align.END,
      margin_top: 8,
    });
    reset.connect("clicked", () => {
      settings.reset("messages");
      load();
    });
    msgs.add(reset);
  }

  _switch(settings, key, title, subtitle = "") {
    const row = new Adw.SwitchRow({ title, subtitle });
    settings.bind(key, row, "active", Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  _spin(settings, key, title, lower, upper, step, subtitle = "") {
    const row = new Adw.SpinRow({
      title,
      subtitle,
      adjustment: new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: step * 5,
      }),
    });
    settings.bind(key, row, "value", Gio.SettingsBindFlags.DEFAULT);
    return row;
  }

  _combo(settings, key, title, labels, values, type) {
    const row = new Adw.ComboRow({
      title,
      model: Gtk.StringList.new(labels),
    });
    const read = () =>
      type === "int" ? settings.get_int(key) : settings.get_string(key);
    const write = (v) =>
      type === "int" ? settings.set_int(key, v) : settings.set_string(key, v);
    const idx = values.indexOf(read());
    row.selected = idx >= 0 ? idx : 0;
    row.connect("notify::selected", () => write(values[row.selected]));
    return row;
  }
}
