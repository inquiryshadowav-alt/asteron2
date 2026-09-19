import { describe, expect, it, vi } from "vitest";
import { REGION, World, listWorlds, saveWorldMeta, type WorldMeta } from "./world";
import { ORE_ART, ORE_PALETTE } from "./sprites";

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

describe("ores are cave-only", () => {
  it("never generates iron or diamond on the surface", () => {
    for (const seed of SEEDS) {
      const w = new World(seed, {}, "surface");
      for (let y = -60; y < 60; y++) {
        for (let x = -60; x < 60; x++) {
          expect(w.get(x, y).ore, `surface ore at ${x},${y} (seed ${seed})`).toBeUndefined();
        }
      }
    }
  });

  it("hides ores that older saves still hold in surface tiles", () => {
    const w = new World(1, { "3,4": { t: "stone", ore: "iron" } }, "surface");
    expect(w.get(3, 4).ore).toBeUndefined();
    expect(w.get(3, 4).t).toBe("stone");
    // the same tile in the caves is untouched
    const under = new World(1, { "3,4": { t: "stone", ore: "iron" } }, "under");
    expect(under.get(3, 4).ore).toBe("iron");
  });

  it("generates both iron and diamond underground", () => {
    const found = new Set<string>();
    for (const seed of SEEDS) {
      const surface = new World(seed, {}, "surface");
      const under = new World(seed, {}, "under");
      for (let ry = -3; ry <= 3; ry++) {
        for (let rx = -3; rx <= 3; rx++) {
          const a = surface.anchor(rx, ry);
          if (!a) continue;
          for (let y = a.y - 16; y <= a.y + 16; y++) {
            for (let x = a.x - 16; x <= a.x + 16; x++) {
              const ore = under.get(x, y).ore;
              if (ore) found.add(ore);
            }
          }
        }
      }
    }
    expect([...found].sort()).toEqual(["diamond", "iron"]);
  });
});

describe("ore pixel art", () => {
  it.each(Object.keys(ORE_ART))("%s is a 16x16 map using only palette colours", (ore) => {
    const art = ORE_ART[ore]!;
    expect(art).toHaveLength(16);
    for (const row of art) {
      expect(row).toHaveLength(16);
      for (const ch of row) if (ch !== ".") expect(ORE_PALETTE[ore]![ch], `'${ch}' in ${ore}`).toBeDefined();
    }
  });
});
