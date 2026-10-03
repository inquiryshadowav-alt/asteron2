import { describe, expect, it } from "vitest";
import { DAY_LEN, Game, MORNING } from "./engine";
import { ITEMS, NAME_MAX, RECIPES, cleanName } from "./data";
import { SPRITE_URLS } from "./sprite-assets";
import type { WorldSave } from "./world";

function makeCanvas() {
  return {
    getContext: () => ({}),
    width: 640,
    height: 480,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
  } as unknown as HTMLCanvasElement;
}
function makeGame(save: WorldSave | null = null) {
  const g = new Game(makeCanvas(), { saveId: "test-name", seed: 1234, difficulty: "easy", save });
  g.x = 5.5;
  g.y = 5.5;
  g.dir = "right";
  g.slots.fill(null);
  g.mobs = [];
  return g;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (g: Game) => g as any;
const mob = (x: number, y: number, kind = "insect", extra = {}) => ({
  kind, x, y, hp: 14, vx: 0, vy: 0, wander: 0, flee: 0, cool: 0, fuse: 0, flash: false, hurt: 0, bob: 0, cave: false, ...extra,
});
let hud: { canName: boolean; naming: boolean } | null = null;
function emitHud(g: Game) {
  g.onHud = (h) => (hud = h);
  priv(g).emit();
  return hud!;
}

describe("name tag item", () => {
  it("is made from 2 iron and 1 settings block, and has an icon", () => {
    const r = RECIPES.find((x) => x.result === "name_tag")!;
    expect(r.need).toEqual([{ id: "iron", n: 2 }, { id: "settings", n: 1 }]);
    expect(SPRITE_URLS[ITEMS["name_tag"]!.icon!]).toBeTruthy();
    const g = makeGame();
    g.give("iron", 2);
    g.give("settings", 1);
    g.craft("name_tag");
    expect(g.countPublic("name_tag")).toBe(1);
    expect(g.countPublic("iron")).toBe(0);
  });

  it("cleans a name to at most 15 characters", () => {
    expect(NAME_MAX).toBe(15);
    expect(cleanName("  Bob   the\tGreat ")).toBe("Bob the Great");
    expect(cleanName("A very long name indeed")).toHaveLength(15);
    expect(cleanName("   ")).toBe("");
  });
});

describe("naming a mob", () => {
  it("shows [Use] only with a tag in hand and a mob very near", () => {
    const g = makeGame();
    g.mobs.push(mob(6.2, 5.5) as never);
    expect(emitHud(g).canName).toBe(false); // nothing in hand
    g.slots[g.hotbar] = { id: "name_tag", n: 1 };
    expect(emitHud(g).canName).toBe(true);
    g.mobs[0]!.x = 9; // 3.5 tiles away: too far
    expect(emitHud(g).canName).toBe(false);
  });

  it("names the mob, uses up one tag, and stops a tag from naming a Stormcaller minion", () => {
    const g = makeGame();
    g.slots[g.hotbar] = { id: "name_tag", n: 2 };
    g.mobs.push(mob(6, 5.5, "zombie", { minion: true }) as never);
    expect(g.beginNaming()).toBe(false);
    g.mobs = [mob(6, 5.5) as never];
    expect(g.beginNaming()).toBe(true);
    expect(emitHud(g).naming).toBe(true);
    expect(g.applyName("   ")).toBe(false); // empty
    expect(g.applyName("Sir Buzzalot the Brave")).toBe(true);
    expect(g.mobs[0]!.name).toBe("Sir Buzzalot th");
    expect(g.mobs[0]!.name).toHaveLength(15);
    expect(g.countPublic("name_tag")).toBe(1);
    expect(emitHud(g).naming).toBe(false);
  });

  it("opens from Space / Enter / A too, instead of hitting the mob, and freezes the game while open", () => {
    const g = makeGame();
    g.slots[g.hotbar] = { id: "name_tag", n: 1 };
    g.mobs = [mob(6.3, 5.5) as never];
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(emitHud(g).naming).toBe(true);
    expect(g.mobs[0]!.hp).toBe(14);
    const x = g.mobs[0]!.x;
    priv(g).update(1);
    expect(g.mobs[0]!.x).toBe(x);
    g.cancelNaming();
    expect(g.countPublic("name_tag")).toBe(1);
  });
});

describe("named mobs never despawn", () => {
  function named(g: Game, kind: string, x: number, y: number) {
    g.mobs.push(mob(x, y, kind, { name: "Pal" }) as never);
  }
  it("stay when far away, in daylight, and after sleeping", () => {
    const g = makeGame();
    g.time = MORNING + 0.1; // day
    named(g, "zombie", 5.5 + 60, 5.5); // hostile, far away, in daylight
    g.mobs.push(mob(5.5 + 60, 8, "insect") as never); // an unnamed one far away
    priv(g).updateMobs(0.1);
    expect(g.mobs.map((m) => m.name)).toEqual(["Pal"]);
    g.sleeping = 0.01;
    g.time = DAY_LEN * 0.9;
    priv(g).update(0.05);
    expect(g.mobs.some((m) => m.name)).toBe(true);
  });

  it("do not count against the spawn limits", () => {
    const g = makeGame();
    g.time = MORNING;
    for (let i = 0; i < 10; i++) named(g, "insect", 7 + i, 7);
    const before = g.mobs.length;
    priv(g).trySpawn();
    expect(g.mobs.length).toBe(before + 1);
  });

  it("wait in the cave or on the surface until the player returns, and survive a save", () => {
    const g = makeGame();
    g.world.set(5, 5, { t: "dirt", obj: "cave_entrance" });
    named(g, "insect", 6, 6);
    g.mobs.push(mob(8, 8, "hover") as never); // unnamed: dropped on the way
    priv(g).usePortal(5, 5);
    expect(g.world.layer).toBe("under");
    expect(g.mobs).toHaveLength(0);
    // save while below: the surface pet is in the file
    let saved: WorldSave | null = null;
    const store: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k] };
    g.save();
    saved = JSON.parse(store["mc2d.world.test-name"]!) as WorldSave;
    expect(saved.namedMobs).toEqual([expect.objectContaining({ kind: "insect", name: "Pal", layer: "surface" })]);
    // back up: it is still there
    priv(g).portalCool = 0;
    g.world.set(5, 5, { t: "cave", obj: "cave_exit" });
    priv(g).usePortal(5, 5);
    expect(g.world.layer).toBe("surface");
    expect(g.mobs.map((m) => m.name)).toEqual(["Pal"]);
    // and a fresh load of the save has it too
    const g2 = new Game(makeCanvas(), { saveId: "test-name", seed: 1234, difficulty: "easy", save: { ...saved, layer: "surface" } });
    expect(g2.mobs.map((m) => m.name)).toEqual(["Pal"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  });
});
