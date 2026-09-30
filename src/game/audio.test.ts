import { afterEach, describe, expect, it, vi } from "vitest";

/** a stand-in for the browser's audio: records what gets scheduled, plays nothing */
function installFakeAudio(state: "running" | "suspended" = "running") {
  const log = { osc: [] as { start: number; stop: number; type: string }[], sources: 0, resumed: 0, contexts: 0, disconnected: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = (): Record<string, unknown> => {
    const n: Record<string, unknown> = {
      gain: param(),
      frequency: param(),
      detune: param(),
      Q: param(),
      connect: (to: unknown) => to ?? n,
      disconnect: () => log.disconnected++,
    };
    return n;
  };
  class FakeCtx {
    state = state;
    currentTime = 10;
    sampleRate = 8000;
    destination = node();
    constructor() {
      log.contexts++;
    }
    resume() {
      log.resumed++;
      return Promise.resolve();
    }
    createDynamicsCompressor = node;
    createGain = node;
    createConvolver = () => ({ ...node(), buffer: null });
    createBiquadFilter = () => ({ ...node(), type: "" });
    createBuffer = (_ch: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
    createBufferSource = () => {
      log.sources++;
      return { ...node(), buffer: null, loop: false, start: vi.fn(), stop: vi.fn(), onended: null };
    };
    createOscillator = () => {
      const o = { ...node(), type: "sine", onended: null as (() => void) | null, start: (t: number) => (rec.start = t), stop: (t: number) => (rec.stop = t) };
      const rec = { start: 0, stop: 0, type: "sine" }; // browsers default an oscillator to a sine wave
      log.osc.push(rec);
      Object.defineProperty(o, "type", { get: () => rec.type, set: (v: string) => (rec.type = v) });
      return o;
    };
  }
  (globalThis as { window?: unknown }).window = { AudioContext: FakeCtx };
  return log;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.resetModules();
});

describe("boss spawn sound", () => {
  it("does nothing, without crashing, when there is no audio support", async () => {
    const { playBossSpawn, unlockAudio } = await import("./audio");
    expect(playBossSpawn()).toBe(false);
    expect(() => unlockAudio()).not.toThrow();
  });

  it("does nothing when the browser has no AudioContext", async () => {
    (globalThis as { window?: unknown }).window = {};
    const { playBossSpawn } = await import("./audio");
    expect(playBossSpawn()).toBe(false);
  });

  it("schedules a layered sting that finishes within its stated length", async () => {
    const log = installFakeAudio();
    const { playBossSpawn, BOSS_SPAWN_SOUND_SECONDS } = await import("./audio");
    expect(playBossSpawn()).toBe(true);
    // sub-bass, 3 drone voices + tremolo LFO, 4 stab voices, screech + vibrato, 4 heartbeats
    expect(log.osc.length).toBeGreaterThanOrEqual(12);
    expect(log.sources).toBe(1); // the rumble
    for (const o of log.osc) {
      expect(o.stop).toBeGreaterThan(o.start);
      expect(o.start).toBeGreaterThanOrEqual(10); // never in the past
      expect(o.stop).toBeLessThanOrEqual(10 + 0.03 + BOSS_SPAWN_SOUND_SECONDS + 1e-6);
    }
    expect(BOSS_SPAWN_SOUND_SECONDS).toBeGreaterThan(3);
    // uses a saw stab and a triangle sub, i.e. it really is layered timbres
    expect(new Set(log.osc.map((o) => o.type))).toEqual(new Set(["triangle", "sine", "sawtooth"]));
  });

  it("wakes up a suspended audio context (browsers start it paused)", async () => {
    const log = installFakeAudio("suspended");
    const { playBossSpawn } = await import("./audio");
    playBossSpawn();
    expect(log.resumed).toBeGreaterThan(0);
  });

  it("reuses one audio context however many times it plays", async () => {
    const log = installFakeAudio();
    const { playBossSpawn, unlockAudio } = await import("./audio");
    unlockAudio();
    playBossSpawn();
    playBossSpawn();
    expect(log.contexts).toBe(1);
  });

  it("never throws even if the browser audio breaks halfway", async () => {
    installFakeAudio();
    (globalThis as { window: { AudioContext: unknown } }).window.AudioContext = class {
      state = "running";
      createDynamicsCompressor() {
        throw new Error("audio device lost");
      }
    };
    const { playBossSpawn } = await import("./audio");
    expect(playBossSpawn()).toBe(false);
  });
});
