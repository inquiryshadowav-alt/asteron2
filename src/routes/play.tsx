import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Game, type Hud, type Slot } from "@/game/engine";
import { ITEMS, RECIPES, SWORD_POWER_NAMES, durabilityColor, maxDurability, usesLeft, type RecipeCategory } from "@/game/data";
import { listWorlds, loadSave } from "@/game/world";
import { SPRITE_URLS } from "@/game/sprite-assets";

export const Route = createFileRoute("/play")({
  validateSearch: (s: Record<string, unknown>) => ({ id: String(s["id"] ?? "") }),
  head: () => ({
    meta: [
      { title: "Playing — Blockcraft 2D" },
      { name: "description", content: "Your Blockcraft 2D survival world: mine, craft and survive." },
      { property: "og:title", content: "Playing — Blockcraft 2D" },
      { property: "og:description", content: "Your Blockcraft 2D survival world." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Play,
});

const CATS: RecipeCategory[] = ["Tools", "Materials", "Food", "Comfort"];

/** true when the browser's main pointer is a finger (touch/pen), not a mouse or trackpad */
function usePointerIsCoarse() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}

/** the viewport is small enough that keyboard play is impractical (a phone, or a small tablet) */
function useSmallScreen() {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setSmall(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return small;
}

function Play() {
  const { id } = Route.useSearch();
  const nav = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [cat, setCat] = useState<RecipeCategory>("Tools");
  const [err, setErr] = useState("");
  // the on-screen pad is always available — some desktop visitors have no physical keyboard — but
  // it only runs full-size where a finger is the main input AND the screen is small; everyone else
  // (mouse, trackpad, a big screen) gets a smaller, out-of-the-way version instead
  // both hooks must always run, every render — short-circuiting with && would skip the second
  // hook whenever the first is false, changing how many hooks this component calls between
  // renders (React requires the exact same hooks, in the same order, on every render)
  const coarsePointer = usePointerIsCoarse();
  const smallScreen = useSmallScreen();
  const touchControls = coarsePointer && smallScreen;
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const meta = listWorlds().find((w) => w.id === id);
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!meta) {
      setErr("World not found");
      return;
    }
    const save = loadSave(id);
    let g: Game;
    try {
      g = new Game(canvas, {
        saveId: id,
        seed: save?.seed ?? meta.seed,
        difficulty: meta.difficulty,
        save,
      });
    } catch {
      setErr("This browser cannot draw the game canvas.");
      return;
    }
    gameRef.current = g;
    g.onHud = setHud;
    const fit = () => {
      const w = canvas.parentElement?.clientWidth ?? 640;
      const h = canvas.parentElement?.clientHeight ?? 480;
      g.resize(Math.floor(w), Math.floor(h));
    };
    fit();
    window.addEventListener("resize", fit);
    g.start();
    // a quick reminder of the controls, every time a world is opened
    setShowHint(true);
    const hintTimer = window.setTimeout(() => setShowHint(false), 2800);
    return () => {
      window.removeEventListener("resize", fit);
      window.clearTimeout(hintTimer);
      g.stop();
      gameRef.current = null;
    };
  }, [id]);

  const g = gameRef.current;

  function hold(action: "up" | "down" | "left" | "right" | "use", on: boolean) {
    const gm = gameRef.current as unknown as
      | { input: { held: Record<string, boolean>; pressedUse: boolean } }
      | null;
    if (!gm) return;
    if (on && action === "use" && !gm.input.held["use"]) gm.input.pressedUse = true;
    gm.input.held[action] = on;
  }

  if (err) {
    return (
      <main className="game-shell">
        <div className="pixel-panel max-w-md">
          <h1 className="title">{err}</h1>
          <button className="btn primary" onClick={() => nav({ to: "/" })}>
            Back to menu
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="play-root">
      <div className="stage">
        <canvas ref={canvasRef} className="canvas" />

        {hud && (
          <>
            <div className="hud-top">
              <div className="bars">
                <Bar value={hud.hp} color="#d33b3b" label="HP" />
                <Bar value={hud.hunger} color="#d68a2a" label="Food" />
              </div>
              <div className="clock">
                Day {hud.day} · {hud.night ? "Night" : "Day"}
              </div>
              <div className="xp-chip" aria-label="XP" title="XP: dropped by zombies">
                <img className="ico" src={SPRITE_URLS["xp"]} alt="" draggable={false} />
                <span>XP {hud.xp}</span>
              </div>
              <div className="hud-right">
                <button className="btn small" onClick={() => g?.togglePause()}>
                  Menu
                </button>
                <div className="coords" aria-label="Coordinates">
                  <span>X {hud.pos.x}</span>
                  <span>Y {hud.pos.y}</span>
                  <span>Z {hud.pos.z}</span>
                </div>
              </div>
            </div>

            {hud.boss && (
              <div className="boss-bar" aria-label="Stormcaller health">
                <span className="boss-name">Stormcaller</span>
                <div className="boss-track">
                  <span className="boss-fill" style={{ width: Math.max(0, Math.min(100, (hud.boss.hp / hud.boss.max) * 100)) + "%" }} />
                </div>
              </div>
            )}

            {hud.toast && <div className="toast">{hud.toast}</div>}

            <div className="hotbar">
              {hud.slots.slice(0, 9).map((s, i) => (
                <button
                  key={i}
                  className={"cell" + (hud.hotbar === i ? " sel" : "")}
                  onClick={() => g?.setHotbar(i)}
                >
                  {s && (
                    <>
                      <ItemIcon id={s.id} />
                      <span className="cnt">{s.n > 1 ? s.n : ""}</span>
                      <DurBar slot={s} />
                    </>
                  )}
                  <span className="num">{i + 1}</span>
                </button>
              ))}
              <button className="cell inv" onClick={() => g?.toggleInventory()}>
                BAG
              </button>
            </div>

            <div className={"pad" + (touchControls ? "" : " compact")}>
              {touchControls ? (
                <Joystick onDir={hold} />
              ) : (
                <div className="dpad">
                  <PadBtn label="▲" cls="up" on={(v) => hold("up", v)} />
                  <PadBtn label="◀" cls="left" on={(v) => hold("left", v)} />
                  <PadBtn label="▶" cls="right" on={(v) => hold("right", v)} />
                  <PadBtn label="▼" cls="down" on={(v) => hold("down", v)} />
                </div>
              )}
              <PadBtn label="A" cls="action" on={(v) => hold("use", v)} />
            </div>

            {showHint && (
              <div className="controls-hint">
                {touchControls ? (
                  <>Joystick to move · Tap A to place · Hold A to break</>
                ) : (
                  <>Arrow keys to move · Space or click to place · Hold to break</>
                )}
              </div>
            )}

            {hud.invOpen && (
              <div className="overlay">
                <div className="pixel-panel wide">
                  <h2 className="sect">Inventory</h2>
                  <div className="inv-wrap">
                    <div className="grid">
                      {hud.slots.map((s, i) => (
                        <button key={i} className="cell" onClick={() => g?.clickSlot(i)}>
                          {s && (
                            <>
                              <ItemIcon id={s.id} />
                              <span className="cnt">{s.n > 1 ? s.n : ""}</span>
                              <DurBar slot={s} />
                            </>
                          )}
                        </button>
                      ))}
                    </div>
                    {hud.paint && (
                      <div className="paint-panel" aria-label="Paint block">
                        <span className="paint-title">Paint Block</span>
                        <div className="paint-row">
                          <button className="cell" aria-label="Paint box 1" onClick={() => g?.clickPaintSlot("a")}>
                            {hud.paint.a && (
                              <>
                                <ItemIcon id={hud.paint.a.id} />
                                <span className="cnt">{hud.paint.a.n > 1 ? hud.paint.a.n : ""}</span>
                              </>
                            )}
                          </button>
                          <span className="paint-sign">+</span>
                          <button className="cell" aria-label="Paint box 2" onClick={() => g?.clickPaintSlot("b")}>
                            {hud.paint.b && (
                              <>
                                <ItemIcon id={hud.paint.b.id} />
                                <span className="cnt">{hud.paint.b.n > 1 ? hud.paint.b.n : ""}</span>
                              </>
                            )}
                          </button>
                        </div>
                        <span className="paint-sign">=</span>
                        <button
                          className={"cell paint-out" + (hud.paint.out ? " ready" : "")}
                          aria-label="Painted result"
                          title={hud.paint.out ? (ITEMS[hud.paint.out.id]?.name ?? hud.paint.out.id) : undefined}
                          onClick={() => g?.takePaintResult()}
                        >
                          {hud.paint.out && <ItemIcon id={hud.paint.out.id} />}
                        </button>
                        <span className="paint-hint">A dye + a tile, wood or a sleeping tube</span>
                      </div>
                    )}
                  </div>
                  {hud.held && (
                    <div className="row held">
                      <span>
                        Holding: {ITEMS[hud.held.id]?.name ?? hud.held.id} x{hud.held.n}
                        {maxDurability(hud.held.id) !== undefined &&
                          ` (${usesLeft(hud.held)}/${maxDurability(hud.held.id)} uses)`}
                        {hud.held.power && ` - ${SWORD_POWER_NAMES[hud.held.power]}`}
                      </span>
                      <button className="btn small" onClick={() => g?.eatHeld()}>
                        Eat
                      </button>
                      <button className="btn small danger" onClick={() => g?.dropHeld()}>
                        Drop
                      </button>
                    </div>
                  )}

                  <h2 className="sect">Crafting</h2>
                  <div className="row tabs">
                    {CATS.map((c) => (
                      <button
                        key={c}
                        className={"btn small" + (cat === c ? " primary" : "")}
                        onClick={() => setCat(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="recipes">
                    {RECIPES.filter((r) => r.cat === cat).map((r) => {
                      const ok = g?.canCraft(r.id) ?? false;
                      return (
                        <button
                          key={r.id}
                          className={"recipe" + (ok ? "" : " off")}
                          onClick={() => g?.craft(r.id)}
                        >
                          <ItemIcon id={r.result} />
                          <span className="rname">
                            {ITEMS[r.result]?.name ?? r.result}
                            {r.count > 1 ? ` x${r.count}` : ""}
                          </span>
                          <span className="need">
                            {r.need
                              .map((n) => `${ITEMS[n.id]?.name ?? n.id} ${n.n}`)
                              .join(", ")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button className="btn ghost" onClick={() => g?.toggleInventory()}>
                    Close
                  </button>
                </div>
              </div>
            )}

            {hud.paused && !hud.dead && (
              <div className="overlay">
                <div className="pixel-panel max-w-sm">
                  <h2 className="title">Paused</h2>
                  <div className="stack">
                    <button className="btn primary" onClick={() => g?.togglePause()}>
                      Resume
                    </button>
                    <button className="btn" onClick={() => nav({ to: "/" })}>
                      Save &amp; Quit
                    </button>
                  </div>
                </div>
              </div>
            )}

            {hud.dead && (
              <div className="overlay">
                <div className="pixel-panel max-w-sm">
                  <h2 className="title dead">You Died</h2>
                  <div className="stack">
                    <button className="btn primary" onClick={() => g?.respawn()}>
                      Respawn
                    </button>
                    <button className="btn" onClick={() => nav({ to: "/" })}>
                      Quit to menu
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}


function ItemIcon({ id }: { id: string }) {
  const def = ITEMS[id];
  const url = def?.icon ? SPRITE_URLS[def.icon] : undefined;
  if (url) return <img className="ico" src={url} alt={def?.name ?? id} draggable={false} />;
  return <span className="chip" style={{ background: def?.color ?? "#888" }} />;
}

/** durability bar under a tool: green, then orange, then red as it wears out */
function DurBar({ slot }: { slot: Slot }) {
  const max = maxDurability(slot.id);
  const left = usesLeft(slot);
  if (max === undefined || left === undefined) return null;
  const ratio = left / max;
  return (
    <span className="dur" title={`${left}/${max} uses left${slot.power ? " - " + SWORD_POWER_NAMES[slot.power] : ""}`}>
      <span style={{ width: ratio * 100 + "%", background: durabilityColor(ratio) }} />
    </span>
  );
}

function Bar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="bar" aria-label={label}>
      <span className="fill" style={{ width: Math.max(0, Math.min(100, value)) + "%", background: color }} />
    </div>
  );
}

function PadBtn({
  label,
  cls,
  on,
}: {
  label: string;
  cls: string;
  on: (down: boolean) => void;
}) {
  // tracked ourselves rather than relying on the CSS :active pseudo-class, which touch browsers
  // apply inconsistently, so the pressed look is always in sync with what the game receives
  const [down, setDown] = useState(false);
  const press = (v: boolean) => {
    setDown(v);
    on(v);
  };
  return (
    <button
      className={"pbtn " + cls + (down ? " down" : "")}
      onPointerDown={(e) => {
        e.preventDefault();
        press(true);
      }}
      onPointerUp={() => press(false)}
      onPointerLeave={() => press(false)}
      onPointerCancel={() => press(false)}
    >
      {label}
    </button>
  );
}

type Dir = "up" | "down" | "left" | "right";

/**
 * Virtual joystick for touch phones. Drag the thumb from the centre; the offset is turned into the
 * same held up/down/left/right flags the arrow buttons and keyboard use, so the engine is untouched.
 * A dead zone avoids accidental movement and diagonals work by holding two directions at once.
 */
function Joystick({ onDir }: { onDir: (action: Dir, on: boolean) => void }) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const activeId = useRef<number | null>(null);
  const dirs = useRef<Record<Dir, boolean>>({ up: false, down: false, left: false, right: false });
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const setDirs = (next: Record<Dir, boolean>) => {
    (Object.keys(next) as Dir[]).forEach((d) => {
      if (dirs.current[d] !== next[d]) {
        dirs.current[d] = next[d];
        onDir(d, next[d]);
      }
    });
  };

  const release = () => {
    activeId.current = null;
    setKnob({ x: 0, y: 0 });
    setDirs({ up: false, down: false, left: false, right: false });
  };

  const move = (e: React.PointerEvent) => {
    const el = baseRef.current;
    if (!el || e.pointerId !== activeId.current) return;
    const r = el.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = e.clientX - (r.left + radius);
    let dy = e.clientY - (r.top + radius);
    const dist = Math.hypot(dx, dy);
    const max = radius * 0.6;
    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    setKnob({ x: dx, y: dy });
    const dead = radius * 0.22;
    // a direction counts as held once its axis passes the dead zone and it is not much weaker than the other axis
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    setDirs({
      left: dx < -dead && ax >= ay * 0.5,
      right: dx > dead && ax >= ay * 0.5,
      up: dy < -dead && ay >= ax * 0.5,
      down: dy > dead && ay >= ax * 0.5,
    });
  };

  // make sure nothing stays held if the joystick unmounts mid-drag
  useEffect(() => () => {
    (Object.keys(dirs.current) as Dir[]).forEach((d) => {
      if (dirs.current[d]) onDir(d, false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={baseRef}
      className="joystick"
      role="application"
      aria-label="Movement joystick"
      onPointerDown={(e) => {
        e.preventDefault();
        if (activeId.current !== null) return;
        activeId.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={(e) => e.pointerId === activeId.current && release()}
      onPointerCancel={(e) => e.pointerId === activeId.current && release()}
      onLostPointerCapture={release}
    >
      <div className="joystick-knob" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
    </div>
  );
}
