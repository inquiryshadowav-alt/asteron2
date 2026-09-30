// The Stormcaller boss and the Ghost Block that summons it: pure data and pure helpers, no DOM,
// so every rule here can be unit-tested without an engine or a canvas.

export type BossMove = "laser" | "storm" | "lightning";
export const BOSS_MOVES: readonly BossMove[] = ["laser", "storm", "lightning"];

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
  hp: 960, // 200% more than the original 320
  /** drift speed between attacks / dash speed when closing in for a Storm Blast (tiles per second) */
  driftSpeed: 1.5,
  dashSpeed: 6,
  /** it hovers around this far from the player while it isn't attacking */
  hoverDist: 4.5,
  /** while the Stormcaller is alive and this close (tiles), the player's vision shrinks to a small circle */
  visionRange: 16,
  /** how far (in tiles) the player can see inside that range */
  visionRadius: 4.5,
  emergeTime: 1.4,
  recoverTime: 0.6,
  pauseMin: 3,
  pauseMax: 7,
  laser: { windup: 1.0, length: 16, halfWidth: 0.55, life: 0.35, dmg: 16 },
  storm: { windup: 1.1, radius: 2.8, dmg: 20, knock: 10, closeIn: 1.9, dashTimeout: 3 },
  lightning: { windup: 0.9, life: 0.4, radius: 1.05, dmg: 18, maxOff: 3 },
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
