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

export interface WorldSave {
  seed: number;
  difficulty: "easy" | "hard";
  changes: ChangeMap;
  player: { x: number; y: number; hp: number; hunger: number; time: number };
  inv: (({ id: string; n: number }) | null)[];
  hotbarIndex: number;
}

export const key = (x: number, y: number) => x + "," + y;

export class World {
  seed: number;
  changes: ChangeMap;
  private cache = new Map<string, Tile[]>();

  constructor(seed: number, changes: ChangeMap = {}) {
    this.seed = seed;
    this.changes = changes;
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
          // caves: enclosed dark hollows carved inside rock areas
          const cv = fbm(wx / 9 + 300, wy / 9 + 300, this.seed + 9001);
          const deep = cv > 0.62;
          if (deep) t = "cave";
          const nearCave = cv > 0.5;
          const o = hash2(wx, wy, this.seed + 777);
          if (t === "stone" && nearCave) {
            // ore is mostly in cave walls; diamond only in the deepest parts
            if (cv > 0.6 && o > 0.968) ore = "diamond";
            else if (o > 0.86) ore = "iron";
          } else if (t === "stone" && o > 0.996) {
            ore = "iron";
          }
          if (t === "stone" && e > 0.76 && hash2(wx, wy, this.seed + 31) > 0.55) obj = "mountain";
        } else if (t === "grass") {
          if (hash2(wx, wy, this.seed + 99) > 0.94) obj = "tree";
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
      c = this.genChunk(cx, cy);
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
