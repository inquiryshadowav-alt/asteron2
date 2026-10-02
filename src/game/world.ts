// Deterministic chunk generation + sparse change overrides + local save.
import type { ObjKind, Ore, Tile, TileType } from "./data";
import { GROUND_SOLID, OBJ_SOLID } from "./data";

export const CHUNK = 16;

function hash2(x: number, y: number, seed: number): number {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function fbm(x: number, y: number, seed: number): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < 3; i++) {
    v += valueNoise(x * f, y * f, seed + i * 7919) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

export type ChangeMap = Record<string, Tile>;

export type Layer = "surface" | "under";

export interface WorldSave {
  seed: number;
  difficulty: "easy" | "hard";
  changes: ChangeMap;
  underChanges?: ChangeMap;
  layer?: Layer;
  player: { x: number; y: number; hp: number; hunger: number; time: number };
  inv: (({ id: string; n: number; dur?: number }) | null)[];
  hotbarIndex: number;
  /** tile the player first spawned on, the (0, 0, 0) of the coordinate display */
  origin?: { x: number; y: number };
  /** which durability table the tools were counted in (see TOOLS_VERSION); older saves get their tools carried over */
  toolsV?: number;
}

export const key = (x: number, y: number) => x + "," + y;

/** size of a cave region: at most one cave system per region */
export const REGION = 28;

/** chance that a natural dirt tile carries tall grass is 1 - GRASS_CUTOFF */
const GRASS_CUTOFF = 0.65;

/** coal in surface stone (about 6%, unrelated to the cave rates below) */
const SURFACE_COAL_CUTOFF = 0.94;

/**
 * Underground ore odds: coal is common, iron is a real find, diamond is rare enough to be worth
 * the trip. Coal and iron come from one 0..1 hash per stone tile — a cutoff of, say, 0.86 means
 * "the top 14% of stone tiles" — with diamond's own cutoff carved out of iron's band first.
 * Measured across many worlds: roughly coal 10.5%, iron 3%, diamond 0.2% of all cave stone.
 */
const CAVE_COAL_CUTOFF = 0.86;
const CAVE_IRON_CUTOFF = 0.965;
const CAVE_DIAMOND_CUTOFF = 0.994;
/**
 * Diamond additionally only forms inside "deep pockets" — patches from their own noise field,
 * unrelated to the visible cave shape — so a find is a small rich vein rather than single blocks
 * sprinkled everywhere: about 40% of cave systems have none nearby, others have several.
 */
const CAVE_DEEP_POCKET_CUTOFF = 0.5;

/**
 * Wild flowers grow in small groups on grass. The surface is cut into FLOWER_CELL-sized squares and
 * a bit under half of them hold one group: 5 to 7 flowers of a single kind packed close together,
 * all on grass. Common enough to stumble on, not so common that meadows are carpeted.
 */
const FLOWER_CELL = 10;
const FLOWER_GROUP_ODDS = 0.42;
export const FLOWER_KINDS: readonly ObjKind[] = ["flower_poppy", "flower_bluebell", "flower_jasmine", "flower_sunflower"];

interface Anchor {
  x: number;
  y: number;
}

export class World {
  seed: number;
  layer: Layer;
  changes: ChangeMap;
  private cache = new Map<string, Tile[]>();
  private anchors = new Map<string, Anchor | null>();
  private flowerCells = new Map<string, Map<string, ObjKind>>();
  /** "x,y" of every tile carrying a torch, kept in sync so lighting never scans the whole map */
  readonly torches = new Set<string>();

  constructor(seed: number, changes: ChangeMap = {}, layer: Layer = "surface") {
    this.seed = seed;
    this.changes = changes;
    this.layer = layer;
    for (const [k, t] of Object.entries(changes)) if (t.torch) this.torches.add(k);
  }

  /** the single cave-system anchor of a region, or null when the region has no caves */
  anchor(rx: number, ry: number): Anchor | null {
    const k = key(rx, ry);
    const hit = this.anchors.get(k);
    if (hit !== undefined) return hit;
    let a: Anchor | null = null;
    if (hash2(rx, ry, this.seed + 7001) > 0.62) {
      const ox = 5 + Math.floor(hash2(rx, ry, this.seed + 7002) * (REGION - 10));
      const oy = 5 + Math.floor(hash2(rx, ry, this.seed + 7003) * (REGION - 10));
      a = { x: rx * REGION + ox, y: ry * REGION + oy };
    }
    this.anchors.set(k, a);
    return a;
  }

  /** anchor whose entrance sits exactly on this tile */
  anchorAt(wx: number, wy: number): boolean {
    const a = this.anchor(Math.floor(wx / REGION), Math.floor(wy / REGION));
    return !!a && a.x === wx && a.y === wy;
  }

  /** distance from a point to a segment */
  private segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax;
    const dy = by - ay;
    const l = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / l;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  /** true when this underground tile belongs to a cave system (rooms + tunnels) */
  private caveOpen(wx: number, wy: number): boolean {
    const wob = 0.72 + fbm(wx / 5, wy / 5, this.seed + 313) * 0.8;
    const rx0 = Math.floor(wx / REGION);
    const ry0 = Math.floor(wy / REGION);
    for (let ry = ry0 - 1; ry <= ry0 + 1; ry++) {
      for (let rx = rx0 - 1; rx <= rx0 + 1; rx++) {
        const a = this.anchor(rx, ry);
        if (!a) continue;
        // main chamber under the entrance
        if (Math.hypot(wx - a.x, wy - a.y) < 3.4 * wob + 0.6) return true;
        const s = this.seed + rx * 131 + ry * 977;
        for (let i = 0; i < 5; i++) {
          const ang = hash2(a.x, a.y, s + i * 17) * Math.PI * 2;
          const dist = 4 + hash2(a.x, a.y, s + i * 29) * 8;
          const cx = a.x + Math.cos(ang) * dist;
          const cy = a.y + Math.sin(ang) * dist;
          const rad = (2.1 + hash2(a.x, a.y, s + i * 41) * 2.2) * wob;
          if (Math.hypot(wx - cx, wy - cy) < rad) return true;
          if (this.segDist(wx, wy, a.x, a.y, cx, cy) < 1.1 * wob) return true;
        }
      }
    }
    return false;
  }

  /** underground dimension: cave systems carved out of solid stone */
  private genUnderChunk(cx: number, cy: number): Tile[] {
    const tiles: Tile[] = new Array(CHUNK * CHUNK);
    const s = this.seed + 424242;
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const wx = cx * CHUNK + tx;
        const wy = cy * CHUNK + ty;
        const open = this.caveOpen(wx, wy);
        const t: TileType = open ? "cave" : "stone";
        let ore: Ore | undefined;
        let obj: ObjKind | undefined;
        if (t === "stone") {
          const o = hash2(wx, wy, s + 999);
          // "deep pockets": patchy regions (their own blobby noise field, unrelated to the visible
          // cave shape) that diamond needs — a diamond vein sits in a pocket within the rock, not
          // just anywhere the hash happens to be high
          const deepPocket = fbm(wx / 22 + 900, wy / 22 + 900, s + 31) > CAVE_DEEP_POCKET_CUTOFF;
          if (deepPocket && o > CAVE_DIAMOND_CUTOFF) ore = "diamond";
          else if (o > CAVE_IRON_CUTOFF) ore = "iron";
          else if (o > CAVE_COAL_CUTOFF) ore = "coal";
        } else if (this.anchorAt(wx, wy)) {
          obj = "cave_exit";
        } else if (hash2(wx, wy, s + 1234) > 0.99) {
          obj = "block_stone";
        }
        tiles[ty * CHUNK + tx] = { t, ore, obj };
      }
    }
    return tiles;
  }


  /** the natural ground of a surface tile, plus the height value that decided it */
  private groundAt(wx: number, wy: number): { t: TileType; e: number } {
    const e = fbm(wx / 24, wy / 24, this.seed);
    const m = fbm(wx / 11 + 100, wy / 11 + 100, this.seed + 5001);
    let t: TileType;
    if (e < 0.3) t = "water";
    else if (e < 0.36) t = "sand";
    else if (e > 0.66) t = "stone";
    else t = m > 0.62 ? "dirt" : "grass";
    return { t, e };
  }

  /** the flower group of one FLOWER_CELL square: "x,y" -> flower kind (empty when the square has none) */
  private flowerCell(cx: number, cy: number): Map<string, ObjKind> {
    const k = key(cx, cy);
    const hit = this.flowerCells.get(k);
    if (hit) return hit;
    const group = new Map<string, ObjKind>();
    if (hash2(cx, cy, this.seed + 8101) > 1 - FLOWER_GROUP_ODDS) {
      // the centre keeps 3 tiles clear of the square's edge, so a group (radius 2) never spills into a neighbour
      const ox = cx * FLOWER_CELL + 3 + Math.floor(hash2(cx, cy, this.seed + 8102) * (FLOWER_CELL - 6));
      const oy = cy * FLOWER_CELL + 3 + Math.floor(hash2(cx, cy, this.seed + 8103) * (FLOWER_CELL - 6));
      const kind = FLOWER_KINDS[Math.floor(hash2(cx, cy, this.seed + 8104) * FLOWER_KINDS.length)]!;
      const want = 5 + Math.floor(hash2(cx, cy, this.seed + 8105) * 3); // 5, 6 or 7
      const spots: { x: number; y: number; r: number }[] = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) spots.push({ x: ox + dx, y: oy + dy, r: hash2(ox + dx, oy + dy, this.seed + 8106) });
      }
      spots.sort((a, b) => a.r - b.r);
      for (const sp of spots) {
        if (group.size >= want) break;
        if (this.groundAt(sp.x, sp.y).t !== "grass") continue; // only on grass, never in water or on sand
        if (hash2(sp.x, sp.y, this.seed + 99) > 0.94) continue; // a tree stands here
        if (this.anchorAt(sp.x, sp.y)) continue; // the cave entrance stays clear
        group.set(key(sp.x, sp.y), kind);
      }
      if (group.size < 5) group.clear(); // too little grass around: no group here at all
    }
    this.flowerCells.set(k, group);
    return group;
  }

  /** the flower growing naturally on a surface tile, if any */
  private flowerAt(wx: number, wy: number): ObjKind | undefined {
    return this.flowerCell(Math.floor(wx / FLOWER_CELL), Math.floor(wy / FLOWER_CELL)).get(key(wx, wy));
  }

  private genChunk(cx: number, cy: number): Tile[] {
    const tiles: Tile[] = new Array(CHUNK * CHUNK);
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const wx = cx * CHUNK + tx;
        const wy = cy * CHUNK + ty;
        const ground = this.groundAt(wx, wy);
        const e = ground.e;
        let t: TileType = ground.t;
        let obj: ObjKind | undefined;

        // iron and diamond only exist underground (see genUnderChunk); surface stone can hold coal
        let ore: Ore | undefined;
        if (t === "stone") {
          if (e > 0.76 && hash2(wx, wy, this.seed + 31) > 0.55) obj = "mountain";
          else if (hash2(wx, wy, this.seed + 555) > SURFACE_COAL_CUTOFF) ore = "coal";
        } else if (t === "grass") {
          if (hash2(wx, wy, this.seed + 99) > 0.94) obj = "tree";
          else obj = this.flowerAt(wx, wy);
        } else if (t === "dirt") {
          // tufts of tall grass grow only on dirt; breaking one gives seeds
          if (hash2(wx, wy, this.seed + 177) > GRASS_CUTOFF) obj = "tall_grass";
        }
        // one cave entrance per cave region, sitting right above its cave system
        if (t !== "water" && this.anchorAt(wx, wy)) {
          // stone is solid and an object tile can't be mined, so an entrance left on
          // stone could never be reached — carve it out into walkable dirt instead
          if (t === "stone") {
            t = "dirt";
            ore = undefined;
          }
          obj = "cave_entrance";
        }

        tiles[ty * CHUNK + tx] = { t, ore, obj };
      }
    }
    return tiles;
  }

  private chunk(cx: number, cy: number): Tile[] {
    const k = key(cx, cy);
    let c = this.cache.get(k);
    if (!c) {
      c = this.layer === "under" ? this.genUnderChunk(cx, cy) : this.genChunk(cx, cy);
      this.cache.set(k, c);
      if (this.cache.size > 400) {
        const first = this.cache.keys().next().value;
        if (first) this.cache.delete(first);
      }
    }
    return c;
  }

  get(x: number, y: number): Tile {
    const ov = this.changes[key(x, y)];
    if (ov) {
      // iron and diamond are cave-only: older saves may still hold one in an edited surface tile
      if ((ov.ore === "iron" || ov.ore === "diamond") && this.layer === "surface") return { ...ov, ore: undefined };
      return ov;
    }
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const c = this.chunk(cx, cy);
    return c[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)] as Tile;
  }

  set(x: number, y: number, tile: Tile) {
    const k = key(x, y);
    this.changes[k] = tile;
    if (tile.torch) this.torches.add(k);
    else this.torches.delete(k);
  }

  walkable(x: number, y: number): boolean {
    const t = this.get(x, y);
    if (GROUND_SOLID[t.t]) return false;
    if (t.obj && OBJ_SOLID[t.obj]) return false;
    return true;
  }
}

const SAVE_PREFIX = "mc2d.world.";
const LIST_KEY = "mc2d.worlds";

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  difficulty: "easy" | "hard";
  created: number;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function listWorlds(): WorldMeta[] {
  if (typeof localStorage === "undefined") return [];
  return safeParse<WorldMeta[]>(localStorage.getItem(LIST_KEY), []);
}

export function saveWorldMeta(meta: WorldMeta) {
  const all = listWorlds().filter((w) => w.id !== meta.id);
  all.unshift(meta);
  // no cap: slicing here silently dropped the oldest world from the list (its save became unreachable)
  localStorage.setItem(LIST_KEY, JSON.stringify(all));
}

export function deleteWorld(id: string) {
  localStorage.setItem(LIST_KEY, JSON.stringify(listWorlds().filter((w) => w.id !== id)));
  localStorage.removeItem(SAVE_PREFIX + id);
}

export function loadSave(id: string): WorldSave | null {
  if (typeof localStorage === "undefined") return null;
  return safeParse<WorldSave | null>(localStorage.getItem(SAVE_PREFIX + id), null);
}

export function writeSave(id: string, save: WorldSave) {
  try {
    localStorage.setItem(SAVE_PREFIX + id, JSON.stringify(save));
  } catch {
    /* storage full — ignore */
  }
}

const SPAWN_PREFIX = "mc2d.spawn.";

/** the last bed the player slept in: tile + layer, kept in localStorage per world */
export interface BedSpawn {
  x: number;
  y: number;
  layer: Layer;
}

export function loadBedSpawn(id: string): BedSpawn | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const s = safeParse<BedSpawn | null>(localStorage.getItem(SPAWN_PREFIX + id), null);
    if (s && Number.isFinite(s.x) && Number.isFinite(s.y) && (s.layer === "surface" || s.layer === "under")) return s;
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function saveBedSpawn(id: string, spawn: BedSpawn) {
  try {
    localStorage.setItem(SPAWN_PREFIX + id, JSON.stringify(spawn));
  } catch {
    /* storage full or unavailable: the spawn just isn't remembered */
  }
}

export function clearBedSpawn(id: string) {
  try {
    localStorage.removeItem(SPAWN_PREFIX + id);
  } catch {
    /* ignore */
  }
}
