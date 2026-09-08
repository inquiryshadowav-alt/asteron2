import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listWorlds, saveWorldMeta, deleteWorld, type WorldMeta } from "@/game/world";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Blockcraft 2D — Top-Down Survival Mining Game" },
      {
        name: "description",
        content:
          "Play Blockcraft 2D in your browser: mine, craft, build and survive the night in an infinite pixel world. Works on TVs, phones and old browsers.",
      },
      { property: "og:title", content: "Blockcraft 2D — Top-Down Survival Mining Game" },
      {
        property: "og:description",
        content: "Mine, craft, build and survive the night in an infinite 2D pixel world.",
      },
    ],
  }),
  component: Home,
});

type Screen = "menu" | "worlds" | "create" | "howto";

function Home() {
  const nav = useNavigate();
  const [screen, setScreen] = useState<Screen>("menu");
  const [worlds, setWorlds] = useState<WorldMeta[]>([]);
  const [name, setName] = useState("New World");
  const [difficulty, setDifficulty] = useState<"easy" | "hard">("easy");
  const [seedText, setSeedText] = useState("");

  useEffect(() => setWorlds(listWorlds()), [screen]);

  function create() {
    const seed = seedText.trim()
      ? Array.from(seedText).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 7)
      : Math.floor(Math.random() * 2147483647);
    const meta: WorldMeta = {
      id: "w" + Date.now().toString(36),
      name: name.trim() || "New World",
      seed,
      difficulty,
      created: Date.now(),
    };
    saveWorldMeta(meta);
    nav({ to: "/play", search: { id: meta.id } });
  }

  return (
    <main className="game-shell">
      <div className="pixel-panel w-full max-w-lg">
        <h1 className="title">BLOCKCRAFT 2D</h1>
        <p className="subtitle">mine · craft · build · survive</p>

        {screen === "menu" && (
          <div className="stack">
            <button className="btn primary" onClick={() => setScreen("worlds")}>
              Play
            </button>
            <button className="btn" onClick={() => setScreen("create")}>
              Create World
            </button>
            <button className="btn" onClick={() => setScreen("howto")}>
              How to Play
            </button>
          </div>
        )}

        {screen === "worlds" && (
          <div className="stack">
            <h2 className="sect">Your Worlds</h2>
            {worlds.length === 0 && <p className="muted">No worlds yet. Create one!</p>}
            {worlds.map((w) => (
              <div key={w.id} className="row">
                <button
                  className="btn grow"
                  onClick={() => nav({ to: "/play", search: { id: w.id } })}
                >
                  {w.name}
                  <span className="tag">{w.difficulty}</span>
                </button>
                <button
                  className="btn danger"
                  aria-label={`Delete ${w.name}`}
                  onClick={() => {
                    deleteWorld(w.id);
                    setWorlds(listWorlds());
                  }}
                >
                  X
                </button>
              </div>
            ))}
            <button className="btn primary" onClick={() => setScreen("create")}>
              + New World
            </button>
            <button className="btn ghost" onClick={() => setScreen("menu")}>
              Back
            </button>
          </div>
        )}

        {screen === "create" && (
          <div className="stack">
            <h2 className="sect">Create World</h2>
            <label className="lbl">
              World name
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="lbl">
              Seed (optional)
              <input
                className="inp"
                value={seedText}
                placeholder="leave blank for random"
                onChange={(e) => setSeedText(e.target.value)}
              />
            </label>
            <div className="row">
              <button
                className={"btn grow" + (difficulty === "easy" ? " primary" : "")}
                onClick={() => setDifficulty("easy")}
              >
                Easy
              </button>
              <button
                className={"btn grow" + (difficulty === "hard" ? " primary" : "")}
                onClick={() => setDifficulty("hard")}
              >
                Hard
              </button>
            </div>
            <p className="muted">
              {difficulty === "easy"
                ? "Fewer night mobs, slower hunger, gentler hits."
                : "Swarms of night mobs, fast hunger, heavy damage."}
            </p>
            <button className="btn primary" onClick={create}>
              Create &amp; Play
            </button>
            <button className="btn ghost" onClick={() => setScreen("menu")}>
              Back
            </button>
          </div>
        )}

        {screen === "howto" && (
          <div className="stack">
            <h2 className="sect">How to Play</h2>
            <ul className="muted list">
              <li>Arrows / WASD / D-pad — move</li>
              <li>Enter, Space or the A button — mine, place, hit</li>
              <li>1–9 — pick a hotbar slot · 0 — inventory</li>
              <li>Esc / Back — pause</li>
              <li>Chop trees for wood, craft sticks, then tools</li>
              <li>Wood pickaxe mines stone, stone mines iron, iron mines diamond</li>
              <li>Build a bed before dark, or fight zombies, skeletons, spiders and creepers</li>
            </ul>
            <button className="btn ghost" onClick={() => setScreen("menu")}>
              Back
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
