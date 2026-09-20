// Game engine: state, simulation, rendering. Framework-agnostic.
import {
  ITEMS,
  BLOCK_DROP,
  MINE_REQ,
  OBJ_TALL,
  RECIPES,
  TIER_LEVEL,
  maxDurability,
  type ObjKind,
  type Tier,
  type Tile,
  type ToolType,
} from "./data";
import { InputMap } from "./input";
import { World, writeSave, type Layer, type WorldSave } from "./world";
import { drawGround, drawMob, drawObject, drawPlayer, preloadSprites } from "./sprites";

export interface Slot {
  id: string;
  n: number;
  /** uses left; only tools have it (missing on a tool means brand new) */
  dur?: number;
}
export type Slots = (Slot | null)[];

export interface Hud {
  hp: number;
  hunger: number;
  tod: number;
  night: boolean;
  day: number;
  slots: Slots;
  hotbar: number;
  invOpen: boolean;
  paused: boolean;
  dead: boolean;
  toast: string;
  held: Slot | null;
  mining: number;
  sleeping: boolean;
  /** x / y / z relative to where the player first spawned; z is 0 outside and negative in the caves */
  pos: { x: number; y: number; z: number };
}

type MobKind = "insect" | "hover" | "builder" | "corrupted" | "phantom" | "electric" | "creeper";

interface MobDef {
  hp: number;
  speed: number;
  range: number;
  dmg: number;
  hostile: boolean;
  drop?: { id: string; n: number };
  shoots?: boolean;
  explodes?: boolean;
  erratic?: boolean;
}

const MOBS: Record<MobKind, MobDef> = {
  insect: { hp: 10, speed: 1.1, range: 0, dmg: 0, hostile: false, drop: { id: "meat", n: 2 } },
  hover: { hp: 12, speed: 1.0, range: 0, dmg: 0, hostile: false, drop: { id: "meat", n: 2 } },
  builder: { hp: 10, speed: 1.1, range: 0, dmg: 0, hostile: false, drop: { id: "settings", n: 2 } },
  corrupted: { hp: 20, speed: 1.7, range: 11, dmg: 6, hostile: true },
  phantom: { hp: 24, speed: 1.5, range: 12, dmg: 5, hostile: true, shoots: true, drop: { id: "stick", n: 1 } },
  electric: { hp: 14, speed: 2.6, range: 12, dmg: 4, hostile: true, erratic: true },
  creeper: { hp: 18, speed: 1.5, range: 12, dmg: 22, hostile: true, explodes: true },
};

interface Mob {
  kind: MobKind;
  x: number;
  y: number;
  hp: number;
  vx: number;
  vy: number;
  wander: number;
  flee: number;
  cool: number;
  fuse: number;
  flash: boolean;
  hurt: number;
  bob: number;
  cave: boolean;
}

interface Arrow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const DAY_LEN = 300; // seconds per full day
const SPEED = 4.4;
const MAX_HP = 100;
const MAX_HUNGER = 100;
const INV_SIZE = 36;
/** z shown for the cave layer (the surface is 0) */
const CAVE_Z = -1;
/** how close (in tiles) the player must be to click a cave open */
const PORTAL_REACH = 2.5;

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private input = new InputMap();
  private raf = 0;
  private last = 0;
  private saveTimer = 0;
  private spawnTimer = 0;
  private toastTimer = 0;
  private starveFlash = 0;
  private portalCool = 0;
  /** tile the player first spawned on: coordinates are shown relative to it */
  private originX = 0;
  private originY = 0;

  world: World;
  difficulty: "easy" | "hard";
  saveId: string;

  x = 0.5;
  y = 0.5;
  dir: "up" | "down" | "left" | "right" = "down";
  hp = MAX_HP;
  hunger = MAX_HUNGER;
  time = 40;
  hurtFlash = 0;
  hitCool = 0;

  slots: Slots = new Array(INV_SIZE).fill(null);
  hotbar = 0;
  held: Slot | null = null;

  mobs: Mob[] = [];
  arrows: Arrow[] = [];
  booms: { x: number; y: number; t: number }[] = [];

  invOpen = false;
  paused = false;
  dead = false;
  sleeping = 0;
  toast = "";
  mining = 0;
  private miningKey = "";

  onHud: (h: Hud) => void = () => {};

  private surfaceChanges: Record<string, Tile> = {};
  private underChanges: Record<string, Tile> = {};

  constructor(canvas: HTMLCanvasElement, opts: { saveId: string; seed: number; difficulty: "easy" | "hard"; save: WorldSave | null }) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not available");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = true;
    preloadSprites();
    this.saveId = opts.saveId;
    this.difficulty = opts.difficulty;
    this.surfaceChanges = opts.save?.changes ?? {};
    this.underChanges = opts.save?.underChanges ?? {};
    const layer: Layer = opts.save?.layer ?? "surface";
    this.world = new World(opts.seed, layer === "under" ? this.underChanges : this.surfaceChanges, layer);

    if (opts.save) {
      this.x = opts.save.player.x;
      this.y = opts.save.player.y;
      this.hp = opts.save.player.hp;
      this.hunger = opts.save.player.hunger;
      this.time = opts.save.player.time;
      this.slots = opts.save.inv.slice(0, INV_SIZE).map((s) => (s ? this.restoreSlot(s) : null));
      while (this.slots.length < INV_SIZE) this.slots.push(null);
      this.hotbar = opts.save.hotbarIndex ?? 0;
      // worlds saved before coordinates existed have no origin: count from where the player is now
      this.originX = opts.save.origin?.x ?? Math.floor(this.x);
      this.originY = opts.save.origin?.y ?? Math.floor(this.y);
    } else {
      const spot = this.findSpawn();
      this.x = spot.x;
      this.y = spot.y;
      this.originX = Math.floor(spot.x);
      this.originY = Math.floor(spot.y);
      this.give("wood", 6);
      this.give("seeds", 3);
    }
  }

  // ---------- lifecycle ----------
  start() {
    this.input.attach(window);
    this.input.onPause = () => this.togglePause();
    this.input.onInventory = () => this.toggleInventory();
    this.canvas.addEventListener("pointerdown", this.onPointer);
    this.last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.update(dt);
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.input.detach(window);
    this.canvas.removeEventListener("pointerdown", this.onPointer);
    this.save();
  }

  /** rebuild a saved slot; tools from older saves (no durability yet) start out brand new */
  private restoreSlot(s: { id: string; n: number; dur?: number }): Slot {
    const slot: Slot = { id: s.id, n: s.n };
    const max = maxDurability(s.id);
    if (max !== undefined) slot.dur = typeof s.dur === "number" && s.dur > 0 ? Math.min(s.dur, max) : max;
    return slot;
  }

  /** player tile relative to the spawn origin; y grows upwards, z is 0 outside and negative in the caves */
  coords() {
    return {
      x: Math.floor(this.x) - this.originX,
      y: this.originY - Math.floor(this.y),
      z: this.world.layer === "under" ? CAVE_Z : 0,
    };
  }

  save() {
    const data: WorldSave = {
      seed: this.world.seed,
      difficulty: this.difficulty,
      changes: this.surfaceChanges,
      underChanges: this.underChanges,
      layer: this.world.layer,
      player: { x: this.x, y: this.y, hp: this.hp, hunger: this.hunger, time: this.time },
      inv: this.slots.map((s) => (s ? { ...s } : null)),
      hotbarIndex: this.hotbar,
      origin: { x: this.originX, y: this.originY },
    };
    writeSave(this.saveId, data);
  }

  /**
   * Cave entrances (surface) and exits (underground) are used on purpose: click / tap the
   * cave, or press use (Enter / Space / A) while facing or standing on it. Just walking
   * over one does nothing.
   */
  private usePortal(tx: number, ty: number) {
    if (this.portalCool > 0) return;
    const obj = this.world.get(tx, ty).obj;
    if (obj !== "cave_entrance" && obj !== "cave_exit") return;
    const down = obj === "cave_entrance";
    const layer: Layer = down ? "under" : "surface";
    this.world = new World(this.world.seed, down ? this.underChanges : this.surfaceChanges, layer);
    this.mobs = [];
    this.arrows = [];
    this.mining = 0;
    this.miningKey = "";
    // the exit below sits exactly under the entrance above, so both trips land on the portal tile
    this.x = tx + 0.5;
    this.y = ty + 0.5;
    this.portalCool = 0.4;
    this.say(down ? "You climb down into the caves" : "Back on the surface");
    this.save();
  }

  private tileSize() {
    return Math.max(26, Math.min(46, Math.round(Math.min(this.canvas.width, this.canvas.height) / 16)));
  }

  /** mouse click / screen tap on the canvas: open a cave if one was clicked and is within reach */
  private onPointer = (e: PointerEvent) => {
    if (this.paused || this.invOpen || this.dead || this.sleeping > 0) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const S = this.tileSize();
    // the canvas may be displayed at a different size than its pixel buffer
    const px = (e.clientX - rect.left) * (W / rect.width);
    const py = (e.clientY - rect.top) * (H / rect.height);
    const tx = Math.floor((px + this.x * S - W / 2) / S);
    const ty = Math.floor((py + this.y * S - H / 2) / S);
    const obj = this.world.get(tx, ty).obj;
    if (obj !== "cave_entrance" && obj !== "cave_exit") return;
    if (Math.hypot(tx + 0.5 - this.x, ty + 0.5 - this.y) > PORTAL_REACH) {
      this.say("Get closer to the cave");
      return;
    }
    this.usePortal(tx, ty);
  };

  private findSpawn() {
    for (let r = 0; r < 400; r++) {
      const x = Math.floor(Math.random() * 60) - 30;
      const y = Math.floor(Math.random() * 60) - 30;
      if (this.world.walkable(x, y) && !this.world.get(x, y).obj) return { x: x + 0.5, y: y + 0.5 };
    }
    return { x: 0.5, y: 0.5 };
  }

  // ---------- ui hooks ----------
  togglePause() {
    if (this.dead) return;
    this.paused = !this.paused;
    if (this.paused) this.save();
    this.input.clear();
    this.emit();
  }

  toggleInventory() {
    if (this.dead) return;
    this.invOpen = !this.invOpen;
    if (!this.invOpen && this.held) {
      this.give(this.held.id, this.held.n, this.held.dur);
      this.held = null;
    }
    this.input.clear();
    this.emit();
  }

  setHotbar(i: number) {
    this.hotbar = Math.max(0, Math.min(8, i));
    this.emit();
  }

  private say(msg: string) {
    this.toast = msg;
    this.toastTimer = 2.2;
    this.emit();
  }

  private emit() {
    this.onHud({
      hp: this.hp,
      hunger: this.hunger,
      tod: (this.time % DAY_LEN) / DAY_LEN,
      night: this.isNight(),
      day: Math.floor(this.time / DAY_LEN) + 1,
      slots: this.slots.map((s) => (s ? { ...s } : null)),
      hotbar: this.hotbar,
      invOpen: this.invOpen,
      paused: this.paused,
      dead: this.dead,
      toast: this.toast,
      held: this.held ? { ...this.held } : null,
      mining: this.mining,
      sleeping: this.sleeping > 0,
      pos: this.coords(),
    });
  }

  // ---------- inventory ----------
  give(id: string, n: number, dur?: number): boolean {
    const def = ITEMS[id];
    if (!def) return false;
    let left = n;
    for (let i = 0; i < INV_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.n < def.stack) {
        const add = Math.min(def.stack - s.n, left);
        s.n += add;
        left -= add;
      }
    }
    for (let i = 0; i < INV_SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(def.stack, left);
        const slot: Slot = { id, n: add };
        const max = maxDurability(id);
        if (max !== undefined) slot.dur = dur ?? max; // new tools start with full durability
        this.slots[i] = slot;
        left -= add;
      }
    }
    this.emit();
    return left === 0;
  }

  private countOf(id: string) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  private take(id: string, n: number) {
    let left = n;
    for (let i = 0; i < INV_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const t = Math.min(s.n, left);
        s.n -= t;
        left -= t;
        if (s.n <= 0) this.slots[i] = null;
      }
    }
  }

  clickSlot(i: number) {
    const s = this.slots[i] ?? null;
    if (this.held) {
      const def = ITEMS[this.held.id]!;
      if (s && s.id === this.held.id && s.n < def.stack) {
        const add = Math.min(def.stack - s.n, this.held.n);
        s.n += add;
        this.held.n -= add;
        if (this.held.n <= 0) this.held = null;
      } else {
        this.slots[i] = this.held;
        this.held = s;
      }
    } else if (s) {
      this.slots[i] = null;
      this.held = s;
    }
    this.emit();
  }

  dropHeld() {
    if (!this.held) return;
    this.held = null;
    this.say("Dropped item");
  }

  eatHeld(): void {
    const src = this.held;
    if (!src) return;
    const def = ITEMS[src.id];
    if (!def?.food) {
      this.say("That is not food");
      return;
    }
    if (this.hunger >= MAX_HUNGER) {
      this.say("Not hungry");
      return;
    }
    this.hunger = Math.min(MAX_HUNGER, this.hunger + def.food);
    src.n -= 1;
    if (src.n <= 0) this.held = null;
    this.say("Yum!");
  }

  craft(recipeId: string) {
    const r = RECIPES.find((x) => x.id === recipeId);
    if (!r) return;
    if (!r.need.every((n) => this.countOf(n.id) >= n.n)) {
      this.say("Missing materials");
      return;
    }
    r.need.forEach((n) => this.take(n.id, n.n));
    this.give(r.result, r.count);
    this.say(`Crafted ${ITEMS[r.result]?.name ?? r.result}`);
  }

  canCraft(recipeId: string) {
    const r = RECIPES.find((x) => x.id === recipeId);
    return !!r && r.need.every((n) => this.countOf(n.id) >= n.n);
  }

  countPublic(id: string) {
    return this.countOf(id);
  }

  /** spend one use of the selected tool if it is the given type; it breaks at 0 */
  private wear(type: ToolType) {
    const s = this.slots[this.hotbar];
    const def = s ? ITEMS[s.id] : undefined;
    if (!s || !def?.tool || def.tool.type !== type) return;
    s.dur = (s.dur ?? maxDurability(s.id) ?? 1) - 1;
    if (s.dur <= 0) {
      this.slots[this.hotbar] = null;
      this.mining = 0;
      this.miningKey = "";
      this.say(`Your ${def.name} broke!`);
    }
    this.emit();
  }

  private toolOf(type: ToolType): Tier | null {
    const s = this.slots[this.hotbar];
    if (!s) return null;
    const t = ITEMS[s.id]?.tool;
    return t && t.type === type ? t.tier : null;
  }

  // ---------- simulation ----------
  private isNight() {
    const tod = (this.time % DAY_LEN) / DAY_LEN;
    return tod > 0.72 || tod < 0.06;
  }

  private canStand(x: number, y: number) {
    const h = 0.32;
    const pts = [
      [x - h, y - h],
      [x + h, y - h],
      [x - h, y + h],
      [x + h, y + h],
    ];
    return pts.every((p) => this.world.walkable(Math.floor(p[0]!), Math.floor(p[1]!)));
  }

  private facing() {
    const dx = this.dir === "left" ? -1 : this.dir === "right" ? 1 : 0;
    const dy = this.dir === "up" ? -1 : this.dir === "down" ? 1 : 0;
    return { tx: Math.floor(this.x + dx * 0.85), ty: Math.floor(this.y + dy * 0.85) };
  }

  private update(dt: number) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toast = "";
        this.emit();
      }
    }

    const slot = this.input.consumeSlot();
    if (slot !== null) this.setHotbar(slot);

    if (this.sleeping > 0) {
      this.sleeping -= dt;
      if (this.sleeping <= 0) {
        // night runs from tod 0.72 into tod 0.06 of the next day: only roll over if we're in the evening half
        const evening = (this.time % DAY_LEN) / DAY_LEN > 0.5;
        this.time = (Math.floor(this.time / DAY_LEN) + (evening ? 1 : 0)) * DAY_LEN + 20;
        this.mobs = this.mobs.filter((m) => !MOBS[m.kind].hostile);
        this.say("Good morning!");
      }
      this.emit();
      return;
    }

    if (this.paused || this.invOpen || this.dead) {
      this.input.consumeUse();
      return;
    }

    this.time += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.hitCool > 0) this.hitCool -= dt;
    if (this.portalCool > 0) this.portalCool -= dt;

    // hunger + starvation
    this.hunger -= dt * (this.difficulty === "hard" ? 0.7 : 0.45);
    if (this.hunger <= 0) {
      this.hunger = 0;
      this.hp -= dt * 2.5;
      // starvation gets the same red damage pulse as a mob hit, about once a second
      this.starveFlash -= dt;
      if (this.starveFlash <= 0) {
        this.starveFlash = 1;
        this.hurtFlash = Math.max(this.hurtFlash, 0.35);
      }
    } else if (this.hp < MAX_HP && this.hunger > 70) {
      this.hp = Math.min(MAX_HP, this.hp + dt * 1.2);
    }

    // movement
    let mx = 0;
    let my = 0;
    if (this.input.held["up"]) my -= 1;
    if (this.input.held["down"]) my += 1;
    if (this.input.held["left"]) mx -= 1;
    if (this.input.held["right"]) mx += 1;
    if (mx || my) {
      if (my < 0) this.dir = "up";
      else if (my > 0) this.dir = "down";
      else if (mx < 0) this.dir = "left";
      else this.dir = "right";
      const len = Math.hypot(mx, my) || 1;
      const nx = this.x + (mx / len) * SPEED * dt;
      const ny = this.y + (my / len) * SPEED * dt;
      if (this.canStand(nx, this.y)) this.x = nx;
      if (this.canStand(this.x, ny)) this.y = ny;
    }

    this.useLogic(dt);
    this.updateCrops();
    this.updateMobs(dt);
    this.updateArrows(dt);
    this.booms = this.booms.filter((b) => (b.t -= dt) > 0);

    if (this.hp <= 0 && !this.dead) {
      this.hp = 0;
      this.dead = true;
      this.save();
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2;
      this.trySpawn();
    }

    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 6;
      this.save();
    }
    this.emit();
  }

  // ---------- mine / place / interact ----------
  private useLogic(dt: number) {
    const pressed = this.input.consumeUse();
    const holding = !!this.input.held["use"];
    const { tx, ty } = this.facing();
    const tile = this.world.get(tx, ty);
    const sel = this.slots[this.hotbar];
    const selDef = sel ? ITEMS[sel.id] : undefined;

    // attack a mob in front
    const target = this.mobs.find((m) => Math.abs(m.x - (tx + 0.5)) < 0.8 && Math.abs(m.y - (ty + 0.5)) < 0.8);
    if (holding && target) {
      if (this.hitCool <= 0) {
        this.hitCool = 0.45;
        const tier = this.toolOf("sword");
        const dmg = tier ? 4 + TIER_LEVEL[tier] * 3 : 3;
        target.hp -= dmg;
        this.wear("sword");
        target.hurt = 0.35;
        target.flee = 1.4;
        const away = Math.atan2(target.y - this.y, target.x - this.x);
        target.vx = Math.cos(away) * 3;
        target.vy = Math.sin(away) * 3;
        if (target.hp <= 0) {
          const d = MOBS[target.kind].drop;
          if (d) this.give(d.id, d.n);
          this.mobs = this.mobs.filter((m) => m !== target);
        }
      }
      this.mining = 0;
      return;
    }

    // go into / out of a cave: use on the cave in front of you, or on the one you're standing on
    if (pressed) {
      const px = Math.floor(this.x);
      const py = Math.floor(this.y);
      const here = this.world.get(px, py).obj;
      if (tile.obj === "cave_entrance" || tile.obj === "cave_exit") {
        this.usePortal(tx, ty);
        return;
      }
      if (here === "cave_entrance" || here === "cave_exit") {
        this.usePortal(px, py);
        return;
      }
    }

    // open / close a door
    if (pressed && (tile.obj === "door_closed" || tile.obj === "door_open")) {
      const open = tile.obj === "door_closed";
      this.world.set(tx, ty, { ...tile, obj: open ? "door_open" : "door_closed" });
      this.say(open ? "Door opened" : "Door closed");
      return;
    }

    // sleep in a sleeping tube
    if (pressed && (tile.obj === "bed" || tile.obj === "bed2")) {
      if (this.isNight()) {
        this.sleeping = 1.6;
        this.say("Sleeping...");
      } else this.say("You can only sleep at night");
      return;
    }

    // mining (hold)
    const mine = this.mineTarget(tile);
    if (holding && mine) {
      const k = tx + "," + ty;
      if (k !== this.miningKey) {
        this.miningKey = k;
        this.mining = 0;
      }
      this.mining += dt * mine.rate;
      if (this.mining >= 1) {
        this.mining = 0;
        this.breakTile(tx, ty, tile, mine);
      }
      return;
    }
    this.mining = 0;
    this.miningKey = "";

    if (!pressed) return;

    // hoe: till dirt/grass
    if (selDef?.tool?.type === "hoe" && (tile.t === "dirt" || tile.t === "grass") && !tile.obj) {
      this.world.set(tx, ty, { ...tile, t: "farmland" });
      this.say("Tilled soil");
      this.wear("hoe");
      return;
    }
    // plant seeds
    if (selDef?.seed && tile.t === "farmland" && !tile.obj) {
      this.world.set(tx, ty, { ...tile, obj: "crop0", pt: this.time });
      this.take(sel!.id, 1);
      this.say("Planted seeds");
      return;
    }
    // harvest crop
    if (tile.obj && tile.obj.startsWith("crop")) {
      const stage = parseInt(tile.obj.slice(4), 10);
      if (stage >= 3) {
        this.world.set(tx, ty, { ...tile, obj: undefined, pt: undefined });
        this.give("wheat", 1);
        this.give("seeds", 1);
        this.say("Harvested wheat");
      } else this.say("Not ripe yet");
      return;
    }
    // place the 2-tile sleeping tube
    if (pressed && selDef?.place === "bed" && !tile.obj && tile.t !== "water") {
      const nxt = this.world.get(tx + 1, ty);
      if (nxt.obj || nxt.t === "water") {
        this.say("Needs 2 free tiles");
        return;
      }
      this.world.set(tx, ty, { ...tile, obj: "bed" });
      this.world.set(tx + 1, ty, { ...nxt, obj: "bed2" });
      this.take(sel!.id, 1);
      return;
    }
    // place block
    if (selDef?.place && !tile.obj && tile.t !== "water") {
      this.world.set(tx, ty, { ...tile, obj: selDef.place });
      this.take(sel!.id, 1);
      return;
    }
    if (selDef?.food) {
      if (this.hunger >= MAX_HUNGER) this.say("Not hungry");
      else {
        this.hunger = Math.min(MAX_HUNGER, this.hunger + selDef.food);
        this.take(sel!.id, 1);
        this.say("Yum!");
      }
    }
  }

  private mineTarget(
    tile: Tile,
  ): { kind: "obj" | "ore" | "stone"; rate: number; drop: { id: string; n: number }; tool?: ToolType | undefined } | null {
    if (tile.obj) {
      if (tile.obj === "tree") {
        const tier = this.toolOf("axe");
        return {
          kind: "obj",
          rate: tier ? 0.8 + TIER_LEVEL[tier] * 0.5 : 0.35,
          drop: { id: "wood", n: 3 },
          tool: tier ? "axe" : undefined,
        };
      }
      if (tile.obj === "mountain") {
        const tier = this.toolOf("pickaxe");
        if (!tier) return null;
        return { kind: "obj", rate: 0.4 + TIER_LEVEL[tier] * 0.35, drop: { id: "stone", n: 3 }, tool: "pickaxe" };
      }
      // tall grass: nearly instant by hand, and the only wild source of seeds
      if (tile.obj === "tall_grass") return { kind: "obj", rate: 12, drop: { id: "seeds", n: 1 } };
      if (tile.obj.startsWith("block_")) {
        const id = BLOCK_DROP[tile.obj] ?? "dirt";
        return { kind: "obj", rate: 1.6, drop: { id, n: 1 } };
      }
      if (tile.obj === "bed" || tile.obj === "bed2") return { kind: "obj", rate: 1.6, drop: { id: "bed", n: 1 } };
      if (tile.obj === "door_closed" || tile.obj === "door_open") return { kind: "obj", rate: 1.6, drop: { id: "door", n: 1 } };
      return null;
    }
    if (tile.t === "stone") {
      const tier = this.toolOf("pickaxe");
      if (!tier) return null;
      const lvl = TIER_LEVEL[tier];
      const need = tile.ore ? MINE_REQ[tile.ore] : MINE_REQ.stone;
      if (lvl < need) return null;
      const drop = tile.ore ? { id: tile.ore, n: 1 } : { id: "stone", n: 1 };
      return { kind: tile.ore ? "ore" : "stone", rate: 0.35 + lvl * 0.3, drop, tool: "pickaxe" };
    }
    return null;
  }

  private breakTile(
    tx: number,
    ty: number,
    tile: Tile,
    mine: { kind: string; drop: { id: string; n: number }; tool?: ToolType | undefined },
  ) {
    if (mine.kind === "obj") {
      if (tile.obj === "bed" || tile.obj === "bed2") {
        for (const dx of [-1, 0, 1]) {
          const t2 = this.world.get(tx + dx, ty);
          if (t2.obj === "bed" || t2.obj === "bed2") this.world.set(tx + dx, ty, { ...t2, obj: undefined, pt: undefined });
        }
      }
      this.world.set(tx, ty, { ...tile, obj: undefined, pt: undefined });
    } else if (mine.kind === "ore") {
      this.world.set(tx, ty, { ...tile, ore: undefined });
    } else {
      this.world.set(tx, ty, { ...tile, t: "dirt", ore: undefined });
    }
    this.give(mine.drop.id, mine.drop.n);
    if (mine.tool) this.wear(mine.tool); // one use per block broken
  }

  private updateCrops() {
    for (const k in this.world.changes) {
      const t = this.world.changes[k]!;
      if (!t.obj || !t.obj.startsWith("crop") || t.pt === undefined) continue;
      const stage = Math.min(3, Math.floor((this.time - t.pt) / 25));
      const want = ("crop" + stage) as ObjKind;
      if (t.obj !== want) t.obj = want;
    }
  }

  // ---------- mobs ----------
  inCave(x = this.x, y = this.y) {
    return this.world.layer === "under" || this.world.get(Math.floor(x), Math.floor(y)).t === "cave";
  }


  private trySpawn() {
    const night = this.isNight() || this.inCave();
    const hostile = this.mobs.filter((m) => MOBS[m.kind].hostile).length;
    const passive = this.mobs.length - hostile;
    const maxHostile = night ? (this.difficulty === "hard" ? 12 : 6) : 0;
    const maxPassive = 8;
    const kinds: MobKind[] = night
      ? hostile < maxHostile
        ? ["corrupted", "phantom", "electric", "creeper"]
        : []
      : passive < maxPassive
        ? ["insect", "hover", "builder"]
        : [];
    if (!kinds.length) return;
    const kind = kinds[Math.floor(Math.random() * kinds.length)]!;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 11 + Math.random() * 6;
      const x = this.x + Math.cos(a) * r;
      const y = this.y + Math.sin(a) * r;
      if (this.world.walkable(Math.floor(x), Math.floor(y))) {
        this.mobs.push({
          kind,
          cave: this.inCave(x, y),
          x,
          y,
          hp: MOBS[kind].hp,
          vx: 0,
          vy: 0,
          wander: 0,
          flee: 0,
          cool: 0,
          fuse: 0,
          flash: false,
          hurt: 0,
          bob: Math.random() * 6.28,
        });
        return;
      }
    }
  }

  private updateMobs(dt: number) {
    const dmgScale = this.difficulty === "hard" ? 1.35 : 1;
    for (const m of this.mobs) {
      const d = MOBS[m.kind];
      const dx = this.x - m.x;
      const dy = this.y - m.y;
      const dist = Math.hypot(dx, dy);
      m.cool -= dt;
      m.bob += dt * 3.4;
      if (m.hurt > 0) m.hurt -= dt;
      m.flash = m.hurt > 0;

      if (m.flee > 0) {
        m.flee -= dt;
      } else if (d.hostile && dist < d.range) {
        if (d.explodes && dist < 1.8) {
          m.fuse += dt;
          m.flash = m.flash || Math.floor(m.fuse * 8) % 2 === 0;
          m.vx = 0;
          m.vy = 0;
          if (m.fuse > 1.5) {
            this.explode(m, d.dmg * dmgScale);
            continue;
          }
        } else if (d.shoots && dist < 8) {
          m.vx = (-dx / dist) * d.speed * 0.4;
          m.vy = (-dy / dist) * d.speed * 0.4;
          if (m.cool <= 0) {
            m.cool = 1.8;
            this.arrows.push({ x: m.x, y: m.y, vx: (dx / dist) * 8, vy: (dy / dist) * 8, life: 2.5 });
          }
        } else {
          let ax = dx / dist;
          let ay = dy / dist;
          if (d.erratic) {
            m.wander -= dt;
            if (m.wander <= 0) m.wander = 0.35;
            ax += Math.sin(this.time * 7 + m.x) * 0.6;
            ay += Math.cos(this.time * 6 + m.y) * 0.6;
          }
          m.vx = ax * d.speed;
          m.vy = ay * d.speed;
        }
      } else {
        m.wander -= dt;
        if (m.wander <= 0) {
          m.wander = 1 + Math.random() * 2;
          const a = Math.random() * Math.PI * 2;
          const go = Math.random() > 0.35;
          m.vx = go ? Math.cos(a) * d.speed * 0.6 : 0;
          m.vy = go ? Math.sin(a) * d.speed * 0.6 : 0;
        }
      }

      if (m.flee > 0) {
        // keep knockback / flight velocity, damped
        m.vx *= 0.94;
        m.vy *= 0.94;
      }

      const nx = m.x + m.vx * dt;
      const ny = m.y + m.vy * dt;
      if (this.world.walkable(Math.floor(nx), Math.floor(m.y))) m.x = nx;
      else m.vx = -m.vx;
      if (this.world.walkable(Math.floor(m.x), Math.floor(ny))) m.y = ny;
      else m.vy = -m.vy;

      if (d.hostile && !d.explodes && !d.shoots && dist < 0.9 && m.cool <= 0) {
        m.cool = 1;
        this.damage(d.dmg * dmgScale);
      }
      if (d.shoots && dist < 0.8 && m.cool <= 0) {
        m.cool = 1;
        this.damage(d.dmg * dmgScale * 0.6);
      }
    }
    if (!this.isNight()) {
      // cave dwellers survive daylight — their cave stays dark all day
      this.mobs = this.mobs.filter(
        (m) => !MOBS[m.kind].hostile || m.cave || this.inCave(m.x, m.y) || Math.hypot(m.x - this.x, m.y - this.y) < 6,
      );
    }
    this.mobs = this.mobs.filter((m) => Math.hypot(m.x - this.x, m.y - this.y) < 40);
  }

  private explode(m: Mob, dmg: number) {
    this.booms.push({ x: m.x, y: m.y, t: 0.5 });
    this.mobs = this.mobs.filter((o) => o !== m);
    // explosions hurt but never reshape the caves: underground nothing is destroyed at all,
    // and on the surface the cave entrance is always left standing
    if (this.world.layer !== "under") {
      for (let ox = -2; ox <= 2; ox++) {
        for (let oy = -2; oy <= 2; oy++) {
          if (ox * ox + oy * oy > 5) continue;
          const tx = Math.floor(m.x) + ox;
          const ty = Math.floor(m.y) + oy;
          const t = this.world.get(tx, ty);
          if (t.obj && t.obj !== "mountain" && t.obj !== "cave_entrance" && t.obj !== "cave_exit") {
            this.world.set(tx, ty, { ...t, obj: undefined, pt: undefined });
          }
        }
      }
    }
    const dist = Math.hypot(this.x - m.x, this.y - m.y);
    if (dist < 3) this.damage(dmg * (1 - dist / 3));
  }

  private updateArrows(dt: number) {
    for (const a of this.arrows) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.life -= dt;
      if (Math.hypot(a.x - this.x, a.y - this.y) < 0.5) {
        this.damage(this.difficulty === "hard" ? 7 : 5);
        a.life = 0;
      }
      if (!this.world.walkable(Math.floor(a.x), Math.floor(a.y))) a.life = 0;
    }
    this.arrows = this.arrows.filter((a) => a.life > 0);
  }

  private damage(n: number) {
    this.hp -= n;
    this.hurtFlash = 0.5;
  }

  respawn() {
    // dying in the caves must respawn on the surface, not at a random spot inside the rock
    if (this.world.layer !== "surface") {
      this.world = new World(this.world.seed, this.surfaceChanges, "surface");
    }
    const spot = this.findSpawn();
    this.x = spot.x;
    this.y = spot.y;
    this.hp = MAX_HP;
    this.hunger = MAX_HUNGER;
    this.dead = false;
    this.hurtFlash = 0;
    this.mobs = [];
    this.arrows = [];
    this.time = (Math.floor(this.time / DAY_LEN) + 1) * DAY_LEN + 20;
    this.save();
    this.emit();
  }

  // ---------- render ----------
  private render() {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const S = this.tileSize();
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#1b1b1f";
    c.fillRect(0, 0, W, H);

    const camX = this.x * S - W / 2;
    const camY = this.y * S - H / 2;
    const x0 = Math.floor(camX / S) - 1;
    const y0 = Math.floor(camY / S) - 1;
    const x1 = x0 + Math.ceil(W / S) + 3;
    const y1 = y0 + Math.ceil(H / S) + 3;

    // pass 1: ground
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.world.get(tx, ty);
        drawGround(c, t.t, t.ore, tx * S - camX, ty * S - camY, S, tx, ty);
      }
    }

    // facing highlight
    const f = this.facing();
    c.strokeStyle = "rgba(255,255,255,0.75)";
    c.lineWidth = 2;
    c.strokeRect(f.tx * S - camX + 1, f.ty * S - camY + 1, S - 2, S - 2);
    if (this.mining > 0) {
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(f.tx * S - camX + 2, f.ty * S - camY + S - 6, (S - 4) * Math.min(1, this.mining), 4);
    }

    // pass 2: tall things sorted by base Y
    type Draw = { baseY: number; fn: () => void };
    const draws: Draw[] = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.world.get(tx, ty);
        if (!t.obj) continue;
        const sx = tx * S - camX;
        const by = (ty + 1) * S - camY;
        const kind = t.obj;
        if (OBJ_TALL[kind]) draws.push({ baseY: by, fn: () => drawObject(c, kind, sx, by, S) });
        else drawObject(c, kind, sx, by, S);
      }
    }
    for (const m of this.mobs) {
      const sx = m.x * S - camX - S / 2;
      const by = m.y * S - camY + S * 0.35;
      const kind = m.kind;
      const flash = m.flash;
      const bob = m.bob;
      draws.push({ baseY: by, fn: () => drawMob(c, kind, sx, by, S, flash, bob) });
    }
    const psx = this.x * S - camX - S / 2;
    const pby = this.y * S - camY + S * 0.35;
    const pbob = this.time * 3.2;
    draws.push({ baseY: pby, fn: () => drawPlayer(c, psx, pby, S, this.dir, this.hurtFlash > 0, pbob) });
    draws.sort((a, b) => a.baseY - b.baseY);
    draws.forEach((d) => d.fn());

    // arrows
    c.fillStyle = "#e8e8e0";
    for (const a of this.arrows) c.fillRect(a.x * S - camX - 2, a.y * S - camY - 2, 5, 5);

    // explosions
    for (const b of this.booms) {
      c.fillStyle = `rgba(255,${Math.floor(180 * b.t * 2)},60,${b.t})`;
      const r = (0.6 - b.t) * 5 * S;
      c.beginPath();
      c.arc(b.x * S - camX, b.y * S - camY, Math.max(6, r), 0, Math.PI * 2);
      c.fill();
    }

    // day/night tint
    const tod = (this.time % DAY_LEN) / DAY_LEN;
    let dark = 0;
    if (tod > 0.62 && tod < 0.78) dark = (tod - 0.62) / 0.16;
    else if (tod >= 0.78 || tod < 0.04) dark = 1;
    else if (tod >= 0.04 && tod < 0.14) dark = 1 - (tod - 0.04) / 0.1;
    dark *= 0.62;
    if (this.sleeping > 0) dark = Math.max(dark, 1 - this.sleeping / 1.6 < 0.5 ? 0.95 : 0.95);
    if (dark > 0) {
      c.fillStyle = `rgba(6,10,40,${dark})`;
      c.fillRect(0, 0, W, H);
    }
    // cave darkness: only a small circle around the player is lit
    if (this.inCave()) {
      const cx = W / 2;
      const cy = H / 2;
      const lit = S * 3.4;
      const g = c.createRadialGradient(cx, cy, lit * 0.35, cx, cy, lit);
      g.addColorStop(0, "rgba(4,4,8,0)");
      g.addColorStop(0.65, "rgba(4,4,8,0.72)");
      g.addColorStop(1, "rgba(2,2,5,0.985)");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }

    if (this.hurtFlash > 0) {
      const a = Math.min(0.55, this.hurtFlash);
      const cx = W / 2;
      const cy = H / 2;
      const r = Math.max(W, H) * 0.75;
      const vg = c.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
      vg.addColorStop(0, `rgba(190,20,20,${a * 0.25})`);
      vg.addColorStop(1, `rgba(190,15,15,${a})`);
      c.fillStyle = vg;
      c.fillRect(0, 0, W, H);
    }
  }

  resize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
  }
}
