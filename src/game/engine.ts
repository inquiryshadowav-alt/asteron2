// Game engine: state, simulation, rendering. Framework-agnostic.
import {
  ITEMS,
  BLOCK_DROP,
  MINE_REQ,
  OBJ_TALL,
  RECIPES,
  BARE_HAND_DAMAGE,
  SWORD_DAMAGE,
  SWORD_HIT_COOLDOWN,
  TIER_LEVEL,
  TOOL_ATTACK_DAMAGE,
  TOOL_HIT_COOLDOWN,
  WRONG_TOOL_RATE,
  OLD_TOOL_USES,
  TOOLS_VERSION,
  maxDurability,
  type ObjKind,
  type Tier,
  type Tile,
  type ToolType,
} from "./data";
import {
  BOSS,
  BOSS_LOOT,
  BOSS_TURN_COOLDOWN,
  GHOST_RANGE,
  beamHits,
  bossFacing,
  ghostCycle,
  ghostWarning,
  lightningTile,
  pauseSeconds,
  pickMoves,
  snapDir8,
  type BossMove,
  type Facing,
} from "./boss";
import { InputMap } from "./input";
import { World, writeSave, type Layer, type WorldSave } from "./world";
import {
  drawBeam,
  drawBoss,
  drawCharge,
  drawGhostGlow,
  drawGround,
  drawLightningBolt,
  drawLightningWarning,
  drawMob,
  drawObject,
  drawPlayer,
  drawStormBurst,
  drawStormWarning,
  drawTorch,
  preloadSprites,
} from "./sprites";

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
  /** XP the player is carrying (zombies drop it; the Ghost Block costs it) */
  xp: number;
  /** the Stormcaller's health while it is fighting, otherwise null */
  boss: { hp: number; max: number } | null;
}

type MobKind = "insect" | "hover" | "builder" | "corrupted" | "phantom" | "electric" | "creeper" | "zombie";

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
  // hostile HP is set so each sword tier clearly changes the number of hits a fight takes
  // (see SWORD_DAMAGE): wood grinds it out, diamond drops most of them in half the swings.
  insect: { hp: 14, speed: 1.1, range: 0, dmg: 0, hostile: false, drop: { id: "meat", n: 2 } },
  hover: { hp: 14, speed: 1.0, range: 0, dmg: 0, hostile: false, drop: { id: "meat", n: 2 } },
  builder: { hp: 14, speed: 1.1, range: 0, dmg: 0, hostile: false, drop: { id: "settings", n: 2 } },
  corrupted: { hp: 48, speed: 1.7, range: 11, dmg: 6, hostile: true },
  phantom: { hp: 56, speed: 1.5, range: 12, dmg: 5, hostile: true, shoots: true, drop: { id: "stick", n: 1 } },
  electric: { hp: 38, speed: 2.6, range: 12, dmg: 4, hostile: true, erratic: true },
  creeper: { hp: 30, speed: 1.5, range: 12, dmg: 22, hostile: true, explodes: true },
  // slow, sturdy, and the only source of XP
  zombie: { hp: 40, speed: 1.35, range: 12, dmg: 7, hostile: true, drop: { id: "xp", n: 1 } },
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

/** the two colours of the pixel burst when each kind of mob dies */
const MOB_FX: Record<MobKind, [string, string]> = {
  insect: ["#6fbf3a", "#c9f27a"],
  hover: ["#7fd1ff", "#e6f7ff"],
  builder: ["#d9a441", "#f5e1a0"],
  corrupted: ["#7b3fa0", "#c084ff"],
  phantom: ["#6b7bd6", "#dfe4ff"],
  electric: ["#ffcf2e", "#fff7a0"],
  creeper: ["#3f8a2a", "#9be25a"],
  zombie: ["#4f8a3a", "#b9f27a"],
};

/** a square pixel of a visual effect; x / y are in world tiles */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  /** size in 1/16ths of a tile */
  size: number;
  /** extra size gained over its life (smoke puffs swell) */
  grow: number;
  color: string;
}

interface Arrow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

type BossState = "emerge" | "pause" | "approach" | "windup" | "recover";

/** the Stormcaller: one at a time, summoned by a Ghost Block, hunting the player who placed it */
interface Boss {
  x: number;
  y: number;
  hp: number;
  max: number;
  state: BossState;
  /** seconds left in the current state */
  t: number;
  /** the move being prepared or dashed toward */
  move: BossMove | null;
  /** moves still to run in the current pair */
  queue: BossMove[];
  hurt: number;
  bob: number;
  /** which skin it wears: it looks the way it moves, and at the player while it aims */
  face: Facing;
  /** seconds until it is allowed to turn again */
  turn: number;
}

/** a laser that has just fired: a fixed line, so it never follows the player */
interface Beam {
  x: number;
  y: number;
  dx: number;
  dy: number;
  life: number;
  hit: boolean;
}

/** lightning: a warning on a tile, then the strike */
interface Bolt {
  tx: number;
  ty: number;
  /** seconds until it lands */
  warn: number;
  /** seconds the bolt stays visible after landing (0 while still warning) */
  strike: number;
  seed: number;
}

/** a full day is 7 minutes of daylight followed by 7 minutes of night */
export const DAY_LEN = 840;
/** fraction of the day at which night begins: day and night are exactly equal */
const NIGHT_START = 0.5;
/** where in a fresh day the morning sits: the world wakes up here after sleeping or respawning */
export const MORNING = DAY_LEN * 0.1;

/**
 * How dark it is (0 = bright, 1 = darkest) at a time of day (0..1). Dusk builds up around the moment
 * night begins and dawn fades out around the moment it ends, so both halves feel the same.
 */
export function darknessAt(tod: number): number {
  if (tod < 0.08) return 1 - (tod + 0.08) / 0.16; // the tail of dawn
  if (tod < 0.42) return 0;
  if (tod < 0.58) return (tod - 0.42) / 0.16; // dusk
  if (tod < 0.92) return 1;
  return 1 - (tod - 0.92) / 0.16; // dawn begins
}

/** how far (in tiles) a torch lights up its surroundings, and keeps monsters from spawning */
export const TORCH_RADIUS = 5;
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
  time = MORNING;
  hurtFlash = 0;
  hitCool = 0;

  slots: Slots = new Array(INV_SIZE).fill(null);
  hotbar = 0;
  held: Slot | null = null;

  mobs: Mob[] = [];
  boss: Boss | null = null;
  beams: Beam[] = [];
  bolts: Bolt[] = [];
  /** Storm Blast shockwaves, for drawing */
  bursts: { x: number; y: number; t: number }[] = [];
  /** knockback the player is still carrying, in tiles per second */
  kx = 0;
  ky = 0;
  /** the pulse cycle each Ghost Block was last seen in, so a summon fires exactly once per pulse */
  private ghostSeen = new Map<string, number>();
  private flameAcc = 0;
  arrows: Arrow[] = [];
  booms: { x: number; y: number; t: number }[] = [];
  particles: Particle[] = [];
  private lightCv: HTMLCanvasElement | null = null;

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
      // tools saved under an older durability table keep the same amount of wear
      const fromVersion = opts.save.toolsV ?? 1;
      this.slots = opts.save.inv.slice(0, INV_SIZE).map((s) => (s ? this.restoreSlot(s, fromVersion) : null));
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
  private restoreSlot(s: { id: string; n: number; dur?: number }, fromVersion = TOOLS_VERSION): Slot {
    const slot: Slot = { id: s.id, n: s.n };
    const max = maxDurability(s.id);
    const tier = ITEMS[s.id]?.tool?.tier;
    if (max !== undefined && tier) {
      let dur = typeof s.dur === "number" && s.dur > 0 ? s.dur : max;
      const old = fromVersion < TOOLS_VERSION ? OLD_TOOL_USES[fromVersion] : undefined;
      if (old && typeof s.dur === "number") dur += max - old[tier];
      slot.dur = Math.max(1, Math.min(dur, max));
    }
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
      toolsV: TOOLS_VERSION,
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
    this.clearBoss();
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
      xp: this.countOf("xp"),
      boss: this.boss ? { hp: this.boss.hp, max: this.boss.max } : null,
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
    return tod >= NIGHT_START;
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
        // night is the second half of a day, so sleeping always wakes up in the next day's morning
        this.time = (Math.floor(this.time / DAY_LEN) + 1) * DAY_LEN + MORNING;
        this.mobs = this.mobs.filter((m) => !MOBS[m.kind].hostile);
        this.ghostSeen.clear(); // the clock jumped ahead: a Ghost Block must not fire for every pulse slept through
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

    // knockback (Storm Blast): slides the player away, stopped by walls, fading fast
    if (this.kx || this.ky) {
      const nx = this.x + this.kx * dt;
      const ny = this.y + this.ky * dt;
      if (this.canStand(nx, this.y)) this.x = nx;
      else this.kx = 0;
      if (this.canStand(this.x, ny)) this.y = ny;
      else this.ky = 0;
      const decay = Math.max(0, 1 - 5 * dt);
      this.kx = Math.abs(this.kx * decay) < 0.05 ? 0 : this.kx * decay;
      this.ky = Math.abs(this.ky * decay) < 0.05 ? 0 : this.ky * decay;
    }

    this.useLogic(dt);
    this.updateCrops();
    this.updateGhosts();
    this.updateBoss(dt);
    this.updateMobs(dt);
    this.updateArrows(dt);
    this.booms = this.booms.filter((b) => (b.t -= dt) > 0);
    this.updateParticles(dt);

    if (this.hp <= 0 && !this.dead) {
      this.hp = 0;
      this.dead = true;
      this.clearBoss(); // the fight resets when the player falls
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
    // the Stormcaller is big: any swing at the tile in front that lands inside its body counts
    const bossTarget =
      this.boss && this.boss.state !== "emerge" && Math.hypot(this.boss.x - (tx + 0.5), this.boss.y - (ty + 0.5)) < 1.7 ? this.boss : null;
    if (holding && (target || bossTarget)) {
      if (this.hitCool <= 0) {
        // a sword (or bare fists) swings at normal speed; a pickaxe, axe or hoe is a slow, weak
        // substitute — good for a job, bad for a fight
        const heldTool = selDef?.tool;
        const sword = heldTool?.type === "sword" ? heldTool.tier : undefined;
        const dmg = sword ? SWORD_DAMAGE[sword] : heldTool ? TOOL_ATTACK_DAMAGE[heldTool.tier] : BARE_HAND_DAMAGE;
        this.hitCool = heldTool && !sword ? TOOL_HIT_COOLDOWN : SWORD_HIT_COOLDOWN;
        if (target) target.hp -= dmg;
        else if (bossTarget) bossTarget.hp -= dmg;
        if (sword) this.wear("sword");
        else if (heldTool) this.wear(heldTool.type);
        if (target) {
          target.hurt = 0.35;
          target.flee = 1.4;
          const away = Math.atan2(target.y - this.y, target.x - this.x);
          target.vx = Math.cos(away) * 3;
          target.vy = Math.sin(away) * 3;
          if (target.hp <= 0) this.killMob(target);
        } else if (bossTarget) {
          bossTarget.hurt = 0.25; // a flash, no knockback: it does not flinch
          if (bossTarget.hp <= 0) this.killBoss();
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
      if (this.boss) this.say("You can't sleep while the Stormcaller is here");
      else if (this.isNight()) {
        this.sleeping = 1.6;
        this.say("Sleeping...");
      } else this.say("You can only sleep at night");
      return;
    }

    // the Ghost Block never breaks: nothing mines it, blasts it, or picks it up
    if (pressed && tile.obj === "ghost_block") {
      this.say("The Ghost Block cannot be broken");
      return;
    }

    // eating always wins over whatever is in front of the player (a block, a crop, water, bare
    // ground...) so a food item in hand never gets stuck trying to mine or harvest instead
    if (pressed && selDef?.food) {
      if (this.hunger >= MAX_HUNGER) this.say("Not hungry");
      else {
        this.hunger = Math.min(MAX_HUNGER, this.hunger + selDef.food);
        this.take(sel!.id, 1);
        this.say("Yum!");
      }
      this.mining = 0;
      this.miningKey = "";
      return;
    }

    // mining (hold)
    // torches: stand one on open ground or mount it on a block / wall. This comes before mining so a
    // torch in hand goes onto a block instead of chipping it away.
    if (selDef?.torch && this.canPlaceTorch(tile)) {
      if (pressed) {
        this.world.set(tx, ty, { ...tile, torch: true });
        this.take(sel!.id, 1);
      }
      this.mining = 0;
      return;
    }

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
      if (selDef.place === "ghost_block") {
        if (this.world.layer !== "surface") {
          this.say("The Ghost Block only works on the surface");
          return;
        }
        // pt remembers when it was placed: its pulse cycle counts from here
        this.world.set(tx, ty, { ...tile, obj: "ghost_block", pt: this.time });
        this.take(sel!.id, 1);
        this.say("The Ghost Block hums... something is coming");
        return;
      }
      this.world.set(tx, ty, { ...tile, obj: selDef.place });
      this.take(sel!.id, 1);
    }
  }

  /** torches go on open ground or on a block / wall; never on water, trees, ores, crops, doors, beds or cave mouths */
  private canPlaceTorch(tile: Tile): boolean {
    if (tile.torch || tile.ore || tile.t === "water") return false;
    return tile.obj === undefined || tile.obj.startsWith("block_");
  }

  /** is a torch lighting this spot (within r tiles)? */
  private nearTorch(x: number, y: number, r: number): boolean {
    for (const k of this.world.torches) {
      const [tx, ty] = k.split(",");
      if (Math.hypot(Number(tx) + 0.5 - x, Number(ty) + 0.5 - y) <= r) return true;
    }
    return false;
  }

  /** a mob dies: it drops its loot and pops in a burst of pixels */
  private killMob(m: Mob) {
    const d = MOBS[m.kind].drop;
    if (d) this.give(d.id, d.n);
    if (d?.id === "xp") this.say(`+${d.n} XP`);
    this.mobs = this.mobs.filter((o) => o !== m);
    this.deathFx(m);
  }

  private deathFx(m: Mob) {
    const [a, b] = MOB_FX[m.kind];
    const r = Math.random;
    // shards of the mob's own colours
    for (let i = 0; i < 14; i++) {
      const ang = r() * Math.PI * 2;
      const sp = 1.6 + r() * 2.6;
      const max = 0.5 + r() * 0.35;
      this.particles.push({
        x: m.x,
        y: m.y - 0.1,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 0.6,
        life: max,
        max,
        size: 2 + Math.floor(r() * 2),
        grow: 0,
        color: i % 3 === 0 ? b : a,
      });
    }
    // a few puffs of grey smoke that swell and drift up
    for (let i = 0; i < 6; i++) {
      const max = 0.7 + r() * 0.3;
      this.particles.push({
        x: m.x + (r() - 0.5) * 0.5,
        y: m.y + (r() - 0.5) * 0.3,
        vx: (r() - 0.5) * 0.6,
        vy: -0.5 - r() * 0.6,
        life: max,
        max,
        size: 3,
        grow: 4,
        color: i % 2 ? "#e9e9f0" : "#b8b8c6",
      });
    }
    // a quick white sparkle cross
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      this.particles.push({ x: m.x, y: m.y, vx: dx * 5, vy: dy * 5, life: 0.22, max: 0.22, size: 3, grow: 0, color: "#ffffff" });
    }
  }

  private updateParticles(dt: number) {
    if (!this.particles.length) return;
    const drag = Math.max(0, 1 - 2.2 * dt);
    this.particles = this.particles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dt;
      return p.life > 0;
    });
  }

  private mineTarget(
    tile: Tile,
  ): { kind: "obj" | "ore" | "stone" | "torch"; rate: number; drop: { id: string; n: number }; tool?: ToolType | undefined } | null {
    if (tile.torch) {
      // a torch comes off first; with a torch in hand nothing is mined, so a held key can't undo a placement
      const held = this.slots[this.hotbar];
      if (held && ITEMS[held.id]?.torch) return null;
      return { kind: "torch", rate: 12, drop: { id: "torch", n: 1 } };
    }
    if (tile.obj) {
      if (tile.obj === "tree") {
        const tier = this.toolOf("axe");
        if (tier) return { kind: "obj", rate: 0.8 + TIER_LEVEL[tier] * 0.5, drop: { id: "wood", n: 3 }, tool: "axe" };
        // a pickaxe, sword or hoe is clumsy on wood: slower than just using your hands
        const heldFor = this.slots[this.hotbar];
        const wrongTool = heldFor ? ITEMS[heldFor.id]?.tool : undefined;
        return { kind: "obj", rate: wrongTool ? WRONG_TOOL_RATE : 0.35, drop: { id: "wood", n: 3 }, tool: wrongTool?.type };
      }
      if (tile.obj === "mountain") {
        const tier = this.toolOf("pickaxe");
        if (tier) return { kind: "obj", rate: 0.4 + TIER_LEVEL[tier] * 0.35, drop: { id: "stone", n: 3 }, tool: "pickaxe" };
        const heldFor = this.slots[this.hotbar];
        const wrongTool = heldFor ? ITEMS[heldFor.id]?.tool : undefined;
        return { kind: "obj", rate: WRONG_TOOL_RATE, drop: { id: "stone", n: 3 }, tool: wrongTool?.type };
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
      const need = tile.ore ? MINE_REQ[tile.ore] : MINE_REQ.stone;
      if (tier && TIER_LEVEL[tier] >= need) {
        const drop = tile.ore ? { id: tile.ore, n: 1 } : { id: "stone", n: 1 };
        return { kind: tile.ore ? "ore" : "stone", rate: 0.35 + TIER_LEVEL[tier] * 0.3, drop, tool: "pickaxe" };
      }
      // ore always needs a proper pickaxe of the right tier; plain stone can still be chipped away
      // slowly with anything else (or bare hands) instead of being flatly impossible
      if (tile.ore) return null;
      const heldFor = this.slots[this.hotbar];
      const wrongTool = heldFor ? ITEMS[heldFor.id]?.tool : undefined;
      return { kind: "stone", rate: WRONG_TOOL_RATE, drop: { id: "stone", n: 1 }, tool: wrongTool?.type };
    }
    return null;
  }

  private breakTile(
    tx: number,
    ty: number,
    tile: Tile,
    mine: { kind: string; drop: { id: string; n: number }; tool?: ToolType | undefined },
  ) {
    if (mine.kind === "torch") {
      this.world.set(tx, ty, { ...tile, torch: undefined });
      this.give("torch", 1);
      return;
    }
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
        ? ["corrupted", "phantom", "electric", "creeper", "zombie", "zombie"] // zombies are twice as common: XP is the gate to the boss
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
      // light keeps monsters away: nothing spawns within a torch's glow
      if (this.world.walkable(Math.floor(x), Math.floor(y)) && !this.nearTorch(x, y, TORCH_RADIUS + 1)) {
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

  // ---------- Ghost Block + Stormcaller ----------

  /**
   * Every Ghost Block pulses on a fixed cycle. The moment a cycle ends the boss comes straight out
   * of the block: no checks on the tiles around it or the terrain under it.
   */
  private updateGhosts() {
    if (this.world.layer !== "surface") return;
    for (const k in this.world.changes) {
      const t = this.world.changes[k]!;
      if (t.obj !== "ghost_block" || t.pt === undefined) continue;
      const cycle = ghostCycle(t.pt, this.time);
      const seen = this.ghostSeen.get(k);
      this.ghostSeen.set(k, cycle);
      if (seen === undefined || cycle <= seen) continue;
      const [gx, gy] = k.split(",");
      this.summonBoss(Number(gx) + 0.5, Number(gy) + 0.5);
    }
  }

  /** the boss climbs out of the block; only one at a time, and only when the player is around to face it */
  private summonBoss(x: number, y: number) {
    if (this.boss || this.dead) return;
    if (Math.hypot(this.x - x, this.y - y) > GHOST_RANGE) return;
    this.boss = { x, y, hp: BOSS.hp, max: BOSS.hp, state: "emerge", t: BOSS.emergeTime, move: null, queue: [], hurt: 0, bob: 0, face: x < this.x ? "right" : "left", turn: 0 };
    // the block is spent: each Ghost Block summons exactly one Stormcaller, then it is gone
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const tile = this.world.get(tx, ty);
    if (tile.obj === "ghost_block") this.world.set(tx, ty, { ...tile, obj: undefined, pt: undefined });
    this.ghostSeen.delete(tx + "," + ty);
    this.say("The Stormcaller rises!");
  }

  /** the fight is over (or reset): the boss and everything it cast are gone */
  private clearBoss() {
    this.boss = null;
    this.beams = [];
    this.bolts = [];
    this.bursts = [];
    this.kx = 0;
    this.ky = 0;
    this.emit();
  }

  /** victory: it bursts apart and leaves Shiny Metal */
  private killBoss() {
    const b = this.boss;
    if (!b) return;
    this.deathBurst(b.x, b.y - 1.5, ["#22c04a", "#a879ff"], 60);
    this.clearBoss();
    this.give(BOSS_LOOT.id, BOSS_LOOT.n);
    this.say("The Stormcaller is defeated!");
  }

  private deathBurst(x: number, y: number, [a, b]: [string, string], n: number) {
    const r = Math.random;
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2;
      const sp = 2 + r() * 5;
      const max = 0.6 + r() * 0.7;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 0.8,
        life: max,
        max,
        size: 3 + Math.floor(r() * 3),
        grow: 0,
        color: i % 3 === 0 ? b : a,
      });
    }
  }

  private updateBoss(dt: number) {
    // cast effects run on their own clocks, but only ever exist while a boss does
    const b = this.boss;
    if (!b) return;
    const scale = this.difficulty === "hard" ? 1.35 : 1;
    b.bob += dt * 2.4;
    if (b.hurt > 0) b.hurt -= dt;
    const startX = b.x;
    const dx = this.x - b.x;
    const dy = this.y - b.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    if (dist > 60) {
      this.clearBoss(); // the player got away: it gives up and resets
      return;
    }

    // green flames licking up around it: small embers rising off the whole body, not a blob on top of it
    this.flameAcc += dt * 26;
    while (this.flameAcc >= 1) {
      this.flameAcc -= 1;
      const max = 0.55 + Math.random() * 0.6;
      this.particles.push({
        x: b.x + (Math.random() - 0.5) * 2.6,
        y: b.y - 0.6 - Math.random() * 2.6,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -0.9 - Math.random() * 1.2,
        life: max,
        max,
        size: 2 + Math.floor(Math.random() * 2),
        grow: 1.5,
        color: ["#1fbf3a", "#5cff6e", "#c8ff9a", "#0f8a2a"][Math.floor(Math.random() * 4)]!,
      });
    }

    switch (b.state) {
      case "emerge":
        b.t -= dt;
        if (b.t <= 0) {
          b.state = "pause";
          b.t = 1.2;
        }
        break;
      case "pause": {
        // hover at a comfortable distance, circling a little
        const ux = dx / dist;
        const uy = dy / dist;
        const want = dist > BOSS.hoverDist + 1 ? 1 : dist < BOSS.hoverDist - 1 ? -0.7 : 0;
        b.x += (ux * want + -uy * 0.35) * BOSS.driftSpeed * dt;
        b.y += (uy * want + ux * 0.35) * BOSS.driftSpeed * dt;
        b.t -= dt;
        if (b.t <= 0) {
          b.queue = pickMoves();
          this.nextBossMove(b);
        }
        break;
      }
      case "approach":
        // closing in for the Storm Blast, which only reaches the player up close
        b.t -= dt;
        if (dist <= BOSS.storm.closeIn || b.t <= 0) this.beginWindup(b, "storm");
        else {
          b.x += (dx / dist) * BOSS.dashSpeed * dt;
          b.y += (dy / dist) * BOSS.dashSpeed * dt;
        }
        break;
      case "windup":
        b.t -= dt;
        if (b.t <= 0) this.fireBossMove(b, scale);
        break;
      case "recover":
        b.t -= dt;
        if (b.t <= 0) this.nextBossMove(b);
        break;
    }

    // turn to face the way it moves (or the player, while it aims), but not more than once per cooldown
    b.turn -= dt;
    const aiming = b.state === "emerge" || b.state === "windup" || b.state === "approach";
    const face = bossFacing(b.face, dt > 0 ? (b.x - startX) / dt : 0, this.x - b.x, aiming);
    if (face !== b.face && b.turn <= 0) {
      b.face = face;
      b.turn = BOSS_TURN_COOLDOWN;
    }

    this.updateBossCasts(dt, scale);
  }

  /** run the next move of the current pair, or take the 3-7 second breather once both are done */
  private nextBossMove(b: Boss) {
    const m = b.queue.shift();
    if (!m) {
      b.state = "pause";
      b.move = null;
      b.t = pauseSeconds();
      return;
    }
    if (m === "storm") {
      b.state = "approach";
      b.move = m;
      b.t = BOSS.storm.dashTimeout;
    } else this.beginWindup(b, m);
  }

  private beginWindup(b: Boss, m: BossMove) {
    b.state = "windup";
    b.move = m;
    b.t = BOSS[m].windup;
    if (m === "lightning") {
      // the target is chosen now, so the warning shows the player exactly where to get out of
      const { tx, ty } = lightningTile(this.x, this.y, Math.random, (x, y) => this.world.walkable(x, y));
      this.bolts.push({ tx, ty, warn: BOSS.lightning.windup, strike: 0, seed: Math.random() * 100 });
    }
  }

  private fireBossMove(b: Boss, scale: number) {
    const m = b.move;
    if (m === "laser") {
      // aimed at where the player stands right now, snapped to one of the 8 directions; it never homes
      const dir = snapDir8(this.x - b.x, this.y - b.y);
      this.beams.push({ x: b.x, y: b.y, dx: dir.dx, dy: dir.dy, life: BOSS.laser.life, hit: false });
    } else if (m === "storm") {
      this.bursts.push({ x: b.x, y: b.y, t: 0.4 });
      const dist = Math.hypot(this.x - b.x, this.y - b.y);
      if (dist < BOSS.storm.radius) {
        this.damage(BOSS.storm.dmg * scale);
        const a = dist > 0.001 ? Math.atan2(this.y - b.y, this.x - b.x) : Math.PI / 2;
        this.kx = Math.cos(a) * BOSS.storm.knock;
        this.ky = Math.sin(a) * BOSS.storm.knock;
      }
    }
    // lightning lands on its own timer (see updateBossCasts)
    b.state = "recover";
    b.move = null;
    b.t = BOSS.recoverTime;
  }

  /** lasers, lightning and shockwaves already in the air */
  private updateBossCasts(dt: number, scale: number) {
    for (const beam of this.beams) {
      beam.life -= dt;
      if (!beam.hit && beamHits(beam.x, beam.y, beam.dx, beam.dy, BOSS.laser.length, BOSS.laser.halfWidth, this.x, this.y)) {
        beam.hit = true;
        this.damage(BOSS.laser.dmg * scale);
      }
    }
    this.beams = this.beams.filter((x) => x.life > 0);

    for (const bolt of this.bolts) {
      if (bolt.warn > 0) {
        bolt.warn -= dt;
        if (bolt.warn <= 0) {
          bolt.strike = BOSS.lightning.life;
          if (Math.hypot(this.x - (bolt.tx + 0.5), this.y - (bolt.ty + 0.5)) <= BOSS.lightning.radius) this.damage(BOSS.lightning.dmg * scale);
        }
      } else bolt.strike -= dt;
    }
    this.bolts = this.bolts.filter((x) => x.warn > 0 || x.strike > 0);

    this.bursts = this.bursts.filter((x) => (x.t -= dt) > 0);
  }

  private explode(m: Mob, dmg: number) {
    this.booms.push({ x: m.x, y: m.y, t: 0.5 });
    this.deathFx(m);
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
          const breaks = !!t.obj && t.obj !== "mountain" && t.obj !== "cave_entrance" && t.obj !== "cave_exit" && t.obj !== "ghost_block";
          if (breaks || t.torch) {
            this.world.set(tx, ty, {
              ...t,
              obj: breaks ? undefined : t.obj,
              pt: breaks ? undefined : t.pt,
              torch: undefined,
            });
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
    this.clearBoss();
    this.ghostSeen.clear();
    this.time = (Math.floor(this.time / DAY_LEN) + 1) * DAY_LEN + MORNING;
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
        if (!t.obj && !t.torch) continue;
        const sx = tx * S - camX;
        const by = (ty + 1) * S - camY;
        if (t.obj) {
          const kind = t.obj;
          if (kind === "ghost_block") {
            // idle shimmer, then a red pulse that quickens until the boss comes out
            const warn = t.pt === undefined ? 0 : ghostWarning(t.pt, this.time);
            draws.push({
              baseY: by,
              fn: () => {
                drawObject(c, kind, sx, by, S);
                drawGhostGlow(c, sx, by, S, warn, this.time);
              },
            });
          } else if (OBJ_TALL[kind]) draws.push({ baseY: by, fn: () => drawObject(c, kind, sx, by, S) });
          else drawObject(c, kind, sx, by, S);
        }
        if (t.torch) drawTorch(c, sx, by, S, this.time, tx, ty);
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
    const boss = this.boss;
    if (boss) {
      const bx = boss.x * S - camX;
      const bby = boss.y * S - camY + S * 0.35;
      const rise = boss.state === "emerge" ? 1 - boss.t / BOSS.emergeTime : 1;
      draws.push({ baseY: bby, fn: () => drawBoss(c, bx, bby, S, boss.hurt > 0, boss.bob, rise, this.time, boss.face) });
    }
    const psx = this.x * S - camX - S / 2;
    const pby = this.y * S - camY + S * 0.35;
    const pbob = this.time * 3.2;
    draws.push({ baseY: pby, fn: () => drawPlayer(c, psx, pby, S, this.dir, this.hurtFlash > 0, pbob) });
    draws.sort((a, b) => a.baseY - b.baseY);
    draws.forEach((d) => d.fn());

    if (boss) this.drawBossEffects(c, boss, S, camX, camY);

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

    // pixel bursts (mob deaths)
    for (const p of this.particles) {
      const grow = p.grow * (1 - p.life / p.max);
      const sz = Math.max(2, Math.round(((p.size + grow) * S) / 16));
      c.globalAlpha = Math.max(0, Math.min(1, p.life / (p.max * 0.6)));
      c.fillStyle = p.color;
      c.fillRect(Math.round(p.x * S - camX - sz / 2), Math.round(p.y * S - camY - sz / 2), sz, sz);
    }
    c.globalAlpha = 1;

    // day/night tint
    const tod = (this.time % DAY_LEN) / DAY_LEN;
    let dark = darknessAt(tod) * 0.62;
    if (this.sleeping > 0) dark = Math.max(dark, 1 - this.sleeping / 1.6 < 0.5 ? 0.95 : 0.95);
    const cave = this.inCave();
    // near the Stormcaller you only see a small circle around yourself
    const fog = !!this.boss && Math.hypot(this.boss.x - this.x, this.boss.y - this.y) < BOSS.visionRange;
    if (dark > 0 || cave || fog) this.drawDarkness(c, W, H, S, camX, camY, dark, cave || fog, fog && !cave ? BOSS.visionRadius : 3.4);

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

  /** warnings and attacks of the Stormcaller, drawn over the world */
  private drawBossEffects(c: CanvasRenderingContext2D, b: Boss, S: number, camX: number, camY: number) {
    // everything sits at "chest height": the ground plane the fight is computed on, lifted a little
    const lift = S * 0.6;
    const sx = (wx: number) => wx * S - camX;
    const sy = (wy: number) => wy * S - camY;

    if (b.state === "windup" && b.move === "laser") {
      drawCharge(c, sx(b.x), sy(b.y) - lift, S, 1 - b.t / BOSS.laser.windup, this.time);
    }
    if (b.move === "storm" && b.state === "windup") {
      drawStormWarning(c, sx(b.x), sy(b.y), BOSS.storm.radius * S, 1 - b.t / BOSS.storm.windup);
    }
    for (const burst of this.bursts) drawStormBurst(c, sx(burst.x), sy(burst.y), BOSS.storm.radius * S, 1 - burst.t / 0.4);
    for (const bolt of this.bolts) {
      const cx = sx(bolt.tx + 0.5);
      const cy = sy(bolt.ty + 0.5);
      if (bolt.warn > 0) drawLightningWarning(c, cx, cy, BOSS.lightning.radius * S, 1 - bolt.warn / BOSS.lightning.windup, this.time);
      else drawLightningBolt(c, cx, cy, S * 8, bolt.strike / BOSS.lightning.life, bolt.seed, S * 0.55);
    }
    for (const beam of this.beams) {
      const len = BOSS.laser.length;
      const fade = beam.life / BOSS.laser.life;
      drawBeam(
        c,
        sx(beam.x),
        sy(beam.y) - lift,
        sx(beam.x + beam.dx * len),
        sy(beam.y + beam.dy * len) - lift,
        S * BOSS.laser.halfWidth * 2 * (0.5 + 0.5 * fade),
        Math.min(1, fade * 1.6),
      );
    }
  }

  /**
   * Night tint and cave darkness are drawn on their own layer so torches can cut holes in it:
   * everything within a torch's radius is lit, with a soft edge and a little flicker.
   */
  private drawDarkness(c: CanvasRenderingContext2D, W: number, H: number, S: number, camX: number, camY: number, dark: number, cave: boolean, litTiles = 3.4) {
    if (typeof document === "undefined") return;
    if (!this.lightCv) this.lightCv = document.createElement("canvas");
    const lc = this.lightCv;
    if (lc.width !== W || lc.height !== H) {
      lc.width = W;
      lc.height = H;
    }
    const g = lc.getContext("2d");
    if (!g) return;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, W, H);
    if (dark > 0) {
      g.fillStyle = `rgba(6,10,40,${dark})`;
      g.fillRect(0, 0, W, H);
    }
    if (cave) {
      // only a small circle around the player is lit
      const cx = W / 2;
      const cy = H / 2;
      const lit = S * litTiles;
      const gr = g.createRadialGradient(cx, cy, lit * 0.35, cx, cy, lit);
      gr.addColorStop(0, "rgba(4,4,8,0)");
      gr.addColorStop(0.65, "rgba(4,4,8,0.72)");
      gr.addColorStop(1, "rgba(2,2,5,0.985)");
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }

    // torches punch light out of the darkness
    const R = TORCH_RADIUS * S;
    const lights: { x: number; y: number; r: number }[] = [];
    for (const k of this.world.torches) {
      const [tx, ty] = k.split(",");
      const x = (Number(tx) + 0.5) * S - camX;
      const y = (Number(ty) + 0.5) * S - camY;
      if (x < -R * 1.1 || x > W + R * 1.1 || y < -R * 1.1 || y > H + R * 1.1) continue;
      const flicker = 1 + 0.045 * Math.sin(this.time * 8 + Number(tx) * 1.7 + Number(ty) * 2.3);
      lights.push({ x, y, r: R * flicker });
    }
    if (this.sleeping > 0) lights.length = 0; // falling asleep blacks everything out, torches included
    g.globalCompositeOperation = "destination-out";
    for (const l of lights) {
      const gr = g.createRadialGradient(l.x, l.y, l.r * 0.15, l.x, l.y, l.r);
      gr.addColorStop(0, "rgba(0,0,0,1)");
      gr.addColorStop(0.55, "rgba(0,0,0,0.85)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    g.globalCompositeOperation = "source-over";
    c.drawImage(lc, 0, 0);

    // a warm glow on top, strongest when it is darkest
    if (lights.length) {
      const strength = cave ? 1 : Math.min(1, dark / 0.62);
      c.globalCompositeOperation = "lighter";
      for (const l of lights) {
        const gr = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.9);
        gr.addColorStop(0, `rgba(255,150,60,${0.22 * strength})`);
        gr.addColorStop(1, "rgba(255,150,60,0)");
        c.fillStyle = gr;
        c.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
      }
      c.globalCompositeOperation = "source-over";
    }
  }

  resize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
  }
}
