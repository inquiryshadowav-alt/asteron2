import { describe, expect, it } from "vitest";
import {
  BOSS,
  BOSS_MOVES,
  GHOST_CYCLE,
  GHOST_WARN,
  beamHits,
  bossFacing,
  ghostCycle,
  ghostWarning,
  lightningTile,
  pauseSeconds,
  pickMoves,
  snapDir8,
  type Rng,
} from "./boss";

/** a fixed sequence of "random" numbers, repeating */
const seq = (...v: number[]): Rng => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

describe("Ghost Block pulse", () => {
  it("is idle for most of a cycle, then warns through its last GHOST_WARN seconds", () => {
    expect(ghostWarning(100, 100)).toBe(0);
    expect(ghostWarning(100, 100 + GHOST_CYCLE - GHOST_WARN - 0.01)).toBe(0);
    expect(ghostWarning(100, 100 + GHOST_CYCLE - GHOST_WARN / 2)).toBeCloseTo(0.5, 5);
    expect(ghostWarning(100, 100 + GHOST_CYCLE - 0.001)).toBeGreaterThan(0.99);
  });

  it("starts the next cycle the instant the warning ends, at fixed intervals", () => {
    expect(ghostCycle(100, 100)).toBe(0);
    expect(ghostCycle(100, 100 + GHOST_CYCLE - 0.001)).toBe(0);
    expect(ghostCycle(100, 100 + GHOST_CYCLE)).toBe(1);
    expect(ghostCycle(100, 100 + GHOST_CYCLE * 3 + 5)).toBe(3);
    // after the summon, the warning resets to idle
    expect(ghostWarning(100, 100 + GHOST_CYCLE)).toBe(0);
  });
});

describe("combat cycle", () => {
  it("picks 2 different moves out of the 3, in a random order", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const [a, b] = pickMoves();
      expect(a).not.toBe(b);
      expect(BOSS_MOVES).toContain(a);
      expect(BOSS_MOVES).toContain(b);
      seen.add(a + ">" + b);
    }
    // all 6 ordered pairs turn up eventually
    expect(seen.size).toBe(6);
  });

  it("follows the random numbers it is given", () => {
    expect(pickMoves(seq(0, 0))).toEqual(["laser", "storm"]);
    expect(pickMoves(seq(0.99, 0.99))).toEqual(["lightning", "storm"]);
  });

  it("pauses 3 to 7 seconds between pairs", () => {
    expect(pauseSeconds(() => 0)).toBe(3);
    expect(pauseSeconds(() => 0.999999)).toBeCloseTo(7, 4);
    for (let i = 0; i < 200; i++) {
      const p = pauseSeconds();
      expect(p).toBeGreaterThanOrEqual(3);
      expect(p).toBeLessThan(7);
    }
  });
});

describe("laser", () => {
  it("snaps to the 4 cardinal and 4 diagonal directions", () => {
    expect(snapDir8(5, 0)).toEqual({ dx: 1, dy: 0 });
    expect(snapDir8(-5, 0)).toEqual({ dx: -1, dy: 0 });
    expect(snapDir8(0, 3)).toEqual({ dx: 0, dy: 1 });
    expect(snapDir8(0, -3)).toEqual({ dx: 0, dy: -1 });
    const d = snapDir8(4, 4.5);
    expect(d.dx).toBeCloseTo(Math.SQRT1_2, 9);
    expect(d.dy).toBeCloseTo(Math.SQRT1_2, 9);
    const u = snapDir8(-3, -3);
    expect(u.dx).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(u.dy).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it("picks the nearest of the 8, not a free angle", () => {
    // 20 degrees off east is still east; 30 degrees is closer to the diagonal
    expect(snapDir8(Math.cos(0.35), Math.sin(0.35))).toEqual({ dx: 1, dy: 0 });
    const diag = snapDir8(Math.cos(0.52), Math.sin(0.52));
    expect(diag.dx).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("only hits a target that is on the beam's line, in front of it and within reach", () => {
    // beam from (0,0) heading east
    expect(beamHits(0, 0, 1, 0, 16, 0.55, 8, 0.3)).toBe(true);
    expect(beamHits(0, 0, 1, 0, 16, 0.55, 8, 0.9)).toBe(false); // beside it
    expect(beamHits(0, 0, 1, 0, 16, 0.55, -3, 0)).toBe(false); // behind the boss
    expect(beamHits(0, 0, 1, 0, 16, 0.55, 20, 0)).toBe(false); // out of range
    // diagonal beam
    const s = Math.SQRT1_2;
    expect(beamHits(0, 0, s, s, 16, 0.55, 5, 5.2)).toBe(true);
    expect(beamHits(0, 0, s, s, 16, 0.55, 5, 8)).toBe(false);
  });
});

describe("lightning", () => {
  it("lands near the player but never on their own tile", () => {
    for (let i = 0; i < 400; i++) {
      const { tx, ty } = lightningTile(10.5, 10.5);
      expect(Math.abs(tx - 10)).toBeLessThanOrEqual(3);
      expect(Math.abs(ty - 10)).toBeLessThanOrEqual(3);
      expect(tx === 10 && ty === 10).toBe(false);
    }
  });

  it("prefers a tile the caller accepts", () => {
    const { tx, ty } = lightningTile(0.5, 0.5, Math.random, (x, y) => x > 0 && y > 0);
    expect(tx).toBeGreaterThan(0);
    expect(ty).toBeGreaterThan(0);
  });

  it("varies from strike to strike", () => {
    const tiles = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = lightningTile(0.5, 0.5);
      tiles.add(t.tx + "," + t.ty);
    }
    expect(tiles.size).toBeGreaterThan(10);
  });
});

describe("boss numbers", () => {
  it("keeps the fight winnable but not trivial", () => {
    expect(BOSS.hp).toBeGreaterThan(100);
    expect(BOSS.pauseMin).toBe(3);
    expect(BOSS.pauseMax).toBe(7);
  });
});

describe("boss facing", () => {
  it("looks the way it moves", () => {
    expect(bossFacing("left", 2, 0, false)).toBe("right");
    expect(bossFacing("right", -2, 0, false)).toBe("left");
  });

  it("keeps its facing when it is barely moving", () => {
    expect(bossFacing("left", 0.1, 5, false)).toBe("left");
    expect(bossFacing("right", -0.1, -5, false)).toBe("right");
  });

  it("looks at the player while it aims, whichever way it drifts", () => {
    expect(bossFacing("left", -3, 4, true)).toBe("right");
    expect(bossFacing("right", 3, -4, true)).toBe("left");
    // player straight above or below: no turning
    expect(bossFacing("left", 0, 0.1, true)).toBe("left");
  });
});
