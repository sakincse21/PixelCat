// Pixel Cat: a tiny companion that lives in a corner of the GNOME desktop.
//
// Lifecycle rule (required for a healthy shell): everything created in enable()
// must be removed in disable(): timers, idle watches, signal connections, actors.

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { Bubble, CatActor } from "./cat.js";
import { POINTER_POLL_MS } from "./constants.js";
import {
  ALERT_MESSAGES,
  clampPosition,
  cleanMessages,
  FED_MESSAGES,
  HUNGRY_MESSAGES,
  pickIndex,
  YAWN_MESSAGES,
} from "./logic.js";

export default class PixelCatExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._connections = [];
    this._lastMessage = -1;
    this._lastHungerMessage = -1;
    this._trackId = 0;
    this._repeatId = 0;
    this._watchIdle = 0;
    this._watchSleep = 0;
    this._watchActive = 0;
    this._dragging = false;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    this._stageEventId = 0;
    this._drowsy = false;
    this._yawnTimerId = 0;
    this._yawnCount = 0;
    this._hungerTimerId = 0;
    this._hungerRepeatId = 0;
    this._isHungry = false;

    this._getPointer = this._pointerGetter();
    this._idleMonitor = global.backend.get_core_idle_monitor();

    this._cat = new CatActor(this.path, this._settings);
    this._bubble = new Bubble();
    for (const actor of [this._cat, this._bubble]) {
      Main.layoutManager.addChrome(actor, {
        trackFullscreen: true, // hidden while a window is fullscreen
      });
    }

    this._connect(this._cat, "button-press-event", (actor, event) => {
      if (event.get_button() === 1) {
        const state = event.get_state();
        const hasMod = Boolean(
          state &
          (Clutter.ModifierType.MOD1_MASK |
            Clutter.ModifierType.SUPER_MASK |
            Clutter.ModifierType.MOD4_MASK),
        );
        if (hasMod) {
          const [px, py] = event.get_coords();
          this._startDrag(px, py);
          return Clutter.EVENT_STOP;
        }

        // Direct left-click feeds the cat when he is hungry / angry
        if (this._cat.isAngry && !this._dragging) {
          this._feedCat();
          return Clutter.EVENT_STOP;
        }
      }
      return Clutter.EVENT_PROPAGATE;
    });

    this._place();

    this._connect(this._settings, "changed::scale", () => {
      this._cat.applyScale();
      this._place();
    });
    for (const key of ["corner", "margin", "position-x", "position-y"])
      this._connect(this._settings, `changed::${key}`, () => this._place());
    for (const key of [
      "idle-minutes",
      "sleep-minutes",
      "sleep-seconds",
      "sleep-enabled",
      "yawn-enabled",
      "yawn-interval-seconds",
      "yawn-count",
    ])
      this._connect(this._settings, `changed::${key}`, () => this._armIdle());
    for (const key of ["hunger-minutes", "hunger-seconds", "hunger-enabled"])
      this._connect(this._settings, `changed::${key}`, () => this._armHunger());
    this._connect(this._settings, "changed::test-action", () => {
      this._handleTestAction(this._settings.get_string("test-action"));
    });
    this._connect(Main.layoutManager, "monitors-changed", () => this._place());

    this._startTracking();
    this._armIdle();
    this._armHunger();
  }

  disable() {
    this._stopDrag(false);
    this._stopTracking();
    this._stopRepeat();
    this._stopYawnTimer();
    this._disarmHunger();
    this._isHungry = false;
    this._disarmIdle(true);

    for (const [obj, id] of this._connections ?? []) obj.disconnect(id);
    this._connections = [];

    for (const name of ["_bubble", "_cat"]) {
      if (this[name]) {
        Main.layoutManager.removeChrome(this[name]);
        this[name].destroy();
        this[name] = null;
      }
    }

    this._settings = null;
    this._idleMonitor = null;
    this._getPointer = null;
    this._area = null;
  }

  // ---- placement ---------------------------------------------------------

  _place() {
    const area = Main.layoutManager.getWorkAreaForMonitor(
      Main.layoutManager.primaryIndex,
    );
    const posX = this._settings.get_int("position-x");
    const posY = this._settings.get_int("position-y");
    const w = this._cat.width;
    const h = this._cat.height;

    let x, y;
    if (posX >= 0 && posY >= 0) {
      const clamped = clampPosition(posX, posY, w, h, area);
      x = clamped.x;
      y = clamped.y;
    } else {
      const corner = this._settings.get_string("corner");
      const margin = this._settings.get_int("margin");
      x = corner.endsWith("left")
        ? area.x + margin
        : area.x + area.width - w - margin;
      y = corner.startsWith("top")
        ? area.y + margin
        : area.y + area.height - h - margin;
    }

    this._cat.set_position(Math.round(x), Math.round(y));
    this._area = area;
  }

  // ---- eye tracking & dragging -------------------------------------------

  /** global.get_pointer() where available, else the cursor tracker. Returns [x, y, mods]. */
  _pointerGetter() {
    if (typeof global.get_pointer === "function") {
      return () => {
        const [x, y, mods = 0] = global.get_pointer();
        return [x, y, mods];
      };
    }
    const tracker = global.backend.get_cursor_tracker();
    return () => {
      const [pos, mods = 0] = tracker.get_pointer();
      return [pos.x, pos.y, mods];
    };
  }

  _startTracking() {
    if (this._trackId) return;
    this._trackId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      POINTER_POLL_MS,
      () => {
        try {
          const [px, py, mods] = this._getPointer();
          this._onPointerPoll(px, py, mods);
        } catch (e) {
          console.error(`pixelcat: tracking failed: ${e}`);
        }
        return GLib.SOURCE_CONTINUE;
      },
    );
    GLib.Source.set_name_by_id(this._trackId, "[pixelcat] pointer tracking");
  }

  _stopTracking() {
    if (this._trackId) {
      GLib.Source.remove(this._trackId);
      this._trackId = 0;
    }
  }

  _onPointerPoll(px, py, mods) {
    const hasModifier = Boolean(
      mods &
      (Clutter.ModifierType.MOD1_MASK |
        Clutter.ModifierType.SUPER_MASK |
        Clutter.ModifierType.MOD4_MASK),
    );
    const isButton1Down = Boolean(mods & Clutter.ModifierType.BUTTON1_MASK);
    const { x, y, w, h } = this._cat.spriteRect;
    const isOverCat = px >= x && px < x + w && py >= y && py < y + h;

    if (this._dragging) {
      if (!isButton1Down) {
        this._stopDrag(true);
      } else {
        this._updateDrag(px, py);
      }
      return;
    }

    // Start drag if modifier + left button is pressed over the cat
    if (isOverCat && hasModifier && isButton1Down) {
      this._startDrag(px, py);
      return;
    }

    // When angry/hungry, cat is reactive so clicking directly feeds him;
    // or when modifier is held so drag can start. Normal clicks otherwise pass through.
    if ((isOverCat && hasModifier) || this._cat.isAngry) {
      if (!this._cat.reactive) this._cat.reactive = true;
    } else if (!this._dragging) {
      if (this._cat.reactive) this._cat.reactive = false;
    }

    this._cat.lookAt(px, py);
  }

  _startDrag(px, py) {
    if (this._dragging) return;
    this._dragging = true;
    const { x, y } = this._cat.spriteRect;
    this._dragOffsetX = px - x;
    this._dragOffsetY = py - y;

    this._cat.reactive = true;
    this._cat.setDragging(true);
    this._bubble.dismiss();

    if (!this._stageEventId) {
      this._stageEventId = global.stage.connect(
        "captured-event",
        (stage, event) => {
          const type = event.type();
          if (type === Clutter.EventType.MOTION) {
            const [cx, cy] = event.get_coords();
            this._updateDrag(cx, cy);
            return Clutter.EVENT_STOP;
          } else if (
            type === Clutter.EventType.BUTTON_RELEASE &&
            event.get_button() === 1
          ) {
            this._stopDrag(true);
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_PROPAGATE;
        },
      );
    }
  }

  _updateDrag(px, py) {
    const area =
      this._area ??
      Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    const targetX = px - this._dragOffsetX;
    const targetY = py - this._dragOffsetY;
    const clamped = clampPosition(
      targetX,
      targetY,
      this._cat.width,
      this._cat.height,
      area,
    );
    this._cat.set_position(clamped.x, clamped.y);
    this._cat.lookAt(px, py);
  }

  _stopDrag(save = true) {
    if (!this._dragging) return;
    this._dragging = false;

    if (this._stageEventId) {
      global.stage.disconnect(this._stageEventId);
      this._stageEventId = 0;
    }

    this._cat.setDragging(false);
    this._cat.reactive = false;

    if (save) {
      const [x, y] = this._cat.get_position();
      this._settings.set_int("position-x", Math.round(x));
      this._settings.set_int("position-y", Math.round(y));
    }
  }

  // ---- idle: messages and sleep -----------------------------------------

  _armIdle() {
    this._disarmIdle();
    const idleMs =
      Math.max(1, this._settings.get_uint("idle-minutes")) * 60_000;
    this._watchIdle = this._idleMonitor.add_idle_watch(idleMs, () =>
      this._onIdle(),
    );

    if (this._settings.get_boolean("sleep-enabled")) {
      const sleepSec = this._settings.get_uint("sleep-seconds");
      const sleepMs = Math.max(5, sleepSec) * 1000;
      this._watchSleep = this._idleMonitor.add_idle_watch(sleepMs, () =>
        this._onSleepIdle(),
      );
    }
  }

  _disarmIdle(includeActive = false) {
    if (!this._idleMonitor) return;
    const names = ["_watchIdle", "_watchSleep"];
    if (includeActive)
      // keep the wake-up watch when only re-arming
      names.push("_watchActive");
    for (const name of names) {
      if (this[name]) {
        this._idleMonitor.remove_watch(this[name]);
        this[name] = 0;
      }
    }
  }

  _armActive() {
    if (this._watchActive) return;
    this._watchActive = this._idleMonitor.add_user_active_watch(() => {
      this._watchActive = 0; // one-shot: already gone
      this._onActive();
    });
  }

  _onIdle() {
    this._armActive();
    if (!this._settings.get_boolean("messages-enabled")) return;
    this._say();
    this._stopRepeat();
    const every = Math.max(
      1,
      this._settings.get_uint("message-repeat-minutes"),
    );
    this._repeatId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      every * 60,
      () => {
        this._say();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _onSleepIdle() {
    this._armActive();
    this._stopRepeat(); // sleeping cats don't talk
    if (this._settings.get_boolean("yawn-enabled")) {
      this._startDrowsy();
    } else {
      this._enterFullSleep();
    }
  }

  _startDrowsy() {
    this._drowsy = true;
    this._yawnCount = 0;
    const maxYawns = Math.max(1, this._settings.get_uint("yawn-count"));
    const intervalSec = Math.max(
      2,
      this._settings.get_uint("yawn-interval-seconds"),
    );

    this._sayYawn();
    this._cat.playYawn();

    this._stopYawnTimer();
    this._yawnTimerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      intervalSec,
      () => {
        this._yawnCount++;
        if (this._yawnCount >= maxYawns) {
          this._stopYawnTimer();
          this._enterFullSleep();
          return GLib.SOURCE_REMOVE;
        }
        this._sayYawn();
        this._cat.playYawn();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _stopYawnTimer() {
    if (this._yawnTimerId) {
      GLib.Source.remove(this._yawnTimerId);
      this._yawnTimerId = 0;
    }
  }

  _enterFullSleep() {
    this._stopYawnTimer();
    this._drowsy = false;
    this._bubble.dismiss();
    this._cat.setSleeping(true);
    this._stopTracking();
  }

  _sayYawn() {
    const i = pickIndex(YAWN_MESSAGES.length, -1);
    this._bubble.pop(YAWN_MESSAGES[i], this._cat.spriteRect, this._area, 2000);
  }

  _sayAlert() {
    const i = pickIndex(ALERT_MESSAGES.length, -1);
    this._bubble.pop(ALERT_MESSAGES[i], this._cat.spriteRect, this._area, 2000);
  }

  _onActive() {
    this._stopRepeat();
    const wasDrowsy = this._drowsy;
    this._stopYawnTimer();
    this._drowsy = false;

    if (wasDrowsy) {
      this._cat.interruptYawn();
      this._sayAlert();
    } else {
      this._bubble.dismiss();
    }

    this._cat.setSleeping(false);

    if (this._isHungry) {
      this._cat.setAngry(true);
      this._startHungerRepeat();
      if (!wasDrowsy) {
        this._sayHungry();
      }
    }

    this._startTracking();
    this._armIdle();
  }

  _stopRepeat() {
    if (this._repeatId) {
      GLib.Source.remove(this._repeatId);
      this._repeatId = 0;
    }
  }

  _say() {
    if (this._cat.isAngry) {
      this._sayHungry();
      return;
    }
    const messages = cleanMessages(this._settings.get_strv("messages"));
    const i = pickIndex(messages.length, this._lastMessage);
    if (i < 0) return;
    this._lastMessage = i;
    this._bubble.pop(messages[i], this._cat.spriteRect, this._area);
  }

  // ---- hunger & feeding --------------------------------------------------

  _armHunger() {
    this._disarmHunger();
    this._isHungry = false;
    if (!this._settings.get_boolean("hunger-enabled")) {
      this._cat.setAngry(false);
      return;
    }
    const sec = Math.max(5, this._settings.get_uint("hunger-seconds"));
    this._hungerTimerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      sec,
      () => {
        this._hungerTimerId = 0;
        this._onHungry();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _handleTestAction(action) {
    if (!action) return;
    this._settings.set_string("test-action", "");

    if (action === "yawn") {
      this._stopYawnTimer();
      this._drowsy = true;
      this._sayYawn();
      this._cat.playYawn(() => {
        this._drowsy = false;
      });
    } else if (action === "hunger") {
      this._onHungry();
    } else if (action === "sleep") {
      this._enterFullSleep();
    } else if (action === "wake") {
      this._onActive();
    }
  }

  _disarmHunger() {
    if (this._hungerTimerId) {
      GLib.Source.remove(this._hungerTimerId);
      this._hungerTimerId = 0;
    }
    this._stopHungerRepeat();
  }

  _startHungerRepeat() {
    this._stopHungerRepeat();
    this._hungerRepeatId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      90,
      () => {
        if (this._isHungry && !this._cat.isSleeping) {
          this._sayHungry();
        }
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _stopHungerRepeat() {
    if (this._hungerRepeatId) {
      GLib.Source.remove(this._hungerRepeatId);
      this._hungerRepeatId = 0;
    }
  }

  _onHungry() {
    this._isHungry = true;
    if (this._cat.isSleeping) {
      // If sleeping, hunger will show when woke up in _onActive()
      return;
    }
    this._cat.setAngry(true);
    this._sayHungry();
    this._startHungerRepeat();
  }

  _sayHungry() {
    const i = pickIndex(HUNGRY_MESSAGES.length, this._lastHungerMessage);
    this._lastHungerMessage = i;
    this._bubble.pop(
      HUNGRY_MESSAGES[i],
      this._cat.spriteRect,
      this._area,
      4000,
    );
  }

  _feedCat() {
    this._isHungry = false;
    this._stopHungerRepeat();
    this._cat.feed(() => {
      this._armHunger();
    });
    const i = pickIndex(FED_MESSAGES.length, -1);
    this._bubble.pop(FED_MESSAGES[i], this._cat.spriteRect, this._area, 3000);
  }

  // ---- helpers -----------------------------------------------------------

  _connect(obj, signal, fn) {
    this._connections.push([obj, obj.connect(signal, fn)]);
  }
}
