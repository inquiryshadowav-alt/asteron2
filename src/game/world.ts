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
  inv: (({ id: string; n: number }) | null)[];
  hotbarIndex: number;
}

export const key = (x: number, y: number) => x + "," + y;

/** size of a cave region: at most one cave system per region */
export const REGION = 28;

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

  constructor(seed: number, changes: ChangeMap = {}, layer: Layer = "surface") {
    this.seed = seed;
    this.changes = changes;
    this.layer = layer;
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
          const depth = fbm(wx / 30 + 900, wy / 30 + 900, s + 31);
          if (depth > 0.6 && o > 0.945) ore = "diamond";
          else if (o > 0.85) ore = "iron";
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


  private genChunk(cx: number, cy: number): Tile[] {
    const tiles: Tile[] = new Array(CHUNK * CHUNK);
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const wx = cx * CHUNK + tx;
        const wy = cy * CHUNK + ty;
        const e = fbm(wx / 24, wy / 24, this.seed);
        const m = fbm(wx / 11 + 100, wy / 11 + 100, this.seed + 5001);
        let t: TileType = "grass";
        let ore: Ore | undefined;
        let obj: ObjKind | undefined;

        if (e < 0.3) t = "water";
        else if (e < 0.36) t = "sand";
        else if (e > 0.66) t = "stone";
        else t = m > 0.62 ? "dirt" : "grass";

        if (t === "stone") {
          const cv = fbm(wx / 9 + 300, wy / 9 + 300, this.seed + 9001);
          const o = hash2(wx, wy, this.seed + 777);
          if (cv > 0.5) {
            if (cv > 0.6 && o > 0.985) ore = "diamond";
            else if (o > 0.93) ore = "iron";
          } else if (o > 0.996) {
            ore = "iron";
          }
          if (e > 0.76 && hash2(wx, wy, this.seed + 31) > 0.55) obj = "mountain";
        } else if (t === "grass") {
          if (hash2(wx, wy, this.seed + 99) > 0.94) obj = "tree";
        }
        // one cave entrance per cave region, sitting right above its cave system
        if (t !== "water" && this.anchorAt(wx, wy)) {
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
    if (ov) return ov;
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const c = this.chunk(cx, cy);
    return c[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)] as Tile;
  }

  set(x: number, y: number, tile: Tile) {
    this.changes[key(x, y)] = tile;
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
  localStorage.setItem(LIST_KEY, JSON.stringify(all.slice(0, 12)));
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
