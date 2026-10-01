import { describe, expect, it } from "vitest";
import { Game } from "./engine";
import { BOSS, BOSS_LOOT, GHOST_CYCLE, GHOST_RANGE } from "./boss";
import { ITEMS, RECIPES, SWORD_DAMAGE, TOOL_USES, rollSwordPower } from "./data";
import { SPRITE_URLS } from "./sprite-assets";
import { World } from "./world";

function makeCanvas() {
  return {
    getContext: () => ({}),
    width: 640,
    height: 480,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
  } as unknown as HTMLCanvasElement;
}

function makeGame(difficulty: "easy" | "hard" = "easy") {
  const g = new Game(makeCanvas(), { saveId: "test", seed: 1234, difficulty, save: null });
  g.x = 5.5;
  g.y = 5.5;
  g.dir = "right"; // facing tile is (6, 5)
  g.hp = 1e6; // fights below check damage by hp lost, so nothing should end the run
  return g;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (g: Game) => g as any;

const zombie = (x = 6.5, y = 5.5) => ({
  kind: "zombie" as const,
  x,
  y,
  hp: 1,
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

/** give an item and select it on the hotbar */
function hold(g: Game, id: string) {
  g.give(id, 1);
  g.setHotbar(g.slots.findIndex((s) => s?.id === id));
}

/** put a Ghost Block on tile (6, 5) placed at the game's current time */
function placeGhost(g: Game, x = 6, y = 5) {
  g.world.set(x, y, { t: "grass", obj: "ghost_block", pt: g.time });
}

/** a boss already out of its block, in the pause state, at (x, y) */
function spawnBoss(g: Game, x: number, y: number) {
  priv(g).summonBoss(x, y);
  const b = priv(g).boss;
  b.state = "pause";
  b.t = 99;
  return b;
}

/** the game's own clock: advance time and run the boss update */
function step(g: Game, seconds: number, dt = 0.05) {
  for (let t = 0; t < seconds; t += dt) {
    g.time += dt;
    priv(g).updateGhosts();
    priv(g).updateBoss(dt);
  }
}

describe("zombies and XP", () => {
  it("is a hostile mob that drops exactly 1 XP and nothing else", () => {
    const g = makeGame();
    const z = zombie();
    priv(g).mobs.push(z);
    priv(g).killMob(z);
    expect(g.countPublic("xp")).toBe(1);
    expect(g.countPublic("diamond")).toBe(0);
    expect(priv(g).mobs).toHaveLength(0);
  });

  it("dies to a sword swing and pays out", () => {
    const g = makeGame();
    hold(g, "diamond_sword");
    priv(g).mobs.push(zombie(6.5, 5.5));
    priv(g).input.held["use"] = true;
    priv(g).useLogic(0.016);
    expect(g.countPublic("xp")).toBe(1);
  });

  it("shows up at night in the world", () => {
    const g = makeGame();
    g.time = 0.6 * 840; // night
    g.x = g.y = 0.5;
    const kinds = new Set<string>();
    for (let i = 0; i < 400; i++) {
      priv(g).mobs = [];
      priv(g).trySpawn();
      for (const m of priv(g).mobs) kinds.add(m.kind);
    }
    expect(kinds.has("zombie")).toBe(true);
  });

  it("never drops diamonds: those stay in the caves", () => {
    const g = makeGame();
    for (let i = 0; i < 20; i++) {
      const z = zombie();
      priv(g).mobs.push(z);
      priv(g).killMob(z);
    }
    expect(g.countPublic("xp")).toBe(20);
    expect(g.countPublic("diamond")).toBe(0);
  });
});

describe("crafting the Ghost Block", () => {
  it("costs 10 XP and 10 Diamonds", () => {
    const r = RECIPES.find((x) => x.id === "ghost_block")!;
    expect(r.result).toBe("ghost_block");
    expect(r.need).toEqual([
      { id: "xp", n: 10 },
      { id: "diamond", n: 10 },
    ]);
  });

  it("needs both", () => {
    const g = makeGame();
    g.give("xp", 10);
    g.give("diamond", 9);
    expect(g.canCraft("ghost_block")).toBe(false);
    g.give("diamond", 1);
    expect(g.canCraft("ghost_block")).toBe(true);

    const h = makeGame();
    h.give("xp", 9);
    h.give("diamond", 10);
    expect(h.canCraft("ghost_block")).toBe(false);
  });

  it("spends the materials", () => {
    const g = makeGame();
    g.give("xp", 12);
    g.give("diamond", 10);
    g.craft("ghost_block");
    expect(g.countPublic("ghost_block")).toBe(1);
    expect(g.countPublic("xp")).toBe(2);
    expect(g.countPublic("diamond")).toBe(0);
  });

  it("has art for every new item", () => {
    for (const id of ["xp", "ghost_block", "shiny_metal", "super_sword"]) {
      expect(SPRITE_URLS[ITEMS[id]!.icon!], id).toBeTruthy();
    }
    expect(SPRITE_URLS["stormcaller"]).toBeTruthy();
    expect(SPRITE_URLS["zombie"]).toBeTruthy();
  });
});

describe("placing the Ghost Block", () => {
  it("places on the surface and starts its pulse clock", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass" });
    hold(g, "ghost_block");
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    const t = g.world.get(6, 5);
    expect(t.obj).toBe("ghost_block");
    expect(t.pt).toBe(g.time);
    expect(g.countPublic("ghost_block")).toBe(0);
  });

  it("is solid", () => {
    const g = makeGame();
    placeGhost(g);
    expect(g.world.walkable(6, 5)).toBe(false);
  });

  it("refuses to be placed underground", () => {
    const g = makeGame();
    g.world = new World(1234, {}, "under");
    g.world.set(6, 5, { t: "cave" });
    hold(g, "ghost_block");
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.get(6, 5).obj).toBeUndefined();
    expect(g.countPublic("ghost_block")).toBe(1);
  });
});

describe("the Ghost Block is unbreakable", () => {
  it("cannot be mined, even with a diamond pickaxe held for a long time", () => {
    const g = makeGame();
    placeGhost(g);
    hold(g, "diamond_pickaxe");
    priv(g).input.held["use"] = true;
    for (let i = 0; i < 200; i++) priv(g).useLogic(0.1);
    priv(g).input.held["use"] = false;
    expect(g.world.get(6, 5).obj).toBe("ghost_block");
    expect(g.countPublic("ghost_block")).toBe(0);
  });

  it("cannot be mined by hand either, and says why", () => {
    const g = makeGame();
    placeGhost(g);
    priv(g).input.held["use"] = true;
    priv(g).input.pressedUse = true;
    for (let i = 0; i < 100; i++) priv(g).useLogic(0.2);
    expect(g.world.get(6, 5).obj).toBe("ghost_block");
    expect(g.toast).toMatch(/cannot be broken/i);
  });

  it("survives creeper explosions", () => {
    const g = makeGame();
    placeGhost(g);
    g.world.set(5, 6, { t: "dirt", obj: "block_stone" });
    priv(g).explode({ kind: "creeper", x: 6.5, y: 5.5, hp: 1 }, 22);
    expect(g.world.get(6, 5).obj).toBe("ghost_block");
    expect(g.world.get(5, 6).obj).toBeUndefined(); // ordinary blocks still blow up
  });
});

describe("Ghost Block spawn mechanics", () => {
  it("does nothing while idle, then summons the boss when the pulse cycle ends", () => {
    const g = makeGame();
    placeGhost(g);
    step(g, GHOST_CYCLE - 1);
    expect(priv(g).boss).toBeNull();
    step(g, 2);
    expect(priv(g).boss).not.toBeNull();
  });

  it("spawns the boss right on the block", () => {
    const g = makeGame();
    placeGhost(g);
    step(g, GHOST_CYCLE + 0.1);
    const b = priv(g).boss;
    expect(b.x).toBeCloseTo(6.5, 0);
    expect(b.y).toBeCloseTo(5.5, 0);
    expect(b.hp).toBe(BOSS.hp);
    expect(b.state).toBe("emerge");
  });

  it("checks nothing around it: a block walled in by stone and water still summons", () => {
    const g = makeGame();
    for (const [x, y] of [[5, 4], [6, 4], [7, 4], [5, 5], [7, 5], [5, 6], [6, 6], [7, 6]] as const) {
      g.world.set(x, y, { t: "water" });
    }
    g.world.set(6, 5, { t: "stone", obj: "ghost_block", pt: g.time });
    step(g, GHOST_CYCLE + 0.1);
    expect(priv(g).boss).not.toBeNull();
  });

  it("is used up by its summon: the block disappears and never summons a second boss", () => {
    const g = makeGame();
    placeGhost(g);
    step(g, GHOST_CYCLE + 0.1);
    expect(priv(g).boss).not.toBeNull();
    expect(g.world.get(6, 5).obj).toBeUndefined();
    expect(g.world.get(6, 5).pt).toBeUndefined();
    priv(g).boss.hp = 1;
    priv(g).killBoss();
    step(g, GHOST_CYCLE * 3);
    expect(priv(g).boss).toBeNull();
  });

  it("keeps its block when it could not summon (player too far away) and tries the next pulse", () => {
    const g = makeGame();
    placeGhost(g);
    g.x = 6.5 + GHOST_RANGE + 5;
    step(g, GHOST_CYCLE + 0.1);
    expect(priv(g).boss).toBeNull();
    expect(g.world.get(6, 5).obj).toBe("ghost_block");
    g.x = 5.5;
    step(g, GHOST_CYCLE);
    expect(priv(g).boss).not.toBeNull();
    expect(g.world.get(6, 5).obj).toBeUndefined();
  });

  it("never runs two bosses at once", () => {
    const g = makeGame();
    placeGhost(g, 6, 5);
    placeGhost(g, 8, 5);
    step(g, GHOST_CYCLE + 0.1);
    expect(priv(g).boss).not.toBeNull();
    const first = priv(g).boss;
    // only the block that actually summoned is spent; the other stays for a later fight
    expect([g.world.get(6, 5).obj, g.world.get(8, 5).obj].filter((o) => o === "ghost_block")).toHaveLength(1);
    step(g, GHOST_CYCLE);
    expect(priv(g).boss).toBe(first);
  });

  it("does not fire for the pulses slept through, or on the first look after loading", () => {
    const g = makeGame();
    placeGhost(g);
    g.time += GHOST_CYCLE * 5; // a long time passes with nobody watching
    priv(g).updateGhosts();
    expect(priv(g).boss).toBeNull();
    step(g, 2);
    expect(priv(g).boss).toBeNull();
  });

  it("waits for the player: nothing comes out if they are far away", () => {
    const g = makeGame();
    placeGhost(g);
    g.x = 6.5 + GHOST_RANGE + 5;
    step(g, GHOST_CYCLE + 0.1);
    expect(priv(g).boss).toBeNull();
  });
});

describe("Stormcaller health", () => {
  it("has 3x its previous HP (960 -> 2880)", () => {
    expect(BOSS.hp).toBe(960 * 3);
    const g = makeGame();
    const b = spawnBoss(g, 20.5, 5.5);
    expect(b.hp).toBe(2880);
    expect(b.max).toBe(2880);
  });
});

describe("Stormcaller facing skin", () => {
  it("has a skin for each direction", () => {
    expect(SPRITE_URLS["stormcaller"]).toBeTruthy();
    expect(SPRITE_URLS["stormcaller_right"]).toBeTruthy();
    expect(SPRITE_URLS["stormcaller_right"]).not.toBe(SPRITE_URLS["stormcaller"]);
  });

  it("rises facing the player", () => {
    const g = makeGame();
    priv(g).summonBoss(20.5, 5.5); // player is to the west
    expect(priv(g).boss.face).toBe("left");
    const h = makeGame();
    priv(h).summonBoss(-10.5, 5.5); // player is to the east
    expect(priv(h).boss.face).toBe("right");
  });

  it("faces right when it moves right and left when it moves left", () => {
    const g = makeGame();
    g.x = 20.5;
    g.y = 5.5;
    const b = spawnBoss(g, 5.5, 5.5); // boss far west of the player: it drifts east
    b.face = "left";
    step(g, 1);
    expect(b.x).toBeGreaterThan(5.5);
    expect(b.face).toBe("right");

    g.x = -20.5; // the player is now far to the west: it turns round and heads that way
    step(g, 3);
    expect(b.face).toBe("left");
  });

  it("looks at the player while winding up an attack", () => {
    const g = makeGame();
    g.x = 15.5;
    g.y = 5.5;
    const b = spawnBoss(g, 10.5, 5.5);
    b.face = "left";
    priv(g).beginWindup(b, "laser");
    step(g, 0.1);
    expect(b.face).toBe("right"); // player is to its right
  });

  it("does not flip-flop: turns are spaced out", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 5.5);
    let turns = 0;
    let last = b.face;
    for (let i = 0; i < 200; i++) {
      g.x = 10.5 + (i % 2 ? 5 : -5); // player jumps from side to side every frame
      b.state = "windup";
      b.move = "laser";
      b.t = 99;
      step(g, 0.05);
      if (b.face !== last) {
        turns++;
        last = b.face;
      }
    }
    expect(turns).toBeLessThanOrEqual(Math.ceil(10 / 0.35) + 1);
  });
});

describe("Stormcaller moves", () => {
  it("laser: hits a player standing on one of the 8 lines", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 10.5);
    g.x = 15.5;
    g.y = 10.7; // east of the boss, almost level
    const before = g.hp;
    b.move = "laser";
    priv(g).fireBossMove(b, 1);
    priv(g).updateBossCasts(0.016, 1);
    expect(before - g.hp).toBe(BOSS.laser.dmg);
  });

  it("laser: also fires along diagonals", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 10.5);
    g.x = 15.6;
    g.y = 15.4; // south-east, nearly on the diagonal
    const before = g.hp;
    b.move = "laser";
    priv(g).fireBossMove(b, 1);
    const beam = priv(g).beams[0];
    expect(Math.abs(beam.dx)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(Math.abs(beam.dy)).toBeCloseTo(Math.SQRT1_2, 6);
    priv(g).updateBossCasts(0.016, 1);
    expect(before - g.hp).toBe(BOSS.laser.dmg);
  });

  it("laser: misses a player who is between two of the 8 lines", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 10.5);
    g.x = 15.5;
    g.y = 12.5; // ~22 degrees below east: snaps east, but 2 tiles off that line
    const before = g.hp;
    b.move = "laser";
    priv(g).fireBossMove(b, 1);
    priv(g).updateBossCasts(0.016, 1);
    expect(g.hp).toBe(before);
  });

  it("laser: is fixed at release and never homes, and hurts once", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 10.5);
    g.x = 15.5;
    g.y = 10.5;
    b.move = "laser";
    priv(g).fireBossMove(b, 1);
    const { dx, dy } = priv(g).beams[0];
    g.x = 10.5; // the player runs round to the other side
    g.y = 16.5;
    const before = g.hp;
    for (let i = 0; i < 6; i++) priv(g).updateBossCasts(0.05, 1);
    expect(g.hp).toBe(before);
    expect(priv(g).beams[0]).toMatchObject({ dx, dy });
    // and a player who stays in the line is only hit once per beam
    const h = makeGame();
    const hb = spawnBoss(h, 10.5, 10.5);
    h.x = 14.5;
    h.y = 10.5;
    hb.move = "laser";
    priv(h).fireBossMove(hb, 1);
    const start = h.hp;
    for (let i = 0; i < 6; i++) priv(h).updateBossCasts(0.05, 1);
    expect(start - h.hp).toBe(BOSS.laser.dmg);
  });

  it("storm blast: close-range damage plus heavy knockback away from the boss", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 10.5);
    g.x = 11.5;
    g.y = 10.5;
    const before = g.hp;
    b.move = "storm";
    priv(g).fireBossMove(b, 1);
    expect(before - g.hp).toBe(BOSS.storm.dmg);
    expect(g.kx).toBeGreaterThan(BOSS.storm.knock * 0.9);
    expect(Math.abs(g.ky)).toBeLessThan(0.01);
  });

  it("storm blast: the knockback slides the player across open ground and then fades out", () => {
    const g = makeGame();
    for (let x = 6; x <= 30; x++) g.world.set(x, 10, { t: "grass" });
    const b = spawnBoss(g, 10.5, 10.5);
    g.x = 11.5;
    g.y = 10.5;
    b.move = "storm";
    priv(g).fireBossMove(b, 1);
    for (let i = 0; i < 40; i++) priv(g).update(0.05);
    expect(g.x).toBeGreaterThan(12.5); // pushed away from the boss
    expect(g.kx).toBe(0); // and it has worn off
    expect(g.y).toBeCloseTo(10.5, 1);
  });

  it("storm blast: knockback stops at a wall", () => {
    const g = makeGame();
    for (let x = 6; x <= 30; x++) g.world.set(x, 10, { t: "grass" });
    g.world.set(13, 10, { t: "grass", obj: "block_stone" });
    const b = spawnBoss(g, 10.5, 10.5);
    g.x = 11.5;
    g.y = 10.5;
    b.move = "storm";
    priv(g).fireBossMove(b, 1);
    for (let i = 0; i < 40; i++) priv(g).update(0.05);
    expect(g.x).toBeLessThan(13); // never inside the block
  });

  it("storm blast: does nothing to a player out of its reach", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 10.5);
    g.x = 10.5 + BOSS.storm.radius + 1;
    g.y = 10.5;
    const before = g.hp;
    b.move = "storm";
    priv(g).fireBossMove(b, 1);
    expect(g.hp).toBe(before);
    expect(g.kx).toBe(0);
  });

  it("storm blast: the boss dashes in close before it goes off", () => {
    const g = makeGame();
    const b = spawnBoss(g, 20.5, 5.5);
    b.state = "recover";
    b.queue = ["storm"];
    b.t = 0;
    step(g, 0.1); // recovery ends, the next move begins
    expect(b.state).toBe("approach");
    const start = Math.hypot(g.x - b.x, g.y - b.y);
    step(g, 1.5);
    expect(Math.hypot(g.x - b.x, g.y - b.y)).toBeLessThan(start);
    // it goes off once it is close (or its dash times out), then the boss rests before anything else
    const sawBlast = (() => {
      for (let i = 0; i < 80; i++) {
        step(g, 0.05);
        if (priv(g).bursts.length) return true;
      }
      return false;
    })();
    expect(sawBlast).toBe(true);
  });

  it("lightning: warns on a tile near the player, then strikes it", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 10.5);
    priv(g).beginWindup(b, "lightning");
    const bolt = priv(g).bolts[0];
    expect(Math.abs(bolt.tx - Math.floor(g.x))).toBeLessThanOrEqual(3);
    expect(Math.abs(bolt.ty - Math.floor(g.y))).toBeLessThanOrEqual(3);
    expect(bolt.tx === Math.floor(g.x) && bolt.ty === Math.floor(g.y)).toBe(false);

    // stand still on the warned tile: it hurts
    g.x = bolt.tx + 0.5;
    g.y = bolt.ty + 0.5;
    const before = g.hp;
    priv(g).updateBossCasts(BOSS.lightning.windup - 0.1, 1);
    expect(g.hp).toBe(before); // still only a warning
    priv(g).updateBossCasts(0.2, 1);
    expect(before - g.hp).toBe(BOSS.lightning.dmg);
  });

  it("lightning: a player who moves off the warned tile is safe", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 10.5);
    priv(g).beginWindup(b, "lightning");
    const bolt = priv(g).bolts[0];
    g.x = bolt.tx + 0.5 + 4;
    g.y = bolt.ty + 0.5;
    const before = g.hp;
    priv(g).updateBossCasts(BOSS.lightning.windup + 0.1, 1);
    expect(g.hp).toBe(before);
    expect(priv(g).bolts[0].strike).toBeGreaterThan(0); // the bolt is still on screen
    priv(g).updateBossCasts(1, 1);
    expect(priv(g).bolts).toHaveLength(0);
  });

  it("hits harder on hard difficulty", () => {
    const g = makeGame("hard");
    const b = spawnBoss(g, 10.5, 10.5);
    g.x = 11.5;
    g.y = 10.5;
    const before = g.hp;
    b.move = "storm";
    priv(g).updateBoss(0.001); // (a real frame) computes the scale itself
    priv(g).fireBossMove(b, 1.35);
    expect(before - g.hp).toBeCloseTo(BOSS.storm.dmg * 1.35, 5);
  });
});

describe("Stormcaller combat cycle", () => {
  it("runs 2 different moves in a row, then pauses 3 to 7 seconds, over and over", () => {
    const g = makeGame();
    g.x = 30.5; // out of everything's way: the pattern is what is measured
    g.y = 5.5;
    const b = spawnBoss(g, 26.5, 5.5);
    b.state = "emerge";
    b.t = BOSS.emergeTime;
    const fired: string[] = [];
    const orig = priv(g).fireBossMove.bind(g);
    priv(g).fireBossMove = (boss: { move: string }, scale: number) => {
      fired.push(boss.move);
      orig(boss, scale);
    };
    const pauses: number[] = [];
    let prev = b.state;
    let firedAtPauseStart = 0;
    const pairsAtPause: number[] = [];
    for (let i = 0; i < 20 * 120; i++) {
      step(g, 0.05, 0.05);
      const cur = priv(g).boss.state;
      if (prev === "recover" && cur === "pause") {
        pauses.push(priv(g).boss.t);
        firedAtPauseStart = fired.length;
        pairsAtPause.push(firedAtPauseStart);
      }
      prev = cur;
      // keep the player unhurt and out of reach so nothing interrupts the cycle
      g.hp = 1e6;
    }
    expect(fired.length).toBeGreaterThanOrEqual(6);
    // pauses only ever come after a complete pair
    for (const n of pairsAtPause) expect(n % 2).toBe(0);
    for (let i = 0; i + 1 < fired.length; i += 2) expect(fired[i]).not.toBe(fired[i + 1]);
    expect(pauses.length).toBeGreaterThanOrEqual(2);
    for (const p of pauses) {
      // the pause was 3-7s when it began (a little has been counted off by the time we look)
      expect(p).toBeGreaterThan(2.9);
      expect(p).toBeLessThanOrEqual(7);
    }
  });

  it("only ever targets the one player and stays on the fight", () => {
    const g = makeGame();
    const b = spawnBoss(g, 10.5, 5.5);
    b.t = 0;
    step(g, 0.1);
    expect(priv(g).boss).not.toBeNull();
  });
});

describe("fighting the Stormcaller", () => {
  it("can be hurt with a sword, and flashes", () => {
    const g = makeGame();
    hold(g, "diamond_sword");
    const b = spawnBoss(g, 6.5, 5.5);
    priv(g).input.held["use"] = true;
    priv(g).useLogic(0.016);
    expect(b.hp).toBe(BOSS.hp - SWORD_DAMAGE.diamond);
    expect(b.hurt).toBeGreaterThan(0);
  });

  it("cannot be hurt while it is still rising out of the block", () => {
    const g = makeGame();
    hold(g, "diamond_sword");
    priv(g).summonBoss(6.5, 5.5);
    priv(g).input.held["use"] = true;
    priv(g).useLogic(0.016);
    expect(priv(g).boss.hp).toBe(BOSS.hp);
  });

  it("despawns on victory and drops Shiny Metal", () => {
    const g = makeGame();
    hold(g, "diamond_sword");
    const b = spawnBoss(g, 6.5, 5.5);
    b.hp = 10;
    priv(g).beams.push({ x: 6, y: 5, dx: 1, dy: 0, life: 1, hit: false });
    priv(g).input.held["use"] = true;
    priv(g).useLogic(0.016);
    expect(priv(g).boss).toBeNull();
    expect(priv(g).beams).toHaveLength(0);
    expect(g.countPublic(BOSS_LOOT.id)).toBe(BOSS_LOOT.n);
    expect(g.toast).toMatch(/defeated/i);
  });

  it("reports its health to the HUD only while it is alive", () => {
    const g = makeGame();
    let hud: { boss: { hp: number; max: number } | null; xp: number } | null = null;
    g.onHud = (h) => (hud = h as never);
    g.give("xp", 3);
    expect(hud!.boss).toBeNull();
    expect(hud!.xp).toBe(3);
    spawnBoss(g, 20.5, 5.5);
    priv(g).emit();
    expect(hud!.boss).toEqual({ hp: BOSS.hp, max: BOSS.hp });
  });
});

describe("resets", () => {
  it("fully resets and despawns when the player dies", () => {
    const g = makeGame();
    const b = spawnBoss(g, 20.5, 5.5);
    priv(g).beams.push({ x: 1, y: 1, dx: 1, dy: 0, life: 1, hit: false });
    priv(g).bolts.push({ tx: 1, ty: 1, warn: 1, strike: 0, seed: 1 });
    priv(g).bursts.push({ x: 1, y: 1, t: 1 });
    b.hp = 5;
    g.hp = -1;
    priv(g).update(0.016);
    expect(g.dead).toBe(true);
    expect(priv(g).boss).toBeNull();
    expect(priv(g).beams).toHaveLength(0);
    expect(priv(g).bolts).toHaveLength(0);
    expect(priv(g).bursts).toHaveLength(0);
  });

  it("does not come back after respawning until the next pulse", () => {
    const g = makeGame();
    placeGhost(g);
    step(g, GHOST_CYCLE + 0.1);
    expect(priv(g).boss).not.toBeNull();
    g.hp = -1;
    priv(g).update(0.016);
    g.respawn();
    expect(priv(g).boss).toBeNull();
    // the clock jumped to the next morning: no pile-up of missed summons
    g.x = 6.5;
    g.y = 8.5;
    priv(g).updateGhosts();
    expect(priv(g).boss).toBeNull();
  });

  it("despawns if the player leaves the surface", () => {
    const g = makeGame();
    spawnBoss(g, 20.5, 5.5);
    g.world.set(6, 5, { t: "dirt", obj: "cave_entrance" });
    g.dir = "right";
    priv(g).usePortal(6, 5);
    expect(priv(g).boss).toBeNull();
  });

  it("gives up if the player gets far away", () => {
    const g = makeGame();
    spawnBoss(g, 20.5, 5.5);
    g.x = 200;
    priv(g).updateBoss(0.016);
    expect(priv(g).boss).toBeNull();
  });

  it("does not let the player sleep through it", () => {
    const g = makeGame();
    g.time = 0.6 * 840;
    g.world.set(6, 5, { t: "grass", obj: "bed" });
    spawnBoss(g, 20.5, 5.5);
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.sleeping).toBe(0);
  });
});

describe("Shiny Metal and the Super Sword", () => {
  it("crafts from Shiny Metal", () => {
    const r = RECIPES.find((x) => x.id === "super_sword")!;
    expect(r.result).toBe("super_sword");
    expect(r.need.find((n) => n.id === "shiny_metal")!.n).toBe(5);
    const g = makeGame();
    g.give("shiny_metal", 5);
    g.give("stick", 1);
    g.craft("super_sword");
    expect(g.countPublic("super_sword")).toBe(1);
    expect(g.countPublic("shiny_metal")).toBe(0);
  });

  it("hits harder than a diamond sword and wears out like a wooden sword", () => {
    expect(SWORD_DAMAGE.super).toBeGreaterThan(SWORD_DAMAGE.diamond);
    const g = makeGame();
    g.give("super_sword", 1);
    const s = g.slots.find((x) => x?.id === "super_sword")!;
    const d = g.slots.find((x) => x?.id === "diamond_sword");
    expect(s.dur).toBe(TOOL_USES.wood);
    expect(d).toBeUndefined();
  });

  it("does 40 damage to the boss", () => {
    const g = makeGame();
    hold(g, "super_sword");
    const b = spawnBoss(g, 6.5, 5.5);
    priv(g).input.held["use"] = true;
    priv(g).useLogic(0.016);
    expect(b.hp).toBe(BOSS.hp - 40);
  });
});

describe("the whole loop", () => {
  it("zombies -> XP, + diamonds -> Ghost Block -> boss -> Shiny Metal -> Super Sword", () => {
    const g = makeGame();
    for (let i = 0; i < 10; i++) {
      const z = zombie();
      priv(g).mobs.push(z);
      priv(g).killMob(z);
    }
    g.give("diamond", 10);
    g.craft("ghost_block");
    expect(g.countPublic("ghost_block")).toBe(1);

    g.give("diamond_sword", 1);
    g.give("stick", 1);
    g.world.set(6, 5, { t: "grass" });
    g.setHotbar(g.slots.findIndex((s) => s?.id === "ghost_block"));
    priv(g).input.pressedUse = true;
    priv(g).useLogic(0.016);
    expect(g.world.get(6, 5).obj).toBe("ghost_block");

    step(g, GHOST_CYCLE + 0.2);
    const b = priv(g).boss;
    expect(b).not.toBeNull();
    b.state = "pause";
    b.t = 99;
    b.x = 6.5;
    b.y = 5.5;
    b.hp = SWORD_DAMAGE.diamond; // one good hit from the end
    g.setHotbar(g.slots.findIndex((s) => s?.id === "diamond_sword"));
    priv(g).input.held["use"] = true;
    priv(g).useLogic(0.016);
    expect(priv(g).boss).toBeNull();
    expect(g.countPublic("shiny_metal")).toBe(5);
    g.craft("super_sword");
    expect(g.countPublic("super_sword")).toBe(1);
    // the block was spent by its one summon
    expect(g.world.get(6, 5).obj).toBeUndefined();
  });
});

describe("Super Sword abilities", () => {
  function armed(power: "lightning" | "storm" | "laser") {
    const g = makeGame();
    g.give("super_sword", 1);
    const slot = g.slots.find((x) => x?.id === "super_sword")!;
    slot.power = power;
    g.hotbar = g.slots.indexOf(slot);
    g.x = 5.5;
    g.y = 5.5;
    g.dir = "right";
    return g;
  }
  function mob(g: Game, x: number, y: number, hp = 500) {
    const m = { kind: "insect", x, y, hp, hurt: 0, flee: 0, vx: 0, vy: 0 };
    priv(g).mobs.push(m);
    return m;
  }
  function swing(g: Game) {
    priv(g).input.held["use"] = true;
    priv(g).input.pressedUse = true;
    priv(g).hitCool = 0;
    priv(g).useLogic(0.016);
    priv(g).input.held["use"] = false;
  }

  it("rolls 90% lightning, 7% storm blast and 3% laser", () => {
    expect(rollSwordPower(() => 0)).toBe("lightning");
    expect(rollSwordPower(() => 0.899)).toBe("lightning");
    expect(rollSwordPower(() => 0.9)).toBe("storm");
    expect(rollSwordPower(() => 0.969)).toBe("storm");
    expect(rollSwordPower(() => 0.97)).toBe("laser");
    expect(rollSwordPower(() => 0.999)).toBe("laser");
  });

  it("every newly made Super Sword gets an ability", () => {
    const g = makeGame();
    g.give("super_sword", 1);
    expect(g.slots.find((x) => x?.id === "super_sword")!.power).toBeDefined();
  });

  it("lightning strikes the mob that was hit and its neighbours, not the player", () => {
    const g = armed("lightning");
    const a = mob(g, 6.5, 5.5);
    const b = mob(g, 7.0, 5.5);
    const far = mob(g, 12.5, 5.5);
    const hp = g.hp;
    swing(g);
    expect(a.hp).toBeLessThan(500 - SWORD_DAMAGE.super);
    expect(b.hp).toBeLessThan(500);
    expect(far.hp).toBe(500);
    expect(g.hp).toBe(hp);
    expect(priv(g).bolts.length).toBe(1);
  });

  it("storm blast hurts and pushes mobs around the player", () => {
    const g = armed("storm");
    const a = mob(g, 6.5, 5.5);
    const side = mob(g, 5.5, 7.0);
    swing(g);
    expect(side.hp).toBeLessThan(500);
    expect(side.vy).toBeGreaterThan(0); // flung away from the player
    expect(a.hp).toBeLessThan(500 - SWORD_DAMAGE.super);
  });

  it("laser pierces every mob in line and never hurts the player", () => {
    const g = armed("laser");
    const a = mob(g, 6.5, 5.5);
    const behind = mob(g, 11.5, 5.5);
    const off = mob(g, 11.5, 8.5);
    const hp = g.hp;
    swing(g);
    expect(behind.hp).toBeLessThan(500);
    expect(off.hp).toBe(500);
    expect(a.hp).toBeLessThan(500);
    for (let i = 0; i < 40; i++) priv(g).update(0.05);
    expect(g.hp).toBeGreaterThanOrEqual(hp);
    expect(priv(g).beams.length).toBe(0); // fades out with no boss around
  });

  it("an ability kill pays out like a normal kill", () => {
    const g = armed("lightning");
    mob(g, 6.5, 5.5, 1);
    swing(g);
    expect(priv(g).mobs.length).toBe(0);
  });

  it("an ability-less (old) Super Sword gets one when the world loads, and keeps one it has", () => {
    const g = makeGame();
    const s1 = priv(g).restoreSlot({ id: "super_sword", n: 1, dur: 100 }, 4);
    expect(["lightning", "storm", "laser"]).toContain(s1.power);
    expect(s1.dur).toBe(22); // full life stays full under the new, shorter life
    const s2 = priv(g).restoreSlot({ id: "super_sword", n: 1, dur: 50, power: "laser" });
    expect(s2.power).toBe("laser");
    expect(s2.dur).toBeLessThanOrEqual(22);
  });

  it("the ability survives being picked up and put back", () => {
    const g = armed("storm");
    const i = g.hotbar;
    g.clickSlot(i); // pick up
    g.toggleInventory();
    g.toggleInventory(); // closing gives the held item back
    g.clickSlot(i);
    g.clickSlot(i);
    expect(g.slots.find((x) => x?.id === "super_sword")!.power).toBe("storm");
  });
});

describe("Super Sword effects without a boss", () => {
  it("draws the lightning, beam and shockwave even when no Stormcaller exists", () => {
    const g = makeGame();
    expect(priv(g).boss).toBeNull();
    priv(g).bolts.push({ tx: 6, ty: 5, warn: 0, strike: 0.4, seed: 1 });
    priv(g).beams.push({ x: 5.5, y: 5.5, dx: 1, dy: 0, len: 8, life: 0.3, hit: true });
    priv(g).bursts.push({ x: 5.5, y: 5.5, t: 0.3 });
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) =>
          typeof prop === "string" && prop !== "then"
            ? (..._a: unknown[]) => (calls.push(prop), prop.startsWith("create") ? { addColorStop: () => {} } : undefined)
            : undefined,
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    priv(g).drawCastEffects(ctx, 32, 0, 0);
    expect(calls.length).toBeGreaterThan(0);
  });
});
