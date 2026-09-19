import { describe, expect, it } from "vitest";
import { Game } from "./engine";
import { World } from "./world";

// The engine only touches the canvas through getContext, so a stub is enough for logic tests.
function makeGame() {
  const canvas = { getContext: () => ({}), width: 640, height: 480 } as unknown as HTMLCanvasElement;
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
