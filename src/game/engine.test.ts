import { describe, expect, it, vi } from "vitest";
import { DAY_LEN, Game, MORNING, TORCH_RADIUS, darknessAt } from "./engine";
import { TOOLS_VERSION } from "./data";
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
  const DAY = DAY_LEN;
  function sleepAt(time: number) {
    const g = makeGame();
    g.time = time;
    g.sleeping = 0.01;
    priv(g).update(0.05);
    return g.time;
  }

  it("wakes up in the next morning, whenever in the night you went to bed", () => {
    for (const tod of [0.5, 0.7, 0.99]) {
      expect(sleepAt(DAY * 2 + tod * DAY), `tod ${tod}`).toBe(DAY * 3 + MORNING);
    }
  });

  it("only works at night", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "bed" });
    g.time = DAY * 2 + 0.3 * DAY; // daytime
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.sleeping).toBe(0);
    g.time = DAY * 2 + 0.7 * DAY;
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.sleeping).toBeGreaterThan(0);
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
    expect([dur("wood_pickaxe"), dur("stone_axe"), dur("iron_sword"), dur("diamond_hoe")]).toEqual([12, 18, 27, 40]);
  });

  it("a wooden pickaxe breaks after 12 blocks", () => {
    const g = makeGame();
    hold(g, "wood_pickaxe");
    const left: (number | undefined)[] = [];
    for (let i = 0; i < 12; i++) {
      g.world.set(6, 5, { t: "stone" });
      mineFor(g);
      expect(g.world.get(6, 5).t).toBe("dirt"); // the block did break
      left.push(g.slots[g.hotbar]?.dur);
    }
    expect(left).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, undefined]);
    expect(g.slots[g.hotbar]).toBeNull();
  });

  it("breaking tall grass by hand gives a seed and leaves plain dirt", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "dirt", obj: "tall_grass" });
    const seeds = g.countPublic("seeds");
    priv(g).input.held["use"] = true;
    priv(g).useLogic(0.05);
    priv(g).useLogic(0.05); // a couple of frames is enough
    priv(g).input.held["use"] = false;
    expect(g.countPublic("seeds")).toBe(seeds + 1);
    expect(g.world.get(6, 5).obj).toBeUndefined();
    expect(g.world.get(6, 5).t).toBe("dirt");
  });

  it("collecting tall grass does not wear a tool", () => {
    const g = makeGame();
    hold(g, "wood_pickaxe");
    g.world.set(6, 5, { t: "dirt", obj: "tall_grass" });
    mineFor(g);
    expect(g.world.get(6, 5).obj).toBeUndefined();
    expect(g.slots[g.hotbar]!.dur).toBe(12);
  });

  it("a diamond pickaxe lasts 40 blocks and iron ore counts as one use", () => {
    const g = makeGame();
    hold(g, "diamond_pickaxe");
    g.world = new World(1234, {}, "under"); // ores only exist in the caves
    g.world.set(6, 5, { t: "stone", ore: "iron" });
    mineFor(g);
    expect(g.countPublic("iron")).toBe(1);
    expect(g.slots[g.hotbar]!.dur).toBe(39);
  });

  it("an axe wears when chopping a tree, but bare hands and the wrong tool do not", () => {
    const g = makeGame();
    hold(g, "stone_axe");
    g.world.set(6, 5, { t: "grass", obj: "tree" });
    mineFor(g);
    expect(g.slots[g.hotbar]!.dur).toBe(17);

    hold(g, "stone_pickaxe");
    g.world.set(6, 5, { t: "grass", obj: "tree" });
    mineFor(g);
    expect(g.world.get(6, 5).obj).toBeUndefined(); // still chopped, slowly
    expect(g.slots[g.hotbar]!.dur).toBe(18); // pickaxe untouched
  });

  it("a hoe wears once per tilled tile", () => {
    const g = makeGame();
    hold(g, "iron_hoe");
    g.world.set(6, 5, { t: "grass" });
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.get(6, 5).t).toBe("farmland");
    expect(g.slots[g.hotbar]!.dur).toBe(26);
  });

  it("a sword wears once per hit", () => {
    const g = makeGame();
    hold(g, "wood_sword");
    priv(g).wear("sword");
    priv(g).wear("sword");
    expect(g.slots[g.hotbar]!.dur).toBe(10);
    priv(g).wear("pickaxe"); // wrong type: nothing happens
    expect(g.slots[g.hotbar]!.dur).toBe(10);
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

  it("saves and restores durability; older saves keep their wear and get the new maximums", () => {
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
      expect(saved.toolsV).toBe(TOOLS_VERSION);

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
      // this save predates the rebalance (no toolsV): 7 of 12 uses left becomes 22 of 27
      expect(loaded.slots[0]).toEqual({ id: "iron_pickaxe", n: 1, dur: 22 });
      expect(loaded.slots[1]).toEqual({ id: "wood_axe", n: 1, dur: 12 });
      expect(loaded.slots[2]).toEqual({ id: "diamond_sword", n: 1, dur: 40 });
      expect(loaded.slots[3]).toEqual({ id: "wood", n: 12 });

      // a save from the previous table (stone was 9): the stone tool gains the extra 9, the others stay put
      const inv = [
        { id: "stone_axe", n: 1, dur: 4 },
        { id: "wood_axe", n: 1, dur: 4 },
        { id: "iron_pickaxe", n: 1, dur: 7 },
      ];
      const v2 = new Game(makeCanvas(), {
        saveId: "t3",
        seed: 1234,
        difficulty: "easy",
        save: { ...base, inv, toolsV: 2 },
      });
      expect(v2.slots.slice(0, 3)).toEqual([
        { id: "stone_axe", n: 1, dur: 13 },
        { id: "wood_axe", n: 1, dur: 4 },
        { id: "iron_pickaxe", n: 1, dur: 7 },
      ]);

      // a save made with the current table is taken as it is
      const current = new Game(makeCanvas(), {
        saveId: "t4",
        seed: 1234,
        difficulty: "easy",
        save: { ...base, inv, toolsV: TOOLS_VERSION },
      });
      expect(current.slots.slice(0, 3)).toEqual(inv);
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

// ---------- torches, coal, mob deaths, lighting ----------

const mob = (kind: string, x: number, y: number, hp: number) => ({
  kind,
  x,
  y,
  hp,
  vx: 0,
  vy: 0,
  wander: 0,
  flee: 0,
  cool: 0,
  fuse: 0,
  flash: false,
  hurt: 0,
  bob: 0,
  cave: false,
});

/** put an item in the selected hotbar slot */
function hold(g: Game, id: string, n = 1) {
  g.slots[g.hotbar] = { id, n };
}
const tap = (g: Game) => {
  priv(g).input.pressedUse = true;
  priv(g).useLogic(0.016);
};
const holdUse = (g: Game, dt = 0.05, frames = 2) => {
  priv(g).input.held["use"] = true;
  for (let i = 0; i < frames; i++) priv(g).useLogic(dt);
  priv(g).input.held["use"] = false;
};

describe("torches", () => {
  it("are crafted from a coal and a stick", () => {
    const g = makeGame();
    g.give("coal", 1);
    g.give("stick", 1);
    expect(g.canCraft("torch")).toBe(true);
    g.craft("torch");
    expect(g.countPublic("torch")).toBe(4);
    expect(g.countPublic("coal")).toBe(0);
    expect(g.countPublic("stick")).toBe(0);
  });

  it.each(["grass", "dirt", "sand", "cave"] as const)("can be placed on %s ground", (ground) => {
    const g = makeGame();
    hold(g, "torch", 3);
    g.world.set(6, 5, { t: ground });
    tap(g);
    expect(g.world.get(6, 5).torch).toBe(true);
    expect(g.world.torches.has("6,5")).toBe(true);
    expect(g.slots[g.hotbar]!.n).toBe(2);
  });

  it("can be mounted on a block or a stone wall without breaking it", () => {
    const g = makeGame();
    hold(g, "torch", 5);
    g.world.set(6, 5, { t: "grass", obj: "block_stone" });
    priv(g).input.held["use"] = true; // holding the key must not chip the block away
    tap(g);
    priv(g).useLogic(0.5);
    priv(g).input.held["use"] = false;
    expect(g.world.get(6, 5).obj).toBe("block_stone");
    expect(g.world.get(6, 5).torch).toBe(true);

    g.world.set(6, 5, { t: "stone" }); // a natural wall
    tap(g);
    expect(g.world.get(6, 5).torch).toBe(true);
    expect(g.world.get(6, 5).t).toBe("stone");
  });

  it("cannot be placed on water, trees, ores or where there already is one", () => {
    const g = makeGame();
    hold(g, "torch", 9);
    const attempts: [string, Parameters<typeof g.world.set>[2]][] = [
      ["water", { t: "water" }],
      ["tree", { t: "grass", obj: "tree" }],
      ["ore", { t: "stone", ore: "coal" }],
      ["crop", { t: "farmland", obj: "crop1" }],
      ["door", { t: "grass", obj: "door_closed" }],
      ["torch", { t: "grass", torch: true }],
    ];
    for (const [name, tile] of attempts) {
      g.world.set(6, 5, tile);
      tap(g);
      expect(g.slots[g.hotbar]!.n, name).toBe(9); // nothing was used up
    }
    expect(g.world.get(6, 5).torch).toBe(true); // the old torch is still the only one
  });

  it("come back into the bag when mined, leaving the block underneath", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "block_stone", torch: true });
    hold(g, "wood", 1); // anything but a torch
    const before = g.countPublic("torch");
    holdUse(g);
    expect(g.countPublic("torch")).toBe(before + 1);
    expect(g.world.get(6, 5).torch).toBeUndefined();
    expect(g.world.get(6, 5).obj).toBe("block_stone");
    expect(g.world.torches.has("6,5")).toBe(false);
  });

  it("are not picked up again while a torch is in hand", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", torch: true });
    hold(g, "torch", 2);
    holdUse(g, 0.05, 6);
    expect(g.world.get(6, 5).torch).toBe(true);
  });

  it("keep monsters from spawning in their light", () => {
    const g = makeGame();
    g.time = DAY_LEN * 0.9; // night
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      // with this "random" every try picks the same spot, 14 tiles to the left of the player
      g.world.set(-9, 5, { t: "grass" });
      priv(g).trySpawn();
      expect(priv(g).mobs).toHaveLength(1);
      priv(g).mobs = [];
      g.world.set(-9, 5, { t: "grass", torch: true });
      priv(g).trySpawn();
      expect(priv(g).mobs).toHaveLength(0);
    } finally {
      rnd.mockRestore();
    }
  });

  it("are destroyed by a creeper on the surface but not underground", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", torch: true });
    priv(g).explode(mob("creeper", 5.5, 5.5, 1), 22);
    expect(g.world.get(6, 5).torch).toBeUndefined();
    expect(g.world.torches.size).toBe(0);

    g.world = new World(1234, {}, "under");
    g.world.set(6, 5, { t: "cave", torch: true });
    priv(g).explode(mob("creeper", 5.5, 5.5, 1), 22);
    expect(g.world.get(6, 5).torch).toBe(true);
  });

  it("light up a radius of a few tiles", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", torch: true });
    expect(TORCH_RADIUS).toBeGreaterThanOrEqual(3);
    expect(priv(g).nearTorch(6.5, 5.5 + TORCH_RADIUS - 0.5, TORCH_RADIUS)).toBe(true);
    expect(priv(g).nearTorch(6.5, 5.5 + TORCH_RADIUS + 2, TORCH_RADIUS)).toBe(false);
  });
});

describe("coal", () => {
  it("is mined with any pickaxe, drops coal and costs one use", () => {
    const g = makeGame();
    g.slots[g.hotbar] = { id: "wood_pickaxe", n: 1, dur: 12 };
    g.world.set(6, 5, { t: "stone", ore: "coal" });
    holdUse(g, 0.5, 4); // just long enough for the ore; the bare stone left behind is a separate block
    expect(g.countPublic("coal")).toBe(1);
    expect(g.world.get(6, 5).ore).toBeUndefined();
    expect(g.slots[g.hotbar]!.dur).toBe(11);
  });

  it("does not need a better pickaxe than wood, unlike iron", () => {
    const g = makeGame();
    g.world = new World(1234, {}, "under");
    g.slots[g.hotbar] = { id: "wood_pickaxe", n: 1, dur: 12 };
    g.world.set(6, 5, { t: "stone", ore: "iron" });
    holdUse(g, 0.5, 8);
    expect(g.world.get(6, 5).ore).toBe("iron");
    expect(g.countPublic("iron")).toBe(0);
  });
});

describe("mob deaths", () => {
  it("drop their loot and burst into pixels that fade away", () => {
    const g = makeGame();
    priv(g).mobs.push(mob("insect", 6.5, 5.5, 1));
    const meat = g.countPublic("meat");
    holdUse(g, 0.05, 1);
    expect(priv(g).mobs).toHaveLength(0);
    expect(g.countPublic("meat")).toBe(meat + 2);
    expect(g.particles.length).toBeGreaterThan(15);
    for (let i = 0; i < 40; i++) priv(g).updateParticles(0.05);
    expect(g.particles).toHaveLength(0);
  });

  it.each(["insect", "hover", "builder", "corrupted", "phantom", "electric", "creeper"])(
    "have an effect for the %s",
    (kind) => {
      const g = makeGame();
      priv(g).deathFx(mob(kind, 5.5, 5.5, 0));
      expect(g.particles.length).toBeGreaterThan(15);
      for (const p of g.particles) {
        expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(p.life).toBeGreaterThan(0);
      }
    },
  );

  it("also happen when a creeper blows up", () => {
    const g = makeGame();
    priv(g).explode(mob("creeper", 5.5, 5.5, 1), 22);
    expect(g.particles.length).toBeGreaterThan(15);
  });
});

describe("days", () => {
  it("are 7 minutes of daylight followed by 7 minutes of night", () => {
    expect(DAY_LEN).toBe(14 * 60);
    const g = makeGame();
    let day = 0;
    let night = 0;
    for (let t = 0; t < DAY_LEN; t++) {
      g.time = DAY_LEN * 4 + t;
      if (priv(g).isNight()) night++;
      else day++;
    }
    expect(day).toBe(7 * 60);
    expect(night).toBe(7 * 60);
  });

  it("start in bright daylight", () => {
    const g = new Game(makeCanvas(), { saveId: "d1", seed: 1234, difficulty: "easy", save: null });
    expect(g.time).toBe(MORNING);
    expect(priv(g).isNight()).toBe(false);
    expect(darknessAt((g.time % DAY_LEN) / DAY_LEN)).toBe(0);
  });

  it("fade in and out around the same points, and never jump", () => {
    expect(darknessAt(0.25)).toBe(0); // midday
    expect(darknessAt(0.75)).toBe(1); // midnight
    expect(darknessAt(0.5)).toBeCloseTo(0.5, 5); // night begins: dusk is half way
    expect(darknessAt(0)).toBeCloseTo(0.5, 5); // night ends: dawn is half way
    // no jump across the start of a new day
    expect(Math.abs(darknessAt(0.9999) - darknessAt(0))).toBeLessThan(0.01);
    // every step through the whole day changes the darkness only a little
    let prev = darknessAt(0);
    for (let i = 1; i <= 1000; i++) {
      const d = darknessAt(i / 1000);
      expect(Math.abs(d - prev)).toBeLessThan(0.02);
      prev = d;
    }
    // and the two halves are mirror images
    for (const off of [0.02, 0.05, 0.08]) {
      expect(darknessAt(0.5 - off) + darknessAt(0.5 + off)).toBeCloseTo(1, 5);
      expect(darknessAt(1 - off) + darknessAt(off)).toBeCloseTo(1, 5);
    }
  });
});

// a canvas context that records what it was asked to do
function recordingCtx() {
  const calls: { name: string; args: unknown[] }[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, k: string) => {
        if (k in state) return state[k];
        return (...args: unknown[]) => {
          calls.push({ name: k, args });
          return k === "createRadialGradient" || k === "createLinearGradient" ? { addColorStop() {} } : undefined;
        };
      },
      set: (_t, k: string, v) => {
        state[k] = v;
        calls.push({ name: "set:" + k, args: [v] });
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("torch light", () => {
  function setup() {
    const main = recordingCtx();
    const layer = recordingCtx();
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => layer.ctx }) });
    const canvas = {
      getContext: () => main.ctx,
      width: 640,
      height: 480,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
    } as unknown as HTMLCanvasElement;
    const g = new Game(canvas, { saveId: "light", seed: 1234, difficulty: "easy", save: null });
    g.x = 5.5;
    g.y = 5.5;
    return { g, main, layer };
  }
  const holes = (calls: { name: string; args: unknown[] }[]) =>
    calls.filter((c) => c.name === "set:globalCompositeOperation" && c.args[0] === "destination-out").length;

  it("cut holes in the night and the cave darkness, with a warm glow", () => {
    const { g, main, layer } = setup();
    try {
      g.world.set(7, 5, { t: "grass", torch: true });
      g.world.set(8, 6, { t: "grass", torch: true });
      priv(g).drawDarkness(main.ctx, 640, 480, 30, 0, 0, 0.5, false);
      expect(holes(layer.calls)).toBe(1);
      expect(layer.calls.filter((c) => c.name === "createRadialGradient")).toHaveLength(2); // one hole per torch
      expect(main.calls.some((c) => c.name === "drawImage")).toBe(true);
      expect(main.calls.some((c) => c.name === "set:globalCompositeOperation" && c.args[0] === "lighter")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("are not needed in daylight and don't glow without a torch", () => {
    const { g, main, layer } = setup();
    try {
      priv(g).drawDarkness(main.ctx, 640, 480, 30, 0, 0, 0.5, true); // a cave, no torches
      expect(layer.calls.filter((c) => c.name === "createRadialGradient")).toHaveLength(1); // just the player's circle
      expect(main.calls.some((c) => c.name === "set:globalCompositeOperation" && c.args[0] === "lighter")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("switch off while falling asleep", () => {
    const { g, main, layer } = setup();
    try {
      g.world.set(7, 5, { t: "grass", torch: true });
      g.sleeping = 1;
      priv(g).drawDarkness(main.ctx, 640, 480, 30, 0, 0, 0.95, false);
      expect(layer.calls.filter((c) => c.name === "createRadialGradient")).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("render a whole frame with torches, coal ore and a death burst without errors", () => {
    const { g, main } = setup();
    try {
      g.time = DAY_LEN * 0.9; // night
      g.world.set(7, 5, { t: "grass", torch: true });
      g.world.set(8, 5, { t: "stone", obj: "block_stone", torch: true });
      g.world.set(6, 6, { t: "stone", ore: "coal" });
      priv(g).deathFx(mob("phantom", 5.5, 5.5, 0));
      expect(() => priv(g).render()).not.toThrow();
      expect(main.calls.some((c) => c.name === "fillRect")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
