import { describe, expect, it } from "vitest";
import { Game } from "./engine";
import { FIRE, FLAMER_USES, maxDurability } from "./data";

function makeCanvas() {
  return {
    getContext: () => ({}),
    width: 640,
    height: 480,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
  } as unknown as HTMLCanvasElement;
}

function makeGame() {
  const g = new Game(makeCanvas(), { saveId: "test-fire", seed: 1234, difficulty: "easy", save: null });
  g.x = 5.5;
  g.y = 5.5;
  g.dir = "right"; // facing tile is (6, 5)
  g.slots.fill(null);
  // the generated world has trees of its own: start from bare grass around the test spot
  for (let y = 0; y <= 12; y++) for (let x = 0; x <= 16; x++) g.world.set(x, y, { t: "grass" });
  return g;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (g: Game) => g as any;

function shoot(g: Game) {
  g.slots[g.hotbar] = { id: "flamethrower", n: 1 };
  priv(g).flamerCool = 0;
  priv(g).input.pressedUse = true;
  priv(g).useLogic(0.016);
}

/** advance the fire simulation by `seconds` */
function burn(g: Game, seconds: number) {
  for (let t = 0; t < seconds; t += 0.1) {
    priv(g).updateFires(0.1);
    priv(g).updateGroundItems(0.1);
  }
}

describe("flamethrower", () => {
  it("is crafted from 1 settings block and 1 coal", () => {
    const g = makeGame();
    g.give("settings", 1);
    g.give("coal", 1);
    g.craft("flamethrower");
    expect(g.countPublic("flamethrower")).toBe(1);
    expect(g.countPublic("settings")).toBe(0);
    expect(g.countPublic("coal")).toBe(0);
  });

  it("does not chop or dig while in hand", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "block_stone" });
    g.slots[g.hotbar] = { id: "flamethrower", n: 1 };
    priv(g).input.held["use"] = true;
    for (let i = 0; i < 40; i++) priv(g).useLogic(0.1);
    expect(g.world.get(6, 5).obj).toBe("block_stone");
  });

  it("only puffs on stone, sand, water and blocks, and leaves them untouched", () => {
    for (const tile of [
      { t: "stone" as const },
      { t: "sand" as const },
      { t: "water" as const },
      { t: "grass" as const, obj: "block_stone" as const },
    ]) {
      const g = makeGame();
      g.world.set(6, 5, tile);
      shoot(g);
      expect(g.fires).toHaveLength(1);
      expect(g.fires[0]!.kind).toBe("puff");
      burn(g, FIRE.puff + 0.2);
      expect(g.fires).toHaveLength(0);
      expect(g.world.get(6, 5)).toEqual(tile);
      expect(g.groundItems).toHaveLength(0);
    }
  });

  it("burns open grass on that one tile only, then goes out", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass" });
    g.world.set(6, 6, { t: "grass", obj: "tree" });
    shoot(g);
    expect(g.fires).toHaveLength(1);
    expect(g.fires[0]!.kind).toBe("grass");
    burn(g, 1);
    expect(g.fires).toHaveLength(1);
    burn(g, FIRE.grass);
    expect(g.fires).toHaveLength(0);
    expect(g.world.get(6, 6).obj).toBe("tree"); // the next tile never caught
    expect(g.groundItems).toHaveLength(0);
  });

  it("burns tall grass and flowers off the grass tile", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "tall_grass" });
    shoot(g);
    burn(g, FIRE.grass + 0.2);
    expect(g.world.get(6, 5).obj).toBeUndefined();
    expect(g.world.get(6, 5).t).toBe("grass");
  });

  it("burns a tree for a few seconds, then leaves coal on the ground", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "tree" });
    shoot(g);
    expect(g.fires[0]!.kind).toBe("wood");
    burn(g, FIRE.wood - 0.5);
    expect(g.world.get(6, 5).obj).toBe("tree"); // still burning
    burn(g, 1);
    expect(g.world.get(6, 5).obj).toBeUndefined();
    expect(g.groundItems).toHaveLength(1);
    expect(g.groundItems[0]).toMatchObject({ x: 6.5, y: 5.5, id: "coal", n: 1 });
  });

  it("spreads along trees and wood blocks, jumping a one-tile gap but not two", () => {
    const g = makeGame();
    // 6,5 (lit) - 7,5 touching - 9,5 one-tile gap - 12,5 a two-tile-plus gap away
    for (const x of [6, 7, 9]) g.world.set(x, 5, { t: "grass", obj: "tree" });
    g.world.set(8, 6, { t: "grass", obj: "block_wood", dye: "red" }); // painted wood burns as well
    g.world.set(12, 5, { t: "grass", obj: "tree" });
    shoot(g);
    burn(g, 15);
    for (const [x, y] of [[6, 5], [7, 5], [9, 5], [8, 6]] as const) expect(g.world.get(x, y).obj, `${x},${y}`).toBeUndefined();
    expect(g.world.get(12, 5).obj).toBe("tree");
    expect(g.groundItems).toHaveLength(4);
    expect(g.fires).toHaveLength(0);
  });

  it("coal lies around for 3 minutes, can be picked up, and then disappears", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "tree" });
    shoot(g);
    burn(g, FIRE.wood + 0.5);
    expect(g.groundItems).toHaveLength(1);
    burn(g, 120);
    expect(g.groundItems).toHaveLength(1);
    burn(g, 70);
    expect(g.groundItems).toHaveLength(0);
    expect(g.countPublic("coal")).toBe(0);

    const h = makeGame();
    h.world.set(6, 5, { t: "grass", obj: "tree" });
    shoot(h);
    burn(h, FIRE.wood + 0.5);
    h.x = 6.5;
    h.y = 5.5; // walk over it
    burn(h, 0.2);
    expect(h.groundItems).toHaveLength(0);
    expect(h.countPublic("coal")).toBe(1);
  });

  it("a tree chopped down mid-burn just stops burning", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "tree" });
    shoot(g);
    g.world.set(6, 5, { t: "grass" });
    burn(g, FIRE.wood + 1);
    expect(g.fires).toHaveLength(0);
    expect(g.groundItems).toHaveLength(0);
  });
});

describe("painted wood", () => {
  it("places as a coloured block and drops the same colour when broken", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass" });
    g.slots[g.hotbar] = { id: "wood_red", n: 2 };
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.get(6, 5).obj).toBe("block_wood");
    expect(g.world.get(6, 5).dye).toBe("red");
    expect(g.countPublic("wood_red")).toBe(1);

    g.setHotbar(1); // empty hands
    priv(g).input.held["use"] = true;
    for (let i = 0; i < 30; i++) priv(g).useLogic(0.1);
    expect(g.world.get(6, 5).obj).toBeUndefined();
    expect(g.countPublic("wood_red")).toBe(2);
    expect(g.countPublic("wood")).toBe(0);
  });

  it("plain wood still places and drops as plain wood", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass" });
    g.slots[g.hotbar] = { id: "wood", n: 1 };
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.get(6, 5).dye).toBeUndefined();
  });

  it("is made in the paint block from a dye and wood", () => {
    const g = makeGame();
    g.paintOpen = true;
    g.paintA = { id: "blue_dye", n: 2 };
    g.paintB = { id: "wood", n: 3 };
    expect(g.paintOutput()).toEqual({ id: "wood_blue", n: 1 });
    g.held = null;
    g.takePaintResult();
    expect(g.held).toEqual({ id: "wood_blue", n: 1 });
    expect(g.paintA).toEqual({ id: "blue_dye", n: 1 });
    expect(g.paintB).toEqual({ id: "wood", n: 2 });
  });
});

describe("fire: diagonals, doors, durability and clicking", () => {
  it("spreads diagonally, touching or across a one-tile gap, but not further", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "tree" }); // lit
    g.world.set(7, 6, { t: "grass", obj: "tree" }); // diagonal, touching
    g.world.set(9, 8, { t: "grass", obj: "block_wood" }); // diagonal from (7,6) with a one-tile gap
    g.world.set(12, 11, { t: "grass", obj: "tree" }); // diagonal, two tiles of gap: safe
    shoot(g);
    burn(g, 15);
    for (const [x, y] of [[6, 5], [7, 6], [9, 8]] as const) expect(g.world.get(x, y).obj, `${x},${y}`).toBeUndefined();
    expect(g.world.get(12, 11).obj).toBe("tree");
    expect(g.groundItems).toHaveLength(3);
  });

  it("burns doors, open or closed, and lets fire pass through them", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "door_closed" });
    g.world.set(7, 5, { t: "grass", obj: "tree" });
    g.world.set(8, 6, { t: "grass", obj: "door_open" });
    shoot(g);
    // the door must burn, not swing open
    expect(g.world.get(6, 5).obj).toBe("door_closed");
    expect(g.fires[0]!.kind).toBe("wood");
    burn(g, 15);
    for (const [x, y] of [[6, 5], [7, 5], [8, 6]] as const) expect(g.world.get(x, y).obj, `${x},${y}`).toBeUndefined();
    expect(g.groundItems).toHaveLength(3);
  });

  it("can be fired 20 times and is then used up", () => {
    expect(FLAMER_USES).toBe(20);
    expect(maxDurability("flamethrower")).toBe(20);
    const g = makeGame();
    g.give("flamethrower", 1);
    expect(g.slots[0]).toMatchObject({ id: "flamethrower", dur: 20 });
    g.world.set(6, 5, { t: "stone" });
    for (let i = 0; i < 20; i++) {
      expect(g.slots[0]?.id, `shot ${i + 1}`).toBe("flamethrower");
      priv(g).flamerCool = 0;
      g.fires = [];
      priv(g).input.pressedUse = true;
      priv(g).useLogic(0.016);
    }
    expect(g.slots[0]).toBeNull();
    expect(g.countPublic("flamethrower")).toBe(0);
  });

  it("does not spend a charge on a tile that is already burning, or while holding the key", () => {
    const g = makeGame();
    g.give("flamethrower", 1);
    g.world.set(6, 5, { t: "stone" });
    priv(g).input.pressedUse = true;
    priv(g).input.held["use"] = true;
    priv(g).useLogic(0.016);
    for (let i = 0; i < 30; i++) priv(g).useLogic(0.1); // key held down
    expect(g.slots[0]!.dur).toBe(19);
    priv(g).flamerCool = 0;
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016); // the puff on that tile has not ended yet: ignored
    expect(g.slots[0]!.dur).toBe(19);
  });

  it("fires on a mouse click / tap too: turns towards it and shoots the tile in front", () => {
    const g = makeGame();
    g.give("flamethrower", 1);
    g.world.set(5, 4, { t: "grass", obj: "tree" }); // above the player
    g.dir = "right";
    // click above the player (screen centre is the player)
    priv(g).onPointer({ clientX: 320, clientY: 240 - 40 });
    expect(g.dir).toBe("up");
    expect(g.fires).toHaveLength(1);
    expect(g.fires[0]).toMatchObject({ tx: 5, ty: 4, kind: "wood" });
    expect(g.slots[0]!.dur).toBe(19);
  });

  it("keeps its remaining charges across a save", () => {
    const g = makeGame();
    g.slots[0] = { id: "flamethrower", n: 1, dur: 7 };
    expect(priv(g).restoreSlot({ id: "flamethrower", n: 1, dur: 7 })).toMatchObject({ dur: 7 });
    expect(priv(g).restoreSlot({ id: "flamethrower", n: 1 })).toMatchObject({ dur: 20 });
  });
});
