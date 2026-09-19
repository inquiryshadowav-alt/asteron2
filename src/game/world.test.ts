import { describe, expect, it, vi } from "vitest";
import { REGION, World, listWorlds, saveWorldMeta, type WorldMeta } from "./world";

const SEEDS = [1, 42, 1337, 90210, 2024, 777777, 31337, 555];

describe("cave portals", () => {
  it("every surface entrance can be walked onto and has a matching underground exit", () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const surface = new World(seed, {}, "surface");
      const under = new World(seed, {}, "under");
      for (let ry = -5; ry <= 5; ry++) {
        for (let rx = -5; rx <= 5; rx++) {
          const a = surface.anchor(rx, ry);
          if (!a) continue;
          const top = surface.get(a.x, a.y);
          if (top.t === "water") continue; // no entrance is generated on water
          expect(top.obj, `entrance at ${a.x},${a.y} (seed ${seed})`).toBe("cave_entrance");
          expect(surface.walkable(a.x, a.y), `entrance reachable at ${a.x},${a.y} (seed ${seed})`).toBe(true);
          expect(under.get(a.x, a.y).obj).toBe("cave_exit");
          expect(under.walkable(a.x, a.y)).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("keeps anchors inside their own region", () => {
    const w = new World(99);
    for (let ry = -4; ry <= 4; ry++) {
      for (let rx = -4; rx <= 4; rx++) {
        const a = w.anchor(rx, ry);
        if (!a) continue;
        expect(Math.floor(a.x / REGION)).toBe(rx);
        expect(Math.floor(a.y / REGION)).toBe(ry);
      }
    }
  });
});

describe("world list", () => {
  it("never drops older worlds when many are created", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      for (let i = 0; i < 15; i++) {
        const meta: WorldMeta = { id: "w" + i, name: "World " + i, seed: i, difficulty: "easy", created: i };
        saveWorldMeta(meta);
      }
      expect(listWorlds()).toHaveLength(15);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
