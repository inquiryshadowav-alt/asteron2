// Static game data: tiles, items, tools, recipes.
// Pure data — no rendering, no DOM.

export type TileType = "grass" | "dirt" | "sand" | "water" | "stone" | "farmland" | "cave";
export type Ore = "iron" | "diamond" | "coal";
export type ObjKind =
  | "tree"
  | "mountain"
  | "bed"
  | "bed2"
  | "door_closed"
  | "door_open"
  | "cave_entrance"
  | "cave_exit"
  | "block_dirt"
  | "block_stone"
  | "block_sand"
  | "block_wood"
  | "block_settings"
  | "block_iron"
  | "block_diamond"
  | "crop0"
  | "crop1"
  | "crop2"
  | "crop3"
  | "tall_grass";

export interface Tile {
  t: TileType;
  ore?: Ore | undefined;
  obj?: ObjKind | undefined;
  /** world-time seconds when a crop was planted */
  pt?: number | undefined;
  /** a torch is mounted on this tile (on the ground, or on a block / wall) */
  torch?: boolean | undefined;
}

export const TILE_COLORS: Record<TileType, [string, string]> = {
  grass: ["#5aa02c", "#4b8c25"],
  dirt: ["#8b6039", "#7a5331"],
  sand: ["#e6d9a2", "#dbcd92"],
  water: ["#3a6fd8", "#2f5fc0"],
  stone: ["#8a8a8a", "#7c7c7c"],
  farmland: ["#6b4a2a", "#5d4024"],
  cave: ["#4a4a52", "#3e3e46"],
};

export const GROUND_SOLID: Record<TileType, boolean> = {
  grass: false,
  dirt: false,
  sand: false,
  water: true,
  stone: true,
  farmland: false,
  cave: false,
};

/** objects that block movement */
export const OBJ_SOLID: Record<ObjKind, boolean> = {
  tree: true,
  mountain: true,
  bed: false,
  bed2: false,
  door_closed: true,
  door_open: false,
  cave_entrance: false,
  cave_exit: false,
  block_dirt: true,
  block_stone: true,
  block_sand: true,
  block_wood: true,
  block_settings: true,
  block_iron: true,
  block_diamond: true,
  crop0: false,
  crop1: false,
  crop2: false,
  crop3: false,
  tall_grass: false,
};

/** objects drawn in the "tall" pass, sorted by base Y */
export const OBJ_TALL: Record<ObjKind, boolean> = {
  tree: true,
  mountain: true,
  bed: false,
  bed2: false,
  door_closed: true,
  door_open: true,
  cave_entrance: false,
  cave_exit: false,
  block_dirt: true,
  block_stone: true,
  block_sand: true,
  block_wood: true,
  block_settings: true,
  block_iron: true,
  block_diamond: true,
  crop0: false,
  crop1: false,
  crop2: false,
  crop3: false,
  tall_grass: false,
};

/** sprite key used for an object (undefined = procedural drawing) */
export const OBJ_SPRITE: Partial<Record<ObjKind, string>> = {
  bed: "bed",
  door_closed: "door",
  door_open: "door",
  block_dirt: "dirt",
  block_stone: "stone",
  block_wood: "planks",
  block_settings: "settings",
  block_iron: "iron_block",
  block_diamond: "diamond_block",
};

/** item dropped when a placed block is broken */
export const BLOCK_DROP: Partial<Record<ObjKind, string>> = {
  block_dirt: "dirt",
  block_stone: "stone",
  block_sand: "sand",
  block_wood: "wood",
  block_settings: "settings",
  block_iron: "iron_block",
  block_diamond: "diamond_block",
};

export type ToolType = "sword" | "pickaxe" | "axe" | "hoe";
export type Tier = "wood" | "stone" | "iron" | "diamond";
export const TIER_LEVEL: Record<Tier, number> = { wood: 1, stone: 2, iron: 3, diamond: 4 };

/**
 * Sword damage per tier, hand-tuned rather than derived from TIER_LEVEL: each step is a bigger
 * jump than the last, so a diamond sword clearly cuts down the number of hits a fight takes
 * compared to wood, not just a little more per swing. Bare hands deal 3.
 */
export const SWORD_DAMAGE: Record<Tier, number> = { wood: 8, stone: 12, iron: 17, diamond: 24 };
export const BARE_HAND_DAMAGE = 3;

/**
 * Damage when a pickaxe, axe or hoe is swung at a mob instead of a proper sword. It still lands a
 * hit, and a diamond one still hits harder than a wood one, but every tier is far below a sword of
 * the same material — and, in the engine, it swings much slower too (see TOOL_HIT_COOLDOWN) — so
 * reaching for a mining tool in a fight is always a worse choice than drawing a sword.
 */
export const TOOL_ATTACK_DAMAGE: Record<Tier, number> = { wood: 3, stone: 5, iron: 7, diamond: 9 };

/** attack cooldown, in seconds: a sword or bare fists swing at normal speed; any other tool is slow */
export const SWORD_HIT_COOLDOWN = 0.45;
export const TOOL_HIT_COOLDOWN = 0.85;

/**
 * Off-tool mining rate: using anything other than the one tool built for a job (a pickaxe on
 * stone, an axe on wood) still works, but far slower than even bare hands — the wrong tool is
 * clumsy, not just unhelpful. Ore always still needs a proper pickaxe of the right tier; this only
 * ever applies to plain stone, mountains and trees.
 */
export const WRONG_TOOL_RATE = 0.12;
export const TIER_COLOR: Record<Tier, string> = {
  wood: "#a3762f",
  stone: "#9a9a9a",
  iron: "#e2e2e2",
  diamond: "#4fe0d6",
};

export interface ItemDef {
  id: string;
  name: string;
  color: string;
  stack: number;
  /** sprite key for the item icon */
  icon?: string;
  place?: ObjKind;
  food?: number;
  tool?: { type: ToolType; tier: Tier };
  seed?: boolean;
  /** placed as a light source on a tile, not as a block */
  torch?: boolean;
}

const HOE_ART = new Set<Tier>(["wood", "stone", "iron", "diamond"]);

function tool(type: ToolType, tier: Tier): ItemDef {
  const names: Record<ToolType, string> = {
    sword: "Sword",
    pickaxe: "Pickaxe",
    axe: "Axe",
    hoe: "Hoe",
  };
  const tn = tier.charAt(0).toUpperCase() + tier.slice(1);
  const iconKey = `${tier}_${type}`;
  const def: ItemDef = {
    id: `${tier}_${type}`,
    name: `${tn} ${names[type]}`,
    color: TIER_COLOR[tier],
    stack: 1,
    tool: { type, tier },
  };
  // every hoe tier has its own art; fall back to the axe icon if one is ever missing
  if (type !== "hoe" || HOE_ART.has(tier)) def.icon = iconKey;
  else def.icon = `${tier}_axe`;
  return def;
}

const list: ItemDef[] = [
  { id: "dirt", name: "Dirt", color: "#8b6039", stack: 64, place: "block_dirt", icon: "dirt" },
  { id: "stone", name: "Stone", color: "#8a8a8a", stack: 64, place: "block_stone", icon: "stone" },
  { id: "sand", name: "Sand", color: "#e6d9a2", stack: 64, place: "block_sand" },
  { id: "wood", name: "Wood", color: "#7b5220", stack: 64, place: "block_wood", icon: "log" },
  { id: "settings", name: "Settings Block", color: "#5a5f66", stack: 64, place: "block_settings", icon: "settings" },
  { id: "iron", name: "Iron", color: "#d9d9d9", stack: 64, icon: "ingot_iron" },
  { id: "diamond", name: "Diamond", color: "#4fe0d6", stack: 64, icon: "ingot_diamond" },
  { id: "iron_block", name: "Iron Block", color: "#e6e6e6", stack: 64, place: "block_iron", icon: "iron_block" },
  { id: "diamond_block", name: "Diamond Block", color: "#4fe0d6", stack: 64, place: "block_diamond", icon: "diamond_block" },
  { id: "seeds", name: "Seeds", color: "#b9c94a", stack: 64, seed: true, icon: "seeds" },
  { id: "wheat", name: "Wheat", color: "#e0c04a", stack: 64, food: 20, icon: "wheat" },
  { id: "meat", name: "Meat", color: "#c4552f", stack: 64, food: 35, icon: "meat" },
  { id: "bed", name: "Sleeping Tube", color: "#7fd7f0", stack: 1, place: "bed", icon: "bed" },
  { id: "door", name: "Wooden Door", color: "#a3762f", stack: 4, place: "door_closed", icon: "door" },
  { id: "stick", name: "Stick", color: "#a3762f", stack: 64, icon: "stick" },
  { id: "coal", name: "Coal", color: "#2b2b33", stack: 64, icon: "coal" },
  { id: "torch", name: "Torch", color: "#f5a623", stack: 64, icon: "torch", torch: true },
];

(["wood", "stone", "iron", "diamond"] as Tier[]).forEach((t) => {
  (["pickaxe", "axe", "sword", "hoe"] as ToolType[]).forEach((k) => list.push(tool(k, t)));
});

export const ITEMS: Record<string, ItemDef> = {};
list.forEach((i) => (ITEMS[i.id] = i));

export type RecipeCategory = "Tools" | "Food" | "Comfort" | "Materials";
export interface Recipe {
  id: string;
  result: string;
  count: number;
  cat: RecipeCategory;
  need: { id: string; n: number }[];
}

const matFor: Record<Tier, string> = {
  wood: "wood",
  stone: "stone",
  iron: "iron",
  diamond: "diamond",
};

export const RECIPES: Recipe[] = [
  { id: "sticks", result: "stick", count: 4, cat: "Materials", need: [{ id: "wood", n: 1 }] },
  { id: "iron_block", result: "iron_block", count: 1, cat: "Materials", need: [{ id: "iron", n: 9 }] },
  { id: "diamond_block", result: "diamond_block", count: 1, cat: "Materials", need: [{ id: "diamond", n: 9 }] },
  { id: "bed", result: "bed", count: 1, cat: "Comfort", need: [{ id: "settings", n: 2 }, { id: "iron", n: 2 }] },
  { id: "door", result: "door", count: 1, cat: "Comfort", need: [{ id: "wood", n: 4 }] },
  { id: "torch", result: "torch", count: 4, cat: "Comfort", need: [{ id: "coal", n: 1 }, { id: "stick", n: 1 }] },
  { id: "seeds", result: "seeds", count: 2, cat: "Food", need: [{ id: "wheat", n: 1 }] },
];

(["wood", "stone", "iron", "diamond"] as Tier[]).forEach((tier) => {
  const m = matFor[tier];
  RECIPES.push(
    { id: `${tier}_pickaxe`, result: `${tier}_pickaxe`, count: 1, cat: "Tools", need: [{ id: m, n: 3 }, { id: "stick", n: 2 }] },
    { id: `${tier}_axe`, result: `${tier}_axe`, count: 1, cat: "Tools", need: [{ id: m, n: 3 }, { id: "stick", n: 2 }] },
    { id: `${tier}_sword`, result: `${tier}_sword`, count: 1, cat: "Tools", need: [{ id: m, n: 2 }, { id: "stick", n: 1 }] },
    { id: `${tier}_hoe`, result: `${tier}_hoe`, count: 1, cat: "Tools", need: [{ id: m, n: 2 }, { id: "stick", n: 2 }] },
  );
});

/** minimum pickaxe tier level required to mine a material */
export const MINE_REQ = { stone: 1, coal: 1, iron: 2, diamond: 3 };

// ---------- tool durability ----------

/** how many uses a tool survives, by material */
export const TOOL_USES: Record<Tier, number> = { wood: 22, stone: 33, iron: 47, diamond: 60 };

/** bumped whenever TOOL_USES changes; saves remember which version their tools were counted in */
export const TOOLS_VERSION = 4;

/** the tables of earlier versions, so an older save keeps the same amount of wear on its tools (1 = no version stored) */
export const OLD_TOOL_USES: Record<number, Record<Tier, number>> = {
  1: { wood: 5, stone: 9, iron: 12, diamond: 20 },
  2: { wood: 12, stone: 9, iron: 27, diamond: 40 },
  3: { wood: 12, stone: 18, iron: 27, diamond: 40 },
};

/** max durability of an item, or undefined when it isn't a tool */
export function maxDurability(id: string): number | undefined {
  const t = ITEMS[id]?.tool;
  return t ? TOOL_USES[t.tier] : undefined;
}

/** uses left for a tool slot; tools from before durability existed count as brand new */
export function usesLeft(slot: { id: string; dur?: number }): number | undefined {
  const max = maxDurability(slot.id);
  if (max === undefined) return undefined;
  return Math.max(0, Math.min(max, slot.dur ?? max));
}

/** green while healthy, orange when getting low, red when nearly broken */
export function durabilityColor(ratio: number): string {
  if (ratio > 0.5) return "#4cc94c";
  if (ratio > 0.25) return "#e8952b";
  return "#d33b3b";
}
