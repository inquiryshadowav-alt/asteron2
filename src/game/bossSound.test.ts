import { beforeEach, describe, expect, it, vi } from "vitest";

const play = vi.fn(() => true);
vi.mock("./audio", () => ({ playBossSpawn: () => play(), unlockAudio: () => {}, BOSS_SPAWN_SOUND_SECONDS: 4.6 }));

import { Game } from "./engine";
import { GHOST_CYCLE } from "./boss";

function makeGame() {
  const canvas = { getContext: () => ({}), width: 640, height: 480, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) };
  const g = new Game(canvas as unknown as HTMLCanvasElement, { saveId: "t", seed: 1234, difficulty: "easy", save: null });
  g.x = 5.5;
  g.y = 5.5;
  g.hp = 1e6;
  return g;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (g: Game) => g as any;

beforeEach(() => play.mockClear());

describe("horror sound when the boss spawns", () => {
  it("plays once when a Ghost Block summons the Stormcaller", () => {
    const g = makeGame();
    g.world.set(6, 5, { t: "grass", obj: "ghost_block", pt: g.time });
    for (let t = 0; t < GHOST_CYCLE - 1; t += 0.5) {
      g.time += 0.5;
      priv(g).updateGhosts();
    }
    expect(play).not.toHaveBeenCalled(); // silent while the block is only pulsing
    g.time += 2;
    priv(g).updateGhosts();
    expect(priv(g).boss).not.toBeNull();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("does not play again while the boss is alive", () => {
    const g = makeGame();
    priv(g).summonBoss(6.5, 5.5);
    priv(g).summonBoss(7.5, 5.5); // refused: a boss is already out
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the summon is refused (player too far away)", () => {
    const g = makeGame();
    g.x = 500;
    priv(g).summonBoss(6.5, 5.5);
    expect(priv(g).boss).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("plays again for the next boss after the first is gone", () => {
    const g = makeGame();
    priv(g).summonBoss(6.5, 5.5);
    priv(g).clearBoss();
    priv(g).summonBoss(6.5, 5.5);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
