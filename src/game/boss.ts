// The Stormcaller boss and the Ghost Block that summons it: pure data and pure helpers, no DOM,
// so every rule here can be unit-tested without an engine or a canvas.

export type BossMove = "laser" | "storm" | "lightning" | "swarm";
export const BOSS_MOVES: readonly BossMove[] = ["laser", "storm", "lightning", "swarm"];

/** a source of numbers in [0, 1): Math.random in the game, a fixed sequence in tests */
export type Rng = () => number;

// ---------- Ghost Block ----------

/** cost of crafting a Ghost Block */
export const GHOST_XP_COST = 10;
export const GHOST_DIAMOND_COST = 10;

/** seconds from one summon to the next; the block pulses red for the last GHOST_WARN of them */
export const GHOST_CYCLE = 40;
export const GHOST_WARN = 4;
/** the boss only answers a pulse when the player is on the surface and this close (in tiles) */
export const GHOST_RANGE = 26;

/** which pulse cycle a block placed at `placedAt` is in at world time `time` (increments when the boss is due) */
export function ghostCycle(placedAt: number, time: number): number {
  return Math.floor((time - placedAt) / GHOST_CYCLE);
}

/** 0 while idle, then rising 0 -> 1 across the red warning pulse that ends each cycle */
export function ghostWarning(placedAt: number, time: number): number {
  const phase = (((time - placedAt) % GHOST_CYCLE) + GHOST_CYCLE) % GHOST_CYCLE;
  const start = GHOST_CYCLE - GHOST_WARN;
  return phase < start ? 0 : (phase - start) / GHOST_WARN;
}

// ---------- boss stats ----------

export const BOSS = {
  hp: 2880, // 3x the previous 960 (which was 3x the original 320)
  /** drift speed between attacks / dash speed when closing in for a Storm Blast (tiles per second) */
  driftSpeed: 1.5,
  dashSpeed: 6,
  /** it hovers around this far from the player while it isn't attacking */
  hoverDist: 3.2,
  /**
   * While the Stormcaller is alive the world goes black: the player sees only inside a circle of this
   * many tiles around themselves. No torch, glow or distance makes anything outside it visible.
   */
  visionRadius: 4.5,
  emergeTime: 1.4,
  recoverTime: 0.6,
  pauseMin: 3,
  pauseMax: 7,
  laser: { windup: 1.0, length: 16, halfWidth: 0.55, life: 0.35, dmg: 16, /** it smashes this many obstacles, then it is spent */ pierce: 2 },
  storm: { windup: 1.1, radius: 2.8, dmg: 20, knock: 10, closeIn: 1.9, dashTimeout: 3 },
  lightning: { windup: 0.9, life: 0.4, radius: 1.05, dmg: 18, maxOff: 3 },
  /** the Swarm Spawner: small night mobs pour out even in broad daylight and hunt the player until killed */
  swarm: { windup: 1.3, count: 5, hardCount: 7, maxAlive: 12, ring: 1.4 },
  /** what its attacks do to every other mob they touch (the swarm itself is never hurt) */
  mobDmg: { laser: 30, storm: 40, lightning: 35 },
} as const;

/** what a victory drops */
export const BOSS_LOOT = { id: "shiny_metal", n: 5 } as const;

// ---------- combat cycle ----------

/** 2 of the 3 moves, chosen at random, in a random order (never the same move twice in a row) */
export function pickMoves(rng: Rng = Math.random): [BossMove, BossMove] {
  const pool = [...BOSS_MOVES];
  const a = pool.splice(Math.floor(rng() * pool.length), 1)[0]!;
  const b = pool[Math.floor(rng() * pool.length)]!;
  return [a, b];
}

/** the 3-7 second breather between one pair of moves and the next */
export function pauseSeconds(rng: Rng = Math.random): number {
  return BOSS.pauseMin + rng() * (BOSS.pauseMax - BOSS.pauseMin);
}

// ---------- laser ----------

/**
 * Snap a direction to the nearest of 8 (4 cardinal + 4 diagonal), returned as a unit vector.
 * The laser fires along this from the boss, so it only ever hits a player who is near one of
 * those 8 lines: standing still off-axis is safe, standing on-axis is not.
 */
export function snapDir8(dx: number, dy: number): { dx: number; dy: number } {
  const ang = Math.atan2(dy, dx);
  const k = Math.round(ang / (Math.PI / 4));
  const a = k * (Math.PI / 4);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // clean up float noise so cardinal directions are exactly 0 / ±1
  return { dx: Math.abs(ux) < 1e-9 ? 0 : ux, dy: Math.abs(uy) < 1e-9 ? 0 : uy };
}

/** does a beam from (bx, by) along the unit vector (dx, dy) touch a point, given its length and half-width? */
export function beamHits(bx: number, by: number, dx: number, dy: number, len: number, halfWidth: number, px: number, py: number): boolean {
  const rx = px - bx;
  const ry = py - by;
  const along = rx * dx + ry * dy;
  if (along < 0 || along > len) return false;
  const off = Math.abs(rx * dy - ry * dx);
  return off <= halfWidth;
}

// ---------- lightning ----------

/**
 * A random tile near the player (up to 3 tiles away on each axis, never the player's own tile), so
 * the player has to move rather than stand still. `ok` lets the caller prefer tiles that can be stood on.
 */
export function lightningTile(px: number, py: number, rng: Rng = Math.random, ok: (tx: number, ty: number) => boolean = () => true): { tx: number; ty: number } {
  const reach = BOSS.lightning.maxOff;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  let last = { tx: cx + 1, ty: cy };
  for (let i = 0; i < 24; i++) {
    const ox = Math.floor(rng() * (reach * 2 + 1)) - reach;
    const oy = Math.floor(rng() * (reach * 2 + 1)) - reach;
    if (ox === 0 && oy === 0) continue;
    last = { tx: cx + ox, ty: cy + oy };
    if (ok(last.tx, last.ty)) return last;
  }
  return last;
}

// ---------- facing ----------

/** which way the boss looks: it has a left-facing and a right-facing skin */
export type Facing = "left" | "right";

/**
 * Which skin the boss should wear. While it is winding up or firing it looks at the player; the
 * rest of the time it looks the way it is moving (moving right -> face right, moving left -> face
 * left). Below a small speed / offset it keeps whatever it was facing, so it never flickers.
 *
 * @param cur       the skin it has now
 * @param moveVx    its horizontal speed in tiles per second (positive = moving right)
 * @param toPlayerDx horizontal offset from the boss to the player (positive = player is to the right)
 * @param aiming    true while it is emerging, winding up or attacking
 */
export function bossFacing(cur: Facing, moveVx: number, toPlayerDx: number, aiming: boolean): Facing {
  if (aiming) return Math.abs(toPlayerDx) > 0.3 ? (toPlayerDx > 0 ? "right" : "left") : cur;
  return Math.abs(moveVx) > 0.3 ? (moveVx > 0 ? "right" : "left") : cur;
}

/** the minimum time (seconds) between two turns, so orbiting around the player doesn't make it flip-flop */
export const BOSS_TURN_COOLDOWN = 0.35;

// ---------- the swarm ----------

/** the little attackers the Swarm Spawner makes */
export const SWARMLING = { hp: 14, speed: 2.4, dmg: 4 } as const;

// ---------- the boss and the world ----------

/** what the Stormcaller's attacks cannot break: the land itself, the ways into the caves, and the Ghost Block */
const SPARED = new Set(["mountain", "cave_entrance", "cave_exit", "ghost_block"]);

/** can its attacks destroy whatever stands on a tile? trees, crops, doors and anything the player built */
export function bossBreaks(obj: string | undefined): boolean {
  return !!obj && !SPARED.has(obj);
}

/** every tile a laser sweeps through, nearest first, each once, with how far along the beam it is */
export function beamTiles(bx: number, by: number, dx: number, dy: number, len: number, halfWidth: number, from = 0.8): { tx: number; ty: number; d: number }[] {
  const out: { tx: number; ty: number; d: number }[] = [];
  const seen = new Set<string>();
  for (let d = from; d <= len; d += 0.25) {
    for (const off of [0, halfWidth * 0.8, -halfWidth * 0.8]) {
      const tx = Math.floor(bx + dx * d - dy * off);
      const ty = Math.floor(by + dy * d + dx * off);
      const k = tx + "," + ty;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ tx, ty, d });
    }
  }
  return out;
}

/** the tiles whose centre lies within `r` of a point */
export function tilesInCircle(cx: number, cy: number, r: number): { tx: number; ty: number }[] {
  const out: { tx: number; ty: number }[] = [];
  for (let tx = Math.floor(cx - r); tx <= Math.floor(cx + r); tx++) {
    for (let ty = Math.floor(cy - r); ty <= Math.floor(cy + r); ty++) {
      if (Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) <= r) out.push({ tx, ty });
    }
  }
  return out;
}
