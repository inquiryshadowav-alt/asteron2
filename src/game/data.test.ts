import { describe, expect, it } from "vitest";
import { ITEMS, TOOL_USES, durabilityColor, maxDurability, usesLeft, type Tier } from "./data";
import { SPRITE_URLS } from "./sprite-assets";

const TIERS: Tier[] = ["wood", "stone", "iron", "diamond"];
const TYPES = ["pickaxe", "axe", "sword", "hoe"];

describe("tool durability", () => {
  it("gives every tool the uses for its material", () => {
    expect(TOOL_USES).toEqual({ wood: 12, stone: 9, iron: 27, diamond: 40 });
    for (const tier of TIERS) {
      for (const type of TYPES) expect(maxDurability(`${tier}_${type}`), `${tier}_${type}`).toBe(TOOL_USES[tier]);
    }
  });

  it("only tools have durability", () => {
    for (const id of ["wood", "stone", "iron", "diamond", "seeds", "wheat", "meat"]) {
      expect(maxDurability(id), id).toBeUndefined();
    }
  });

  it("treats tools without a stored value as brand new and clamps bad values", () => {
    expect(usesLeft({ id: "iron_axe" })).toBe(27);
    expect(usesLeft({ id: "iron_axe", dur: 7 })).toBe(7);
    expect(usesLeft({ id: "iron_axe", dur: 99 })).toBe(27);
    expect(usesLeft({ id: "iron_axe", dur: -3 })).toBe(0);
    expect(usesLeft({ id: "wood", dur: 3 })).toBeUndefined();
  });

  it("goes green, then orange, then red as a tool wears out", () => {
    const color = (left: number, max: number) => durabilityColor(left / max);
    const GREEN = durabilityColor(1);
    const ORANGE = durabilityColor(0.4);
    const RED = durabilityColor(0.1);
    expect(new Set([GREEN, ORANGE, RED]).size).toBe(3);
    // wooden tool: 5 uses
    expect([5, 4, 3, 2, 1].map((n) => color(n, 5))).toEqual([GREEN, GREEN, GREEN, ORANGE, RED]);
    // diamond tool: 20 uses
    expect(color(20, 20)).toBe(GREEN);
    expect(color(10, 20)).toBe(ORANGE);
    expect(color(6, 20)).toBe(ORANGE);
    expect(color(5, 20)).toBe(RED); // a quarter left or less
  });
});

describe("tool art", () => {
  it.each(TIERS)("the %s hoe has its own sprite", (tier) => {
    expect(ITEMS[`${tier}_hoe`]!.icon).toBe(`${tier}_hoe`);
    expect(SPRITE_URLS[`${tier}_hoe`]).toBeTruthy();
  });
});

describe("torches and coal", () => {
  it("have inventory icons that exist", () => {
    for (const id of ["torch", "coal"]) {
      expect(ITEMS[id]!.icon, id).toBe(id);
      expect(SPRITE_URLS[id], id).toBeTruthy();
    }
  });

  it("are crafted from one coal and one stick", async () => {
    const { RECIPES } = await import("./data");
    const r = RECIPES.find((x) => x.result === "torch")!;
    expect(r.need).toEqual([{ id: "coal", n: 1 }, { id: "stick", n: 1 }]);
    expect(r.count).toBeGreaterThan(1);
  });
});
