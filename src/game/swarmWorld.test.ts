import { describe, expect, it } from "vitest";
import { Game } from "./engine";
import { BOSS, SWARMLING } from "./boss";

function makeCanvas(ctx: unknown = {}) {
  return { getContext: () => ctx, width: 640, height: 480, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) } as unknown as HTMLCanvasElement;
}
function makeGame(difficulty: "easy" | "hard" = "easy", ctx?: unknown) {
  const g = new Game(makeCanvas(ctx), { saveId: "t", seed: 1234, difficulty, save: null });
  g.x = 5.5;
  g.y = 5.5;
  g.hp = 1e6;
  g.time = 100; // broad daylight
  return g;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (g: Game) => g as any;

/** a flat, empty stretch of grass so terrain never gets in a test's way */
function flat(g: Game, x0 = 0, y0 = 0, x1 = 40, y1 = 25) {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) g.world.set(x, y, { t: "grass" });
}
function spawnBoss(g: Game, x: number, y: number) {
  priv(g).summonBoss(x, y);
  const b = priv(g).boss;
  b.state = "pause";
  b.t = 99;
  return b;
}
const mob = (kind: string, x: number, y: number, hp?: number) => ({
  kind,
  x,
  y,
  hp: hp ?? 40,
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
const fireLaser = (g: Game, b: { move: string }) => {
  b.move = "laser";
  priv(g).fireBossMove(b, 1);
};
const minions = (g: Game) => priv(g).mobs.filter((m: { minion?: boolean }) => m.minion);

describe("Swarm Spawner", () => {
  it("spawns a ring of small night mobs around the boss, even at midday", () => {
    const g = makeGame();
    flat(g);
    const b = spawnBoss(g, 20.5, 10.5);
    expect(priv(g).isNight()).toBe(false);
    b.move = "swarm";
    priv(g).fireBossMove(b, 1);
    const m = minions(g);
    expect(m).toHaveLength(BOSS.swarm.count);
    for (const x of m) {
      expect(x.kind).toBe("swarmling");
      expect(x.hp).toBe(SWARMLING.hp);
      expect(Math.hypot(x.x - b.x, x.y - b.y)).toBeLessThan(BOSS.swarm.ring * 2);
    }
  });

  it("sends more on hard difficulty", () => {
    const g = makeGame("hard");
    flat(g);
    const b = spawnBoss(g, 20.5, 10.5);
    b.move = "swarm";
    priv(g).fireBossMove(b, 1);
    expect(minions(g)).toHaveLength(BOSS.swarm.hardCount);
  });

  it("is a real move: winds up, then spawns", () => {
    const g = makeGame();
    flat(g);
    const b = spawnBoss(g, 12.5, 10.5);
    priv(g).beginWindup(b, "swarm");
    expect(b.state).toBe("windup");
    expect(b.t).toBe(BOSS.swarm.windup);
    expect(minions(g)).toHaveLength(0);
    for (let t = 0; t < BOSS.swarm.windup + 0.2; t += 0.05) {
      g.time += 0.05;
      priv(g).updateBoss(0.05);
    }
    expect(minions(g).length).toBeGreaterThan(0);
  });

  it("never lets more than the cap be alive at once", () => {
    const g = makeGame();
    flat(g);
    const b = spawnBoss(g, 20.5, 10.5);
    for (let i = 0; i < 6; i++) {
      b.move = "swarm"; // firing clears the move, so set it for each shot
      priv(g).fireBossMove(b, 1);
    }
    expect(minions(g).length).toBeLessThanOrEqual(BOSS.swarm.maxAlive);
    expect(minions(g).length).toBeGreaterThan(BOSS.swarm.count);
  });

  it("survives daylight, which wipes ordinary night mobs", () => {
    const g = makeGame();
    flat(g);
    g.x = 5.5;
    g.y = 10.5;
    const b = spawnBoss(g, 25.5, 10.5);
    b.move = "swarm";
    priv(g).fireBossMove(b, 1);
    priv(g).mobs.push(mob("corrupted", 30.5, 10.5)); // an ordinary night mob, far away, in daylight
    priv(g).updateMobs(0.05);
    expect(minions(g)).toHaveLength(BOSS.swarm.count);
    expect(priv(g).mobs.some((m: { kind: string }) => m.kind === "corrupted")).toBe(false);
  });

  it("hunts the player down and kills them unless they fight back", () => {
    const g = makeGame();
    flat(g);
    g.x = 10.5;
    g.y = 10.5;
    g.hp = 100;
    for (let i = 0; i < 5; i++) priv(g).mobs.push({ ...mob("swarmling", 16.5 + i * 0.2, 10.5, SWARMLING.hp), minion: true });
    for (let i = 0; i < 400 && g.hp > 0; i++) {
      priv(g).updateMobs(0.05);
      g.hp = Math.min(g.hp, 100); // no regeneration: only the swarm moves the number
    }
    expect(g.hp).toBeLessThanOrEqual(0);
  });

  it("is beaten by a sword, and its kills drop nothing", () => {
    const g = makeGame();
    flat(g);
    g.x = 10.5;
    g.y = 10.5;
    g.dir = "right";
    g.give("wood_sword", 1);
    g.setHotbar(g.slots.findIndex((s) => s?.id === "wood_sword"));
    const before = JSON.stringify(g.slots);
    const m = { ...mob("swarmling", 11.5, 10.5, SWARMLING.hp), minion: true };
    priv(g).mobs.push(m);
    priv(g).input.held["use"] = true;
    let swings = 0;
    for (let i = 0; i < 80 && priv(g).mobs.includes(m); i++) {
      const hp = m.hp;
      priv(g).hitCool = 0;
      priv(g).useLogic(0.1);
      if (m.hp < hp) swings++;
      m.x = 11.5; // it stays put, in front of the player
      m.y = 10.5;
      m.flee = 0;
    }
    expect(priv(g).mobs.includes(m)).toBe(false);
    expect(swings).toBeLessThanOrEqual(2); // wood sword: 8 damage vs 14 hp
    expect(JSON.stringify(g.slots).replace(/"dur":\d+/g, "")).toBe(before.replace(/"dur":\d+/g, "")); // nothing gained
  });

  it("does not use up the night-mob spawn cap", () => {
    const g = makeGame();
    flat(g);
    g.time = 0.6 * 840; // night
    for (let i = 0; i < 12; i++) priv(g).mobs.push({ ...mob("swarmling", 5 + i, 3, 14), minion: true });
    let natural = 0;
    for (let i = 0; i < 60; i++) {
      priv(g).trySpawn();
      natural = priv(g).mobs.filter((m: { minion?: boolean; kind: string }) => !m.minion && m.kind !== "insect").length;
      if (natural) break;
    }
    expect(natural).toBeGreaterThan(0);
  });

  it("vanishes with the boss: on victory, on reset, and when the player dies", () => {
    for (const how of ["kill", "clear", "die"] as const) {
      const g = makeGame();
      flat(g);
      const b = spawnBoss(g, 20.5, 10.5);
      b.move = "swarm";
      priv(g).fireBossMove(b, 1);
      priv(g).mobs.push(mob("corrupted", 8.5, 5.5)); // ordinary mobs are left alone
      expect(minions(g).length).toBeGreaterThan(0);
      if (how === "kill") priv(g).killBoss();
      else if (how === "clear") priv(g).clearBoss();
      else {
        g.hp = -1;
        priv(g).update(0.016);
      }
      expect(minions(g), how).toHaveLength(0);
      if (how !== "die") expect(priv(g).mobs.some((m: { kind: string }) => m.kind === "corrupted")).toBe(true);
    }
  });
});

describe("the boss harms the world: laser", () => {
  it("smashes player-built blocks and trees in its path", () => {
    const g = makeGame();
    flat(g);
    g.x = 18.5;
    g.y = 10.5;
    const b = spawnBoss(g, 10.5, 10.5);
    g.world.set(12, 10, { t: "grass", obj: "block_stone" });
    g.world.set(14, 10, { t: "grass", obj: "tree" });
    fireLaser(g, b);
    expect(g.world.get(12, 10).obj).toBeUndefined();
    expect(g.world.get(14, 10).obj).toBeUndefined();
  });

  it("is spent after two obstacles, so a wall of blocks is real cover (once)", () => {
    const g = makeGame();
    flat(g);
    g.x = 18.5;
    g.y = 10.5;
    const b = spawnBoss(g, 10.5, 10.5);
    g.world.set(12, 10, { t: "grass", obj: "block_stone" });
    g.world.set(13, 10, { t: "grass", obj: "block_stone" });
    g.world.set(15, 10, { t: "grass", obj: "block_stone" }); // a third, behind the first two
    const before = g.hp;
    fireLaser(g, b);
    priv(g).updateBossCasts(0.016, 1);
    expect(g.hp).toBe(before); // the player behind the wall is untouched
    expect(priv(g).beams[0].len).toBeLessThan(5);
    expect(g.world.get(15, 10).obj).toBe("block_stone"); // it never got that far
    // with nothing in the way the same shot hurts
    const h = makeGame();
    flat(h);
    h.x = 18.5;
    h.y = 10.5;
    const hb = spawnBoss(h, 10.5, 10.5);
    const hb4 = h.hp;
    fireLaser(h, hb);
    priv(h).updateBossCasts(0.016, 1);
    expect(hb4 - h.hp).toBe(BOSS.laser.dmg);
  });

  it("is stopped dead by a mountain, which it cannot break", () => {
    const g = makeGame();
    flat(g);
    g.x = 18.5;
    g.y = 10.5;
    const b = spawnBoss(g, 10.5, 10.5);
    g.world.set(13, 10, { t: "grass", obj: "mountain" });
    const before = g.hp;
    fireLaser(g, b);
    priv(g).updateBossCasts(0.016, 1);
    expect(g.world.get(13, 10).obj).toBe("mountain");
    expect(g.hp).toBe(before);
  });

  it("burns torches off the blocks they stand on", () => {
    const g = makeGame();
    flat(g);
    g.x = 18.5;
    g.y = 10.5;
    const b = spawnBoss(g, 10.5, 10.5);
    g.world.set(13, 10, { t: "grass", torch: true });
    expect(g.world.torches.has("13,10")).toBe(true);
    fireLaser(g, b);
    expect(g.world.get(13, 10).torch).toBeFalsy();
    expect(g.world.torches.has("13,10")).toBe(false);
  });

  it("hurts other mobs in its line, but not ones beside it or the boss's own swarm", () => {
    const g = makeGame();
    flat(g);
    g.x = 18.5;
    g.y = 10.5;
    const b = spawnBoss(g, 10.5, 10.5);
    const inLine = mob("zombie", 13.5, 10.5, 40);
    const beside = mob("zombie", 13.5, 13.5, 40);
    const swarm = { ...mob("swarmling", 14.5, 10.5, 14), minion: true };
    priv(g).mobs.push(inLine, beside, swarm);
    fireLaser(g, b);
    expect(inLine.hp).toBe(40 - BOSS.mobDmg.laser);
    expect(inLine.hurt).toBeGreaterThan(0);
    expect(beside.hp).toBe(40);
    expect(swarm.hp).toBe(14);
  });

  it("kills weak mobs outright, with no drops for the player", () => {
    const g = makeGame();
    flat(g);
    g.x = 18.5;
    g.y = 10.5;
    const b = spawnBoss(g, 10.5, 10.5);
    priv(g).mobs.push(mob("zombie", 13.5, 10.5, 5), mob("phantom", 15.5, 10.5, 5));
    fireLaser(g, b);
    expect(priv(g).mobs).toHaveLength(0);
    expect(g.countPublic("xp")).toBe(0);
    expect(g.countPublic("stick")).toBe(0);
  });
});

describe("the boss harms the world: storm blast", () => {
  it("flattens everything inside its circle and nothing outside it", () => {
    const g = makeGame();
    flat(g);
    g.x = 30.5;
    g.y = 10.5;
    const b = spawnBoss(g, 10.5, 10.5);
    const inside: [number, number, "tree" | "block_wood" | "crop2" | "door_closed"][] = [
      [11, 10, "tree"],
      [10, 12, "block_wood"],
      [9, 9, "crop2"],
      [12, 10, "door_closed"],
    ];
    for (const [x, y, o] of inside) g.world.set(x, y, { t: "grass", obj: o });
    g.world.set(11, 11, { t: "grass", torch: true });
    g.world.set(15, 10, { t: "grass", obj: "tree" }); // 4.5 tiles out: safe
    g.world.set(10, 14, { t: "grass", obj: "block_stone" }); // 4 tiles out: safe
    b.move = "storm";
    priv(g).fireBossMove(b, 1);
    for (const [x, y] of inside) expect(g.world.get(x, y).obj, `${x},${y}`).toBeUndefined();
    expect(g.world.get(11, 11).torch).toBeFalsy();
    expect(g.world.get(15, 10).obj).toBe("tree");
    expect(g.world.get(10, 14).obj).toBe("block_stone");
  });

  it("leaves the cave entrance and the land alone", () => {
    const g = makeGame();
    flat(g);
    g.x = 30.5;
    g.y = 10.5;
    const b = spawnBoss(g, 10.5, 10.5);
    g.world.set(11, 10, { t: "dirt", obj: "cave_entrance" });
    g.world.set(9, 10, { t: "grass", obj: "mountain" });
    g.world.set(10, 11, { t: "stone" });
    b.move = "storm";
    priv(g).fireBossMove(b, 1);
    expect(g.world.get(11, 10).obj).toBe("cave_entrance");
    expect(g.world.get(9, 10).obj).toBe("mountain");
    expect(g.world.get(10, 11).t).toBe("stone");
  });

  it("damages and flings other mobs, sparing its swarm and mobs out of reach", () => {
    const g = makeGame();
    flat(g);
    g.x = 30.5;
    g.y = 10.5;
    const b = spawnBoss(g, 10.5, 10.5);
    const near = mob("corrupted", 12.5, 10.5, 48);
    const far = mob("corrupted", 18.5, 10.5, 48);
    const swarm = { ...mob("swarmling", 11.5, 10.5, 14), minion: true };
    priv(g).mobs.push(near, far, swarm);
    b.move = "storm";
    priv(g).fireBossMove(b, 1);
    expect(near.hp).toBe(48 - BOSS.mobDmg.storm);
    expect(near.vx).toBeGreaterThan(3); // thrown away from the boss
    expect(far.hp).toBe(48);
    expect(swarm.hp).toBe(14);
  });
});

describe("the boss harms the world: lightning", () => {
  const strike = (g: Game) => {
    priv(g).bolts.push({ tx: 12, ty: 10, warn: 0.01, strike: 0, seed: 1 });
    priv(g).updateBossCasts(0.05, 1);
  };

  it("destroys what is on the struck tile and the ones touching it", () => {
    const g = makeGame();
    flat(g);
    g.x = 30.5;
    spawnBoss(g, 20.5, 10.5);
    const spot: [number, number][] = [[12, 10], [11, 10], [13, 10], [12, 9], [12, 11]];
    for (const [x, y] of spot) g.world.set(x, y, { t: "grass", obj: "tree" });
    g.world.set(13, 11, { t: "grass", obj: "tree" }); // diagonal: out of range
    strike(g);
    for (const [x, y] of spot) expect(g.world.get(x, y).obj).toBeUndefined();
    expect(g.world.get(13, 11).obj).toBe("tree");
  });

  it("hurts mobs standing there", () => {
    const g = makeGame();
    flat(g);
    g.x = 30.5;
    spawnBoss(g, 20.5, 10.5);
    const victim = mob("corrupted", 12.5, 10.5, 48);
    const bystander = mob("corrupted", 17.5, 10.5, 48);
    priv(g).mobs.push(victim, bystander);
    strike(g);
    expect(victim.hp).toBe(48 - BOSS.mobDmg.lightning);
    expect(bystander.hp).toBe(48);
  });
});

describe("the Stormcaller's darkness", () => {
  /** a canvas context that does nothing, so the real render code can run end to end */
  const nop: unknown = new Proxy(function () {}, { get: () => nop, apply: () => nop, set: () => true });

  it("blacks the world out to the player's circle for as long as the boss lives, wherever it is", () => {
    const g = makeGame("easy", nop);
    flat(g);
    const calls: unknown[][] = [];
    priv(g).drawDarkness = (...a: unknown[]) => calls.push(a);
    priv(g).render();
    expect(calls).toHaveLength(0); // no boss, bright day: ordinary vision
    const b = spawnBoss(g, 5.5 + 20, 5.5);
    b.x = 5.5 + 45; // far across the map: no range matters
    priv(g).render();
    expect(calls).toHaveLength(1);
    expect(calls[0]![9]).toBe(true); // the fog flag
    priv(g).clearBoss();
    calls.length = 0;
    priv(g).render();
    expect(calls).toHaveLength(0);
  });

  it("is pure black outside a circle around the player, with no torch light getting through", () => {
    const events: string[] = [];
    const grads: number[][] = [];
    const rec: unknown = new Proxy(
      {},
      {
        get: (_t, p) => {
          if (p === "createRadialGradient") return (...a: number[]) => (grads.push(a), { addColorStop: (o: number, c: string) => events.push(`stop ${o} ${c}`) });
          if (p === "fillRect" || p === "clearRect") return () => {};
          return () => {};
        },
        set: (_t, p, v) => {
          if (p === "globalCompositeOperation") events.push("composite " + v);
          return true;
        },
      },
    );
    (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => rec }) };
    try {
      const g = makeGame("easy", nop);
      flat(g);
      g.world.set(8, 5, { t: "grass", torch: true }); // a torch right beside the player
      const W = 640;
      const H = 480;
      const S = 40;

      // with the boss: the only gradient is the player's circle, black beyond it, and no torch holes are cut
      spawnBoss(g, 30.5, 5.5);
      priv(g).drawDarkness(nop, W, H, S, 0, 0, 0, false, 3.4, true);
      expect(grads).toHaveLength(1);
      const [cx, cy, r0, cx2, cy2, r1] = grads[0] as [number, number, number, number, number, number];
      expect([cx, cy, cx2, cy2]).toEqual([W / 2, H / 2, W / 2, H / 2]); // centred on the player
      expect(r1).toBeCloseTo(S * BOSS.visionRadius, 5);
      expect(r0).toBeLessThan(r1);
      expect(events).toContain("stop 0 rgba(0,0,0,0)"); // clear in the middle
      expect(events).toContain("stop 1 rgba(0,0,0,1)"); // fully opaque black at the edge and beyond
      // (one gradient only: a torch would have added a second, to cut its light out of the dark)

      // without the boss, at night, that same torch does light up the dark (so the difference is real)
      events.length = 0;
      grads.length = 0;
      priv(g).drawDarkness(nop, W, H, S, 0, 0, 0.6, false, 3.4, false);
      // the torch's own light gradient is there, centred on the torch (not on the player)
      expect(grads).toHaveLength(1);
      expect(grads[0]![0]).toBeCloseTo(8.5 * S, 5);
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });
});
