import { describe, it, expect } from "vitest";
import { World } from "./world";

describe("One Block world", () => {
  it("is all void, and mobs/pathing treat void as not walkable while the player may step in", () => {
    const w = new World(123, {}, "surface", "oneblock");
    expect(w.get(50, -40).t).toBe("void");
    expect(w.walkable(50, -40)).toBe(false);
    expect(w.walkable(50, -40, true)).toBe(true);
  });
  it("keeps iron and diamond ore on the surface layer", () => {
    const w = new World(1, { "0,1": { t: "stone", ore: "diamond" } }, "surface", "oneblock");
    expect(w.get(0, 1).ore).toBe("diamond");
  });
  it("survival worlds are unchanged", () => {
    const w = new World(1);
    let voids = 0;
    for (let x = -20; x < 20; x++) for (let y = -20; y < 20; y++) if (w.get(x, y).t === "void") voids++;
    expect(voids).toBe(0);
  });
});

import { Game } from "./engine";

function oneBlockGame() {
  const canvas = { getContext: () => ({}), width: 640, height: 480, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) } as unknown as HTMLCanvasElement;
  return new Game(canvas, { saveId: "ob", seed: 77, difficulty: "easy", mode: "oneblock", save: null });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (g: Game) => g as any;
const mine = (g: Game) => {
  priv(g).input.held["use"] = true;
  priv(g).useLogic(9);
  priv(g).input.held["use"] = false;
};

describe("One Block play", () => {
  it("the source block can always be broken, whatever it grew into", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const g = oneBlockGame();
      g.world.seed = seed;
      for (const tile of [
        { t: "grass" as const }, { t: "dirt" as const }, { t: "sand" as const }, { t: "stone" as const },
        { t: "stone" as const, ore: "diamond" as const }, { t: "water" as const }, { t: "grass" as const, obj: "tree" as const },
      ]) {
        g.world.set(0, 1, tile);
        g.slots.fill(null);
        const n = priv(g).oneBlockN;
        mine(g);
        const after = g.world.get(0, 1);
        expect(priv(g).oneBlockN, JSON.stringify(tile)).toBe(n + 1); // it broke and regrew
        expect(after.t).not.toBe("void"); // the source regrows, never empty
      }
    }
  });

  it("the source never regrows as bare ground (which a held block would place on instead of breaking)", () => {
    const g = oneBlockGame();
    for (let i = 0; i < 400; i++) {
      priv(g).regenSource();
      const t = g.world.get(0, 1);
      expect(Boolean(t.obj || t.ore || t.t === "stone" || t.t === "water"), JSON.stringify(t)).toBe(true);
      expect(["ghost_block", "cave_entrance", "cave_exit", "bed", "bed2"]).not.toContain(t.obj);
    }
  });

  it("breaking bare ground gives a dirt block that turns void into floor", () => {
    const g = oneBlockGame();
    g.world.set(0, 1, { t: "grass" });
    mine(g);
    expect(g.countPublic("dirt")).toBe(1);
    // place it on the void to the right
    g.x = 0.5; g.y = 0.5; g.dir = "right";
    expect(g.world.get(1, 0).t).toBe("void");
    const i = g.slots.findIndex((s) => s?.id === "dirt");
    g.hotbar = i;
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.get(1, 0).t).toBe("dirt");
  });

  it("falling into the void kills the player", () => {
    const g = oneBlockGame();
    g.x = 5.5; g.y = 5.5;
    priv(g).update(0.016);
    expect(g.hp).toBeLessThanOrEqual(0);
  });
});
