import { describe, expect, it } from "vitest";
import {
  DYES,
  FLOWER_DYE,
  ITEMS,
  OBJ_SOLID,
  OBJ_SPRITE,
  RECIPES,
  TOOL_USES,
  bedItem,
  durabilityColor,
  floorItem,
  isPaintInput,
  maxDurability,
  paintResult,
  usesLeft,
  type Tier,
} from "./data";
import { SPRITE_URLS } from "./sprite-assets";

const TIERS: Tier[] = ["wood", "stone", "iron", "diamond"];
const TYPES = ["pickaxe", "axe", "sword", "hoe"];

describe("tool durability", () => {
  it("gives every tool the uses for its material", () => {
    expect(TOOL_USES).toEqual({ wood: 22, stone: 33, iron: 47, diamond: 60, super: 22 });
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
    expect(usesLeft({ id: "iron_axe" })).toBe(47);
    expect(usesLeft({ id: "iron_axe", dur: 7 })).toBe(7);
    expect(usesLeft({ id: "iron_axe", dur: 99 })).toBe(47);
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

describe("tiles, dyes and painting", () => {
  it("makes 4 tiles from 1 wood", () => {
    const r = RECIPES.find((x) => x.result === "tile")!;
    expect(r.count).toBe(4);
    expect(r.need).toEqual([{ id: "wood", n: 1 }]);
  });

  it("builds the paint block from 3 settings blocks and 3 wood", () => {
    const r = RECIPES.find((x) => x.result === "paint_block")!;
    expect(r.count).toBe(1);
    expect(r.need).toEqual([{ id: "settings", n: 3 }, { id: "wood", n: 3 }]);
    expect(ITEMS["paint_block"]!.place).toBe("block_paint");
    expect(OBJ_SOLID["block_paint"]).toBe(true);
  });

  it("has an inventory skin for every tile, painted tube, dye and the paint block", () => {
    const ids = ["tile", "paint_block", ...DYES.flatMap((d) => [...(d === "black" ? [] : [`${d}_dye`]), `tile_${d}`, `bed_${d}`])];
    for (const id of ids) {
      expect(ITEMS[id], id).toBeDefined();
      expect(ITEMS[id]!.icon, id).toBeTruthy();
      expect(SPRITE_URLS[ITEMS[id]!.icon!], id).toBeTruthy();
    }
  });

  it("gives every flower a world skin and one of the four dyes", () => {
    const flowers = Object.keys(FLOWER_DYE);
    expect(flowers).toHaveLength(4);
    expect(new Set(Object.values(FLOWER_DYE)).size).toBe(4);
    for (const f of flowers) {
      expect(SPRITE_URLS[OBJ_SPRITE[f as keyof typeof OBJ_SPRITE]!], f).toBeTruthy();
      expect(OBJ_SOLID[f as keyof typeof OBJ_SOLID], f).toBe(false);
      expect(ITEMS[FLOWER_DYE[f as keyof typeof FLOWER_DYE]!], f).toBeDefined();
    }
    expect(FLOWER_DYE["flower_poppy"]).toBe("red_dye");
  });

  it("paints a tile or a sleeping tube with one dye, in either order", () => {
    expect(paintResult("red_dye", "tile")).toBe("tile_red");
    expect(paintResult("tile", "red_dye")).toBe("tile_red");
    expect(paintResult("blue_dye", "bed")).toBe("bed_blue");
    expect(paintResult("bed", "yellow_dye")).toBe("bed_yellow");
    expect(paintResult("white_dye", "tile_red")).toBe("tile_white"); // re-dyeing works
  });

  it("makes nothing unless it is exactly one dye plus one paintable thing", () => {
    expect(paintResult("red_dye", "tile_red")).toBeNull(); // already that colour
    expect(paintResult("red_dye", "blue_dye")).toBeNull();
    expect(paintResult("tile", "bed")).toBeNull();
    expect(paintResult("red_dye", "stone")).toBeNull();
    expect(paintResult("red_dye", undefined)).toBeNull();
    // coal is the black dye
    expect(paintResult("coal", "tile")).toBe("tile_black");
    expect(paintResult("bed_red", "coal")).toBe("bed_black");
    expect(paintResult("coal", "tile_black")).toBeNull();
    expect(isPaintInput("coal")).toBe(true);
    expect(paintResult(undefined, undefined)).toBeNull();
  });

  it("only lets dyes, tiles, sleeping tubes and wood into the paint boxes", () => {
    for (const id of ["red_dye", "tile", "tile_blue", "bed", "bed_white", "wood", "wood_red"]) expect(isPaintInput(id), id).toBe(true);
    for (const id of ["stone", "paint_block", "iron_pickaxe", "wood_pickaxe", "wood_sword", "flamethrower"]) expect(isPaintInput(id), id).toBe(false);
  });

  it("paints wood with a dye, in either order, and re-dyes it", () => {
    expect(paintResult("red_dye", "wood")).toBe("wood_red");
    expect(paintResult("wood", "blue_dye")).toBe("wood_blue");
    expect(paintResult("coal", "wood")).toBe("wood_black");
    expect(paintResult("white_dye", "wood_red")).toBe("wood_white");
    expect(paintResult("red_dye", "wood_red")).toBeNull();
    expect(paintResult("red_dye", "wood_pickaxe")).toBeNull();
  });

  it("gives every painted wood a placeable block and an inventory skin", () => {
    for (const d of DYES) {
      const it = ITEMS[`wood_${d}`]!;
      expect(it.place, d).toBe("block_wood");
      expect(it.woodDye, d).toBe(d);
      expect(SPRITE_URLS[it.icon!], `${d} icon`).toBeTruthy();
      expect(SPRITE_URLS[`planks_${d}`], `${d} block`).toBeTruthy();
    }
  });

  it("makes the flamethrower from 1 settings block and 1 coal, with its own icon", () => {
    const r = RECIPES.find((x) => x.result === "flamethrower")!;
    expect(r.need).toEqual([{ id: "settings", n: 1 }, { id: "coal", n: 1 }]);
    expect(ITEMS["flamethrower"]!.flamer).toBe(true);
    expect(SPRITE_URLS[ITEMS["flamethrower"]!.icon!]).toBeTruthy();
  });

  it("maps a colour back to the item that places it", () => {
    expect(floorItem(undefined)).toBe("tile");
    expect(floorItem("plain")).toBe("tile");
    expect(floorItem("red")).toBe("tile_red");
    expect(bedItem(undefined)).toBe("bed");
    expect(bedItem("blue")).toBe("bed_blue");
  });
});
