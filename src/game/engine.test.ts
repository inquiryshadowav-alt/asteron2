import { describe, expect, it } from "vitest";
import { Game } from "./engine";
import { World } from "./world";

// The engine only touches the canvas through getContext, so a stub is enough for logic tests.
function makeGame() {
  const canvas = {
    getContext: () => ({}),
    width: 640,
    height: 480,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
  } as unknown as HTMLCanvasElement;
  const g = new Game(canvas, { saveId: "test", seed: 1234, difficulty: "easy", save: null });
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
