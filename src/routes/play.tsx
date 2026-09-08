import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Game, type Hud } from "@/game/engine";
import { ITEMS, RECIPES, type RecipeCategory } from "@/game/data";
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

function Play() {
  const { id } = Route.useSearch();
  const nav = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [cat, setCat] = useState<RecipeCategory>("Tools");
  const [err, setErr] = useState("");

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
    return () => {
      window.removeEventListener("resize", fit);
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
              <button className="btn small" onClick={() => g?.togglePause()}>
                Menu
              </button>
            </div>

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
                    </>
                  )}
                  <span className="num">{i + 1}</span>
                </button>
              ))}
              <button className="cell inv" onClick={() => g?.toggleInventory()}>
                BAG
              </button>
            </div>

            <div className="pad">
              <div className="dpad">
                <PadBtn label="▲" cls="up" on={(v) => hold("up", v)} />
                <PadBtn label="◀" cls="left" on={(v) => hold("left", v)} />
                <PadBtn label="▶" cls="right" on={(v) => hold("right", v)} />
                <PadBtn label="▼" cls="down" on={(v) => hold("down", v)} />
              </div>
              <PadBtn label="A" cls="action" on={(v) => hold("use", v)} />
            </div>

            {hud.invOpen && (
              <div className="overlay">
                <div className="pixel-panel wide">
                  <h2 className="sect">Inventory</h2>
                  <div className="grid">
                    {hud.slots.map((s, i) => (
                      <button key={i} className="cell" onClick={() => g?.clickSlot(i)}>
                        {s && (
                          <>
                            <ItemIcon id={s.id} />
                            <span className="cnt">{s.n > 1 ? s.n : ""}</span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                  {hud.held && (
                    <div className="row held">
                      <span>
                        Holding: {ITEMS[hud.held.id]?.name ?? hud.held.id} x{hud.held.n}
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
  return (
    <button
      className={"pbtn " + cls}
      onPointerDown={(e) => {
        e.preventDefault();
        on(true);
      }}
      onPointerUp={() => on(false)}
      onPointerLeave={() => on(false)}
      onPointerCancel={() => on(false)}
    >
      {label}
    </button>
  );
}
