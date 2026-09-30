// Sound effects, synthesised with the Web Audio API: no audio files to ship or license.
// Everything here is safe to call anywhere: with no audio support (tests, old browsers) it does nothing.

type AC = typeof AudioContext;

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
let reverbBuf: AudioBuffer | null = null;

/** how long the boss-spawn sting lasts, in seconds */
export const BOSS_SPAWN_SOUND_SECONDS = 4.6;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AC | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** browsers only let audio start after a tap or key press: call this from one, so the sting can play later */
export function unlockAudio() {
  getCtx();
}

/** a few seconds of brown (low, rumbly) noise, made once and reused */
function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(c.sampleRate * 5);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return (noiseBuf = buf);
}

/** a made-up cave: two seconds and a bit of decaying noise, so everything sounds like it is in a huge empty space */
function reverb(c: AudioContext): AudioBuffer {
  if (reverbBuf) return reverbBuf;
  const len = Math.floor(c.sampleRate * 2.6);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return (reverbBuf = buf);
}

/**
 * The sound of the Stormcaller waking up: a low swell that shakes the speakers, a clashing
 * tritone drone, a screech that falls away into the dark, a slow heartbeat and a rumble, all in
 * an echoing space. Returns false if the browser can't play sound.
 */
export function playBossSpawn(volume = 1): boolean {
  const c = getCtx();
  if (!c) return false;
  try {
    const t0 = c.currentTime + 0.03;
    const end = t0 + BOSS_SPAWN_SOUND_SECONDS;

    // master bus: compressor keeps the loud parts from clipping; a reverb send adds the cavern
    const comp = c.createDynamicsCompressor();
    const master = c.createGain();
    master.gain.value = 0.55 * Math.max(0, Math.min(1, volume));
    comp.connect(master).connect(c.destination);
    const verb = c.createConvolver();
    verb.buffer = reverb(c);
    const wet = c.createGain();
    wet.gain.value = 0.45;
    verb.connect(wet).connect(comp);
    const bus = c.createGain(); // everything below goes through here: dry to the compressor, plus the send
    bus.connect(comp);
    bus.connect(verb);

    const start = (n: AudioScheduledSourceNode, at: number, until: number) => {
      n.start(at);
      n.stop(until);
    };
    /** a gain that fades in to `peak`, holds, and fades out: `[fadeInEnd, fadeOutStart, stop]` are seconds after t0 */
    const env = (peak: number, a: number, b: number, z: number) => {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + a);
      g.gain.setValueAtTime(peak, t0 + b);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + z);
      return g;
    };

    // 1. sub-bass swell: felt more than heard
    const sub = c.createOscillator();
    sub.type = "triangle"; // its harmonics make the swell audible on small speakers too
    sub.frequency.setValueAtTime(58, t0);
    sub.frequency.exponentialRampToValueAtTime(34, t0 + 4.2);
    sub.connect(env(0.75, 0.5, 2.2, 4.5)).connect(bus);
    start(sub, t0, end);

    // 2. the clashing drone: F, F# (a semitone: it beats and grinds) and B (a tritone: the "devil's interval"),
    //    through a low-pass that opens up like a mouth and closes again, with a shaky tremolo
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(160, t0);
    lp.frequency.exponentialRampToValueAtTime(1100, t0 + 1.4);
    lp.frequency.exponentialRampToValueAtTime(220, t0 + 4.2);
    const trem = c.createGain();
    trem.gain.value = 0.7;
    const lfo = c.createOscillator();
    lfo.frequency.value = 6.5;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.3;
    lfo.connect(lfoDepth).connect(trem.gain);
    start(lfo, t0, end);
    lp.connect(trem).connect(env(0.5, 0.8, 2.9, 4.5)).connect(bus);
    for (const f of [87.31, 92.5, 123.47]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;
      o.connect(lp);
      start(o, t0, end);
    }

    // 3. the stab: a sudden dissonant chord the moment it appears
    const stabLp = c.createBiquadFilter();
    stabLp.type = "lowpass";
    stabLp.frequency.setValueAtTime(2600, t0);
    stabLp.frequency.exponentialRampToValueAtTime(300, t0 + 1.8);
    const stab = c.createGain();
    stab.gain.setValueAtTime(0.0001, t0);
    stab.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    stab.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.0);
    stabLp.connect(stab).connect(bus);
    for (const f of [174.61, 185.0, 246.94, 261.63]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(stabLp);
      start(o, t0, t0 + 2.1);
    }

    // 4. the screech: a high wail that slides down into the dark, with a nervous vibrato
    const scr = c.createOscillator();
    scr.type = "sawtooth";
    scr.frequency.setValueAtTime(1650, t0 + 0.12);
    scr.frequency.exponentialRampToValueAtTime(340, t0 + 1.7);
    const vib = c.createOscillator();
    vib.frequency.value = 9;
    const vibDepth = c.createGain();
    vibDepth.gain.value = 45;
    vib.connect(vibDepth).connect(scr.frequency);
    start(vib, t0, t0 + 2.0);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1300;
    bp.Q.value = 2.5;
    const scrEnv = c.createGain();
    scrEnv.gain.setValueAtTime(0.0001, t0 + 0.12);
    scrEnv.gain.exponentialRampToValueAtTime(0.3, t0 + 0.35);
    scrEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
    scr.connect(bp).connect(scrEnv).connect(bus);
    start(scr, t0 + 0.12, t0 + 2.0);

    // 5. rumble: rolling low noise that swells, like something huge shifting underground
    const rum = c.createBufferSource();
    rum.buffer = noise(c);
    rum.loop = true;
    const rumLp = c.createBiquadFilter();
    rumLp.type = "lowpass";
    rumLp.frequency.setValueAtTime(260, t0);
    rumLp.frequency.exponentialRampToValueAtTime(90, t0 + 4);
    rum.connect(rumLp).connect(env(0.9, 1.0, 2.8, 4.5)).connect(bus);
    start(rum, t0, end);

    // 6. heartbeat: two lub-dubs
    for (const [at, level] of [[1.0, 1], [1.28, 0.7], [2.15, 1], [2.43, 0.7]] as const) {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(70, t0 + at);
      o.frequency.exponentialRampToValueAtTime(36, t0 + at + 0.2);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(level, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.24);
      o.connect(g).connect(bus);
      start(o, t0 + at, t0 + at + 0.3);
    }

    // tidy up once the longest layer (the sub-bass, which runs to `end`) has finished
    sub.onended = () => master.disconnect();
    return true;
  } catch {
    return false; // sound is a bonus, never a reason to crash the game
  }
}
