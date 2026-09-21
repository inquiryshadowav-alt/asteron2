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

describe("ores", () => {
  it("never puts iron or diamond on the surface", () => {
    for (const seed of SEEDS) {
      const w = new World(seed, {}, "surface");
      for (let y = -60; y < 60; y++) {
        for (let x = -60; x < 60; x++) {
          const ore = w.get(x, y).ore;
          expect(ore === "iron" || ore === "diamond", `surface ${ore} at ${x},${y} (seed ${seed})`).toBe(false);
        }
      }
    }
  });

  it("puts coal in surface stone, and only in surface stone", () => {
    let coal = 0;
    for (const seed of SEEDS) {
      const w = new World(seed, {}, "surface");
      for (let y = -80; y < 80; y++) {
        for (let x = -80; x < 80; x++) {
          const t = w.get(x, y);
          if (t.ore === "coal") {
            coal++;
            expect(t.t, `coal on ${t.t} at ${x},${y} (seed ${seed})`).toBe("stone");
            expect(t.obj, `coal hidden under ${t.obj} at ${x},${y}`).toBeUndefined();
          }
        }
      }
    }
    expect(coal).toBeGreaterThan(20);
  });

  it("hides iron and diamond that older saves still hold in surface tiles, but keeps coal", () => {
    const changes = { "3,4": { t: "stone", ore: "iron" }, "5,4": { t: "stone", ore: "coal" } } as const;
    const w = new World(1, { ...changes } as never, "surface");
    expect(w.get(3, 4).ore).toBeUndefined();
    expect(w.get(3, 4).t).toBe("stone");
    expect(w.get(5, 4).ore).toBe("coal");
    // the same tile in the caves is untouched
    const under = new World(1, { ...changes } as never, "under");
    expect(under.get(3, 4).ore).toBe("iron");
  });

  it("generates coal, iron and diamond underground", () => {
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
    expect([...found].sort()).toEqual(["coal", "diamond", "iron"]);
  });
});

describe("torch bookkeeping", () => {
  it("tracks torches from saved changes and as they are placed and removed", () => {
    const w = new World(1, { "2,3": { t: "grass", torch: true }, "4,4": { t: "grass" } });
    expect([...w.torches]).toEqual(["2,3"]);
    w.set(7, 7, { t: "stone", obj: "block_stone", torch: true });
    expect(w.torches.has("7,7")).toBe(true);
    w.set(2, 3, { t: "grass", torch: undefined });
    expect(w.torches.has("2,3")).toBe(false);
    expect(w.torches.size).toBe(1);
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

describe("tall grass", () => {
  function scan(layer: "surface" | "under", visit: (t: { t: string; obj?: string | undefined }, x: number, y: number, seed: number) => void) {
    for (const seed of SEEDS) {
      const w = new World(seed, {}, layer);
      for (let y = -50; y < 50; y++) for (let x = -50; x < 50; x++) visit(w.get(x, y), x, y, seed);
    }
  }

  it("only ever grows on dirt, and does grow on some of it", () => {
    let tufts = 0;
    let dirt = 0;
    scan("surface", (t, x, y, seed) => {
      if (t.t === "dirt") dirt++;
      if (t.obj === "tall_grass") {
        tufts++;
        expect(t.t, `tall grass on ${t.t} at ${x},${y} (seed ${seed})`).toBe("dirt");
      }
    });
    expect(tufts).toBeGreaterThan(50);
    expect(tufts).toBeLessThan(dirt); // some dirt stays bare
  });

  it("is not in the caves, and can be walked through", () => {
    scan("under", (t) => expect(t.obj).not.toBe("tall_grass"));
    const w = new World(1, { "4,4": { t: "dirt", obj: "tall_grass" } }, "surface");
    expect(w.walkable(4, 4)).toBe(true);
  });
});
