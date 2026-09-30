// The cat itself (sprite layers, eye tracking, blinking, sleeping) and the speech bubble.

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Pango from "gi://Pango";
import St from "gi://St";

import { LAYERS, SCALES } from "./constants.js";
import { blinkDelay, bubblePosition, eyeOffset } from "./logic.js";

const BLINK_MS = 120; // how long the eyes stay closed
const DOUBLE_BLINK_CHANCE = 0.15;
const EYE_Y = 0.38; // eye height as a fraction of sprite height
const HOVER_OPACITY = 70; // 0-255, used when the pointer is over the cat

function loadSpriteMeta(extPath) {
  const file = Gio.File.new_for_path(`${extPath}/assets/sprite.json`);
  const [, bytes] = file.load_contents(null);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function nearestScale(wanted) {
  return SCALES.reduce((a, b) =>
    Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a,
  );
}

export const CatActor = GObject.registerClass(
  class PixelCatActor extends St.Widget {
    _init(extPath, settings) {
      super._init({
        layout_manager: new Clutter.FixedLayout(),
        reactive: false, // click-through
        style_class: "pixelcat",
      });

      this._extPath = extPath;
      this._settings = settings;
      this._meta = loadSpriteMeta(extPath);
      this._sources = new Set(); // every GLib timeout we own
      this._eyeDx = 0;
      this._eyeDy = 0;
      this._sleeping = false;
      this._faded = false;
      this._dragging = false;
      this._angry = false;
      this._yawning = false;
      this._eating = false;
      this._eatTimerId = 0;

      this._layers = {};
      for (const name of LAYERS) {
        const layer = new St.Widget({ reactive: false });
        this.add_child(layer);
        this._layers[name] = layer;
      }

      this.applyScale();
      this._showEyes("open");
      this._scheduleBlink();

      this.connect("destroy", () => this._onDestroy());
    }

    get spriteRect() {
      const [x, y] = this.get_transformed_position();
      return { x, y, w: this.width, h: this.height };
    }

    get isAngry() {
      return this._angry;
    }

    get isSleeping() {
      return this._sleeping;
    }

    get isYawning() {
      return this._yawning;
    }

    get isEating() {
      return this._eating;
    }

    /** (Re)load sprite images at the scale chosen in settings. */
    applyScale() {
      this._scale = nearestScale(this._settings.get_int("scale"));
      const w = this._meta.logical_width * this._scale;
      const h = this._meta.logical_height * this._scale;
      this.set_size(w, h);
      for (const [name, layer] of Object.entries(this._layers)) {
        const uri = GLib.filename_to_uri(
          `${this._extPath}/assets/x${this._scale}/${name}.png`,
          null,
        );
        layer.set_size(w, h);
        layer.set_position(0, 0);
        layer.style = `background-image: url("${uri}");`;
      }
      this._applyEyeOffset();
    }

    /** Point the pupils toward screen position (px, py). Called ~20x/s. */
    lookAt(px, py) {
      const { x, y, w, h } = this.spriteRect;
      this._updateHover(px, py, x, y, w, h);
      if (this._sleeping || this._yawning || this._eating || this._angry)
        return;

      const cx = x + w / 2;
      const cy = y + h * EYE_Y;
      const { dx, dy } = eyeOffset(px - cx, py - cy, this._meta.eye_room);
      if (dx !== this._eyeDx || dy !== this._eyeDy) {
        this._eyeDx = dx;
        this._eyeDy = dy;
        this._applyEyeOffset();
      }
    }

    setSleeping(sleeping) {
      if (sleeping === this._sleeping) return;
      this._sleeping = sleeping;
      this._yawning = false;
      this._stopEating();
      this._eyeDx = 0;
      this._eyeDy = 0;
      this._applyEyeOffset();
      this._showEyes("half");
      if (sleeping) {
        this._addTimeout(1800, () => {
          if (this._sleeping) this._showEyes("closed");
          return GLib.SOURCE_REMOVE;
        });
      } else {
        this._addTimeout(250, () => {
          if (!this._sleeping) this._showEyes(this._angry ? "angry" : "open");
          return GLib.SOURCE_REMOVE;
        });
      }
    }

    setAngry(angry) {
      if (this._angry === angry) return;
      this._angry = angry;
      if (this._sleeping || this._yawning || this._eating) return;
      if (angry) {
        this._eyeDx = 0;
        this._eyeDy = 0;
        this._applyEyeOffset();
        this._showEyes("angry");
        this.reactive = true;
      } else {
        this.reactive = false;
        this._showEyes("open");
      }
    }

    playYawn(onDone) {
      if (this._sleeping || this._eating) {
        if (onDone) onDone();
        return;
      }
      this._yawning = true;
      this._showEyes("yawn");
      this._addTimeout(1800, () => {
        this._yawning = false;
        if (!this._sleeping && !this._eating) {
          if (this._angry) this._showEyes("angry");
          else this._showEyes("half");
        }
        if (onDone) onDone();
        return GLib.SOURCE_REMOVE;
      });
    }

    interruptYawn() {
      this._yawning = false;
      this._sleeping = false;
      this._eyeDx = 0;
      this._eyeDy = 0;
      this._applyEyeOffset();
      this._showEyes(this._angry ? "angry" : "open");
    }

    feed(onDone) {
      this.reactive = false;
      this._eating = true;
      this._angry = false;
      this._yawning = false;
      this._stopEating();

      let step = 0;
      const totalSteps = 6;
      this._showEyes("eating_food");

      this._eatTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
        step++;
        if (step >= totalSteps || !this._eating) {
          this._stopEating();
          this._eating = false;
          this._showEyes("open");
          if (onDone) onDone();
          return GLib.SOURCE_REMOVE;
        }
        this._showEyes(step % 2 === 1 ? "eating_chew" : "eating_food");
        return GLib.SOURCE_CONTINUE;
      });
      this._sources.add(this._eatTimerId);
    }

    _stopEating() {
      if (this._eatTimerId) {
        GLib.Source.remove(this._eatTimerId);
        this._sources.delete(this._eatTimerId);
        this._eatTimerId = 0;
      }
    }

    setDragging(dragging) {
      if (this._dragging === dragging) return;
      this._dragging = dragging;
      if (dragging) {
        this.remove_all_transitions();
        this.opacity = 255;
      }
    }

    // ---- internals -------------------------------------------------------

    _applyEyeOffset() {
      // translation moves the layer without triggering a relayout
      this._layers.eyes_open.translation_x = this._eyeDx * this._scale;
      this._layers.eyes_open.translation_y = this._eyeDy * this._scale;
    }

    _showEyes(mode) {
      const isBaseCat = mode === "open" || mode === "closed" || mode === "half";
      this._layers.body.visible = isBaseCat;
      this._layers.eyes_open.visible = mode === "open";
      this._layers.eyes_closed.visible = mode === "closed";
      this._layers.eyes_half.visible = mode === "half";
      this._layers.cat_yawn.visible = mode === "yawn";
      this._layers.cat_angry.visible = mode === "angry";
      this._layers.cat_food.visible = mode === "eating_food";
      this._layers.cat_chew.visible = mode === "eating_chew";
    }

    _updateHover(px, py, x, y, w, h) {
      if (this._dragging) {
        if (this.opacity !== 255) {
          this.remove_all_transitions();
          this.opacity = 255;
        }
        return;
      }
      const over =
        this._settings.get_boolean("fade-on-hover") &&
        !this._angry &&
        !this._eating &&
        px >= x &&
        px < x + w &&
        py >= y &&
        py < y + h;
      if (over === this._faded) return;
      this._faded = over;
      this.remove_all_transitions();
      this.ease({
        opacity: over ? HOVER_OPACITY : 255,
        duration: 180,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }

    _scheduleBlink() {
      const delay = blinkDelay(
        this._settings.get_int("blink-min-ms"),
        this._settings.get_int("blink-max-ms"),
      );
      this._addTimeout(delay, () => {
        this._blinkOnce(() => {
          if (Math.random() < DOUBLE_BLINK_CHANCE)
            this._addTimeout(160, () => {
              this._blinkOnce(() => this._scheduleBlink());
              return GLib.SOURCE_REMOVE;
            });
          else this._scheduleBlink();
        });
        return GLib.SOURCE_REMOVE;
      });
    }

    _blinkOnce(done) {
      if (this._sleeping || this._eating || this._yawning || this._angry) {
        done();
        return;
      }
      this._showEyes("closed");
      this._addTimeout(BLINK_MS, () => {
        if (!this._sleeping && !this._eating && !this._yawning) {
          this._showEyes(this._angry ? "angry" : "open");
        }
        done();
        return GLib.SOURCE_REMOVE;
      });
    }

    _addTimeout(ms, fn) {
      const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(ms), () => {
        this._sources.delete(id);
        try {
          return fn();
        } catch (e) {
          console.error(`pixelcat: timer failed: ${e}`);
          return GLib.SOURCE_REMOVE;
        }
      });
      this._sources.add(id);
      return id;
    }

    _onDestroy() {
      this._stopEating();
      for (const id of this._sources) GLib.Source.remove(id);
      this._sources.clear();
    }
  },
);

export const Bubble = GObject.registerClass(
  class PixelCatBubble extends St.BoxLayout {
    _init() {
      super._init({
        style_class: "pixelcat-bubble",
        reactive: false, // click-through
        opacity: 0,
      });
      this._label = new St.Label({ style_class: "pixelcat-bubble-label" });
      this._label.clutter_text.line_wrap = true;
      this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
      this.add_child(this._label);

      this._hideId = 0;
      this._shown = false;
      this.connect("destroy", () => this._clearHideTimer());
    }

    get isShown() {
      return this._shown;
    }

    /**
     * Show `text` next to the cat.
     * rect: cat rectangle {x, y, w, h}; area: work area.
     */
    pop(text, rect, area, holdMs = 6000) {
      this._label.text = text;
      this._clearHideTimer();
      this.remove_all_transitions();

      const [, natW] = this.get_preferred_width(-1);
      const [, natH] = this.get_preferred_height(natW);

      const { x, y } = bubblePosition(rect, { w: natW, h: natH }, area, 4);
      this.set_position(x, y);

      this._shown = true;
      this.ease({
        opacity: 255,
        duration: 250,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
      this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, holdMs, () => {
        this._hideId = 0;
        this.dismiss();
        return GLib.SOURCE_REMOVE;
      });
    }

    dismiss() {
      this._clearHideTimer();
      if (!this._shown) return;
      this._shown = false;
      this.remove_all_transitions();
      this.ease({
        opacity: 0,
        duration: 250,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });
    }

    _clearHideTimer() {
      if (this._hideId) {
        GLib.Source.remove(this._hideId);
        this._hideId = 0;
      }
    }
  },
);
