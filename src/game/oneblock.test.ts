import { describe, it, expect } from "vitest";
import { World } from "./world";

describe("One Block world", () => {
  it("is all void, and mobs/pathing treat void as not walkable while the player may step in", () => {
    const w = new World(123, {}, "surface", "oneblock");
    expect(w.get(50, -40).t).toBe("void");
    expect(w.walkable(50, -40)).toBe(false);
    expect(w.walkable(50, -40, true)).toBe(true);
  });
  it("keeps iron and diamond ore on the surface layer", () => {
    const w = new World(1, { "0,1": { t: "stone", ore: "diamond" } }, "surface", "oneblock");
    expect(w.get(0, 1).ore).toBe("diamond");
  });
  it("survival worlds are unchanged", () => {
    const w = new World(1);
    let voids = 0;
    for (let x = -20; x < 20; x++) for (let y = -20; y < 20; y++) if (w.get(x, y).t === "void") voids++;
    expect(voids).toBe(0);
  });
});
