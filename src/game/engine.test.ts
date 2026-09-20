import { describe, expect, it, vi } from "vitest";
import { Game } from "./engine";
import { World, type WorldSave } from "./world";

// The engine only touches the canvas through getContext, so a stub is enough for logic tests.
function makeCanvas() {
  return {
    getContext: () => ({}),
    width: 640,
    height: 480,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
  } as unknown as HTMLCanvasElement;
}

function makeGame() {
  const g = new Game(makeCanvas(), { saveId: "test", seed: 1234, difficulty: "easy", save: null });
  g.x = 5.5;
  g.y = 5.5;
  g.dir = "right"; // facing tile is (6, 5)
  return g;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (g: Game) => g as any;

describe("farming", () => {
  it("leaves an unripe crop in the ground when it is clicked", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "farmland", obj: "crop1", pt: g.time });
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.get(6, 5).obj).toBe("crop1");
    expect(g.countPublic("wheat")).toBe(0);
  });

  it("harvests a ripe crop", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "farmland", obj: "crop3", pt: g.time - 500 });
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.get(6, 5).obj).toBeUndefined();
    expect(g.countPublic("wheat")).toBe(1);
  });
});

describe("creeper explosions", () => {
  it("destroy blocks but never the cave portals", () => {
    const g = makeGame();
    g.world.set(5, 5, { t: "dirt", obj: "cave_entrance" });
    g.world.set(6, 5, { t: "cave", obj: "cave_exit" });
    g.world.set(5, 6, { t: "dirt", obj: "block_stone" });
    priv(g).explode({ kind: "creeper", x: 5.5, y: 5.5, hp: 1 }, 22);
    expect(g.world.get(5, 5).obj).toBe("cave_entrance");
    expect(g.world.get(6, 5).obj).toBe("cave_exit");
    expect(g.world.get(5, 6).obj).toBeUndefined();
  });
});

describe("creeper explosions underground", () => {
  it("never break anything in the caves", () => {
    const g = makeGame();
    g.world = new World(1234, {}, "under");
    g.world.set(5, 5, { t: "cave", obj: "cave_exit" });
    g.world.set(6, 5, { t: "cave", obj: "block_stone" });
    g.world.set(5, 6, { t: "cave", obj: "door_closed" });
    g.world.set(4, 5, { t: "stone", ore: "iron" });
    priv(g).explode({ kind: "creeper", x: 5.5, y: 5.5, hp: 1 }, 22);
    expect(g.world.get(5, 5).obj).toBe("cave_exit");
    expect(g.world.get(6, 5).obj).toBe("block_stone");
    expect(g.world.get(5, 6).obj).toBe("door_closed");
    expect(g.world.get(4, 5).ore).toBe("iron");
  });

  it("still hurt the player", () => {
    const g = makeGame();
    g.world = new World(1234, {}, "under");
    const hp = g.hp;
    priv(g).explode({ kind: "creeper", x: 5.5, y: 5.5, hp: 1 }, 22);
    expect(g.hp).toBeLessThan(hp);
  });
});

describe("respawn", () => {
  it("brings the player back to the surface when they died underground", () => {
    const g = makeGame();
    g.world = new World(1234, {}, "under");
    g.dead = true;
    g.respawn();
    expect(g.world.layer).toBe("surface");
    const tx = Math.floor(g.x);
    const ty = Math.floor(g.y);
    expect(g.world.walkable(tx, ty)).toBe(true);
    expect(g.world.get(tx, ty).obj).toBeUndefined();
    expect(g.dead).toBe(false);
  });
});

describe("sleeping", () => {
  const DAY = 300;
  function sleepAt(time: number) {
    const g = makeGame();
    g.time = time;
    g.sleeping = 0.01;
    priv(g).update(0.05);
    return g.time;
  }

  it("wakes up the next morning when going to bed in the evening", () => {
    expect(sleepAt(DAY * 2 + 0.8 * DAY)).toBe(DAY * 3 + 20);
  });

  it("does not skip a whole extra day when it is already past midnight", () => {
    expect(sleepAt(DAY * 3 + 0.03 * DAY)).toBe(DAY * 3 + 20);
  });
});

describe("starvation", () => {
  it("shows the red damage flash while losing HP to hunger", () => {
    const g = makeGame();
    g.hunger = 0;
    g.hurtFlash = 0;
    const hp = g.hp;
    priv(g).update(0.016);
    expect(g.hp).toBeLessThan(hp);
    expect(g.hurtFlash).toBeGreaterThan(0);
  });
});

describe("cave portals", () => {
  /** a real surface cave entrance from the world generator */
  function findEntrance(seed: number) {
    const w = new World(seed);
    for (let ry = -3; ry <= 3; ry++) {
      for (let rx = -3; rx <= 3; rx++) {
        const a = w.anchor(rx, ry);
        if (a && w.get(a.x, a.y).obj === "cave_entrance") return a;
      }
    }
    throw new Error("no entrance found");
  }

  /** click (or tap) the middle of a tile, using the same camera maths as the renderer */
  function clickTile(g: Game, tx: number, ty: number) {
    const S = priv(g).tileSize();
    const W = 640;
    const H = 480;
    priv(g).onPointer({
      clientX: (tx + 0.5) * S - g.x * S + W / 2,
      clientY: (ty + 0.5) * S - g.y * S + H / 2,
    });
  }

  it("does nothing when the player just walks onto the cave", () => {
    const g = makeGame();
    const a = findEntrance(1234);
    g.x = a.x + 0.5;
    g.y = a.y + 0.5;
    priv(g).update(0.016);
    priv(g).update(0.016);
    expect(g.world.layer).toBe("surface");
  });

  it("goes down when the cave is clicked and back up when the exit is clicked", () => {
    const g = makeGame();
    const a = findEntrance(1234);
    g.x = a.x - 1 + 0.5;
    g.y = a.y + 0.5;

    clickTile(g, a.x, a.y);
    expect(g.world.layer).toBe("under");
    expect(Math.floor(g.x)).toBe(a.x);
    expect(Math.floor(g.y)).toBe(a.y);
    expect(g.world.get(a.x, a.y).obj).toBe("cave_exit");

    priv(g).portalCool = 0; // skip the double-click guard
    clickTile(g, a.x, a.y);
    expect(g.world.layer).toBe("surface");
    expect(Math.floor(g.x)).toBe(a.x);
    expect(Math.floor(g.y)).toBe(a.y);
  });

  it("ignores a click on a cave that is too far away", () => {
    const g = makeGame();
    const a = findEntrance(1234);
    g.x = a.x + 6.5;
    g.y = a.y + 0.5;
    clickTile(g, a.x, a.y);
    expect(g.world.layer).toBe("surface");
  });

  it("ignores clicks that are not on a cave", () => {
    const g = makeGame();
    clickTile(g, 6, 5);
    expect(g.world.layer).toBe("surface");
  });

  it("works with the use key (Enter / Space / A button) when facing the cave", () => {
    const g = makeGame();
    const a = findEntrance(1234);
    g.x = a.x - 1 + 0.5; // facing right puts the target tile on the entrance
    g.y = a.y + 0.5;
    g.dir = "right";
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.layer).toBe("under");
  });

  it("does not bounce straight back on a double click", () => {
    const g = makeGame();
    const a = findEntrance(1234);
    g.x = a.x + 0.5;
    g.y = a.y + 0.5;
    clickTile(g, a.x, a.y);
    clickTile(g, a.x, a.y); // still inside the cooldown
    expect(g.world.layer).toBe("under");
  });
});

describe("tool durability in play", () => {
  /** put a tool in the selected hotbar slot */
  function hold(g: Game, id: string) {
    g.slots[g.hotbar] = null;
    g.give(id, 1);
    const i = g.slots.findIndex((x) => x && x.id === id);
    g.slots[g.hotbar] = g.slots[i]!;
    if (i !== g.hotbar) g.slots[i] = null;
  }
  const mineFor = (g: Game) => {
    priv(g).input.held["use"] = true;
    priv(g).useLogic(4); // long enough to finish any block, even a tree by hand
    priv(g).input.held["use"] = false;
  };

  it("new tools start with the full uses for their material", () => {
    const g = makeGame();
    g.give("wood_pickaxe", 1);
    g.give("stone_axe", 1);
    g.give("iron_sword", 1);
    g.give("diamond_hoe", 1);
    const dur = (id: string) => g.slots.find((s) => s?.id === id)!.dur;
    expect([dur("wood_pickaxe"), dur("stone_axe"), dur("iron_sword"), dur("diamond_hoe")]).toEqual([5, 9, 12, 20]);
  });

  it("a wooden pickaxe breaks after 5 blocks", () => {
    const g = makeGame();
    hold(g, "wood_pickaxe");
    const left: (number | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      g.world.set(6, 5, { t: "stone" });
      mineFor(g);
      expect(g.world.get(6, 5).t).toBe("dirt"); // the block did break
      left.push(g.slots[g.hotbar]?.dur);
    }
    expect(left).toEqual([4, 3, 2, 1, undefined]);
    expect(g.slots[g.hotbar]).toBeNull();
  });

  it("a diamond pickaxe lasts 20 blocks and iron ore counts as one use", () => {
    const g = makeGame();
    hold(g, "diamond_pickaxe");
    g.world = new World(1234, {}, "under"); // ores only exist in the caves
    g.world.set(6, 5, { t: "stone", ore: "iron" });
    mineFor(g);
    expect(g.countPublic("iron")).toBe(1);
    expect(g.slots[g.hotbar]!.dur).toBe(19);
  });

  it("an axe wears when chopping a tree, but bare hands and the wrong tool do not", () => {
    const g = makeGame();
    hold(g, "stone_axe");
    g.world.set(6, 5, { t: "grass", obj: "tree" });
    mineFor(g);
    expect(g.slots[g.hotbar]!.dur).toBe(8);

    hold(g, "stone_pickaxe");
    g.world.set(6, 5, { t: "grass", obj: "tree" });
    mineFor(g);
    expect(g.world.get(6, 5).obj).toBeUndefined(); // still chopped, slowly
    expect(g.slots[g.hotbar]!.dur).toBe(9); // pickaxe untouched
  });

  it("a hoe wears once per tilled tile", () => {
    const g = makeGame();
    hold(g, "iron_hoe");
    g.world.set(6, 5, { t: "grass" });
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.get(6, 5).t).toBe("farmland");
    expect(g.slots[g.hotbar]!.dur).toBe(11);
  });

  it("a sword wears once per hit", () => {
    const g = makeGame();
    hold(g, "wood_sword");
    priv(g).wear("sword");
    priv(g).wear("sword");
    expect(g.slots[g.hotbar]!.dur).toBe(3);
    priv(g).wear("pickaxe"); // wrong type: nothing happens
    expect(g.slots[g.hotbar]!.dur).toBe(3);
  });

  it("tells the player when a tool breaks", () => {
    const g = makeGame();
    hold(g, "wood_axe");
    g.slots[g.hotbar]!.dur = 1;
    priv(g).wear("axe");
    expect(g.slots[g.hotbar]).toBeNull();
    expect(priv(g).toast).toContain("broke");
  });

  it("keeps durability when a held tool goes back into the bag", () => {
    const g = makeGame();
    g.slots[5] = { id: "stone_pickaxe", n: 1, dur: 3 };
    g.toggleInventory(); // open
    g.clickSlot(5); // pick it up
    expect(g.held?.dur).toBe(3);
    g.toggleInventory(); // close: it returns to the bag
    expect(g.held).toBeNull();
    expect(g.slots.find((s) => s?.id === "stone_pickaxe")!.dur).toBe(3);
  });

  it("saves and restores durability; older saves get brand new tools", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      const g = makeGame();
      g.slots[2] = { id: "iron_pickaxe", n: 1, dur: 7 };
      g.save();
      const saved = JSON.parse(store.get([...store.keys()].find((k) => k.includes("test"))!)!) as WorldSave;
      expect(saved.inv[2]).toEqual({ id: "iron_pickaxe", n: 1, dur: 7 });

      const base: WorldSave = {
        seed: 1234,
        difficulty: "easy",
        changes: {},
        player: { x: 5.5, y: 5.5, hp: 100, hunger: 100, time: 40 },
        inv: [
          { id: "iron_pickaxe", n: 1, dur: 7 },
          { id: "wood_axe", n: 1 }, // saved before durability existed
          { id: "diamond_sword", n: 1, dur: 500 }, // nonsense: clamped
          { id: "wood", n: 12 },
        ],
        hotbarIndex: 0,
      };
      const loaded = new Game(makeCanvas(), { saveId: "t2", seed: 1234, difficulty: "easy", save: base });
      expect(loaded.slots[0]).toEqual({ id: "iron_pickaxe", n: 1, dur: 7 });
      expect(loaded.slots[1]).toEqual({ id: "wood_axe", n: 1, dur: 5 });
      expect(loaded.slots[2]).toEqual({ id: "diamond_sword", n: 1, dur: 20 });
      expect(loaded.slots[3]).toEqual({ id: "wood", n: 12 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("coordinates", () => {
  const saveAt = (x: number, y: number, extra: Partial<WorldSave> = {}): WorldSave => ({
    seed: 1234,
    difficulty: "easy",
    changes: {},
    player: { x, y, hp: 100, hunger: 100, time: 40 },
    inv: [],
    hotbarIndex: 0,
    ...extra,
  });

  it("start at 0, 0, 0 where the player first spawns", () => {
    const g = new Game(makeCanvas(), { saveId: "c1", seed: 1234, difficulty: "easy", save: null });
    expect(g.coords()).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("count tiles from the spawn, with y growing upwards", () => {
    const g = new Game(makeCanvas(), { saveId: "c2", seed: 1234, difficulty: "easy", save: null });
    g.x += 3;
    g.y -= 2; // two tiles up on screen
    expect(g.coords()).toEqual({ x: 3, y: 2, z: 0 });
    g.x -= 5;
    g.y += 4;
    expect(g.coords()).toEqual({ x: -2, y: -2, z: 0 });
  });

  it("show a negative z in the caves", () => {
    const g = new Game(makeCanvas(), { saveId: "c3", seed: 1234, difficulty: "easy", save: null });
    g.world = new World(1234, {}, "under");
    expect(g.coords().z).toBeLessThan(0);
    g.world = new World(1234, {}, "surface");
    expect(g.coords().z).toBe(0);
  });

  it("use the saved origin", () => {
    const g = new Game(makeCanvas(), {
      saveId: "c4",
      seed: 1234,
      difficulty: "easy",
      save: saveAt(13.5, 18.5, { origin: { x: 10, y: 20 } }),
    });
    expect(g.coords()).toEqual({ x: 3, y: 2, z: 0 });
  });

  it("start from the current position when the save has no origin", () => {
    const g = new Game(makeCanvas(), { saveId: "c5", seed: 1234, difficulty: "easy", save: saveAt(40.5, -12.5) });
    expect(g.coords()).toEqual({ x: 0, y: 0, z: 0 });
    g.x += 1;
    expect(g.coords().x).toBe(1);
  });

  it("are written to the save so the origin never moves", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      const g = new Game(makeCanvas(), {
        saveId: "c6",
        seed: 1234,
        difficulty: "easy",
        save: saveAt(13.5, 18.5, { origin: { x: 10, y: 20 } }),
      });
      g.x += 20;
      g.save();
      const saved = JSON.parse(store.get([...store.keys()].find((k) => k.includes("c6"))!)!) as WorldSave;
      expect(saved.origin).toEqual({ x: 10, y: 20 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
