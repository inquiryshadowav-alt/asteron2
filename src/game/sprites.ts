// Sprite rendering: CDN bot/item art plus procedural pixel terrain fallbacks.
import type { ObjKind, TileType } from "./data";
import { OBJ_SPRITE, TILE_COLORS } from "./data";
import { SPRITE_URLS } from "./sprite-assets";

export type Ctx = CanvasRenderingContext2D;

// ---------- image cache ----------
const images: Record<string, HTMLImageElement> = {};
const ready: Record<string, boolean> = {};
const tinted: Record<string, HTMLCanvasElement> = {};

export function preloadSprites() {
  if (typeof window === "undefined") return;
  for (const key in SPRITE_URLS) {
    if (images[key]) continue;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      ready[key] = true;
    };
    img.src = SPRITE_URLS[key]!;
    images[key] = img;
  }
}

function sprite(key: string | undefined): HTMLImageElement | null {
  if (!key) return null;
  const img = images[key];
  return img && ready[key] ? img : null;
}

/** red-tinted copy used for the "got hit" flash */
function redVersion(key: string, img: HTMLImageElement): HTMLCanvasElement | null {
  const cached = tinted[key];
  if (cached) return cached;
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const cc = cv.getContext("2d");
  if (!cc) return null;
  cc.drawImage(img, 0, 0);
  cc.globalCompositeOperation = "source-atop";
  cc.fillStyle = "rgba(230,40,40,0.72)";
  cc.fillRect(0, 0, cv.width, cv.height);
  tinted[key] = cv;
  return cv;
}

function px(c: Ctx, x: number, y: number, w: number, h: number, color: string) {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
}

function hash(x: number, y: number, s: number) {
  let h = x * 374761393 + y * 668265263 + s * 977;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shadow(c: Ctx, cx: number, baseY: number, S: number, w = 0.55) {
  c.save();
  c.globalAlpha = 0.28;
  c.fillStyle = "#000000";
  c.beginPath();
  c.ellipse(cx, baseY - S * 0.05, S * w, S * w * 0.4, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** draws an image sprite standing on baseY, scaled to `tiles` tiles wide */
function blit(
  c: Ctx,
  key: string,
  img: HTMLImageElement,
  x: number,
  baseY: number,
  S: number,
  tiles: number,
  hurt: boolean,
) {
  const w = S * tiles;
  const h = (img.naturalHeight / img.naturalWidth) * w;
  const src = hurt ? redVersion(key, img) : null;
  if (src) c.drawImage(src, x, baseY - h, w, h);
  else c.drawImage(img, x, baseY - h, w, h);
}

export function drawGround(c: Ctx, t: TileType, ore: string | undefined, x: number, y: number, S: number, wx: number, wy: number) {
  const pair = TILE_COLORS[t];
  px(c, x, y, S, S, pair[0]);
  const q = S / 4;
  for (let i = 0; i < 4; i++) {
    const hx = Math.floor(hash(wx, wy, i * 3 + 1) * 4);
    const hy = Math.floor(hash(wx, wy, i * 3 + 2) * 4);
    px(c, x + hx * q, y + hy * q, q, q, pair[1]);
  }
  if (t === "farmland") {
    px(c, x, y + q, S, q / 2, "#7d5730");
    px(c, x, y + 3 * q, S, q / 2, "#7d5730");
  }
  if (ore) drawOre(c, ore, x, y, S);
}

// ---------- ores ----------
// Minecraft-style ore: the plain stone tile underneath with clumps of ore pixels on top.
// 16x16 pixel maps: a = ore, l = highlight, d = shade, . = show the stone.
export const ORE_ART: Record<string, string[]> = {
  iron: [
    "................",
    "..dd............",
    ".dlad....dld....",
    ".daad....aaa....",
    "..dd.....dad....",
    "................",
    ".......dd.......",
    "......dlad......",
    ".....dlaad......",
    "......dad.......",
    ".......d....dd..",
    "..da.......dla..",
    "..dd.......dad..",
    "........da......",
    "........dd......",
    "................",
  ],
  coal: [
    "................",
    "..........dd....",
    "...dd....dlaad..",
    "..dlad...daaad..",
    "..daad....daad..",
    "...dd......dd...",
    "................",
    ".....dld........",
    ".....aaa....dd..",
    ".....dad...dlad.",
    "...........daad.",
    "..la........dd..",
    "..dd...dld......",
    ".......aaa......",
    ".......dad......",
    "................",
  ],
  diamond: [
    "................",
    "....dd.....dd...",
    "...dlad...dla...",
    "..dlaad...dad...",
    "...dad..........",
    "....d...........",
    "..........dd....",
    ".........dlad...",
    ".........daad...",
    "...dld....dd....",
    "...aaa..........",
    "...dad..........",
    ".......da...da..",
    ".......dd...dd..",
    "................",
    "................",
  ],
};

export const ORE_PALETTE: Record<string, Record<string, string>> = {
  iron: { a: "#d8af93", l: "#eecdb2", d: "#967056" },
  diamond: { a: "#5decf5", l: "#d6fcff", d: "#26a0ac" },
  coal: { a: "#1e1e26", l: "#585868", d: "#0a0a0e" },
};

const oreCache: Record<string, HTMLCanvasElement> = {};

/** the ore overlay is drawn once per tile size, then blitted */
function oreOverlay(ore: string, S: number): HTMLCanvasElement | null {
  const cacheKey = ore + ":" + S;
  const hit = oreCache[cacheKey];
  if (hit) return hit;
  const art = ORE_ART[ore];
  const pal = ORE_PALETTE[ore];
  if (!art || !pal || typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const cc = cv.getContext("2d");
  if (!cc) return null;
  const u = S / 16;
  art.forEach((row, iy) => {
    for (let ix = 0; ix < row.length; ix++) {
      const col = pal[row[ix]!];
      if (col) px(cc, ix * u, iy * u, u, u, col);
    }
  });
  oreCache[cacheKey] = cv;
  return cv;
}

function drawOre(c: Ctx, ore: string, x: number, y: number, S: number) {
  const overlay = oreOverlay(ore, S);
  if (overlay) c.drawImage(overlay, Math.round(x), Math.round(y));
}

/** Tall objects are drawn from their base (bottom of tile). */
export function drawObject(c: Ctx, kind: ObjKind, x: number, baseY: number, S: number) {
  const key = OBJ_SPRITE[kind];
  const img = sprite(key);
  if (img && key) {
    if (kind === "bed") {
      c.save();
      c.globalAlpha = 0.25;
      c.fillStyle = "#000";
      c.fillRect(x + 2, baseY - S * 0.2, S * 2 - 4, S * 0.16);
      c.restore();
      blit(c, key, img, x, baseY - S * 0.12, S, 2, false);
      return;
    }
    if (kind === "door_open") {
      c.save();
      c.globalAlpha = 0.9;
      blit(c, key, img, x, baseY, S * 0.32, 1, false);
      c.restore();
      return;
    }
    blit(c, key, img, x, baseY, S, 1, false);
    return;
  }

  const u = S / 8;
  switch (kind) {
    case "tree": {
      px(c, x + 3 * u, baseY - S * 0.9, 2 * u, S * 0.9, "#6b4a22");
      px(c, x - u, baseY - S * 2, 10 * u, S * 1.2, "#2f7a2a");
      px(c, x + u, baseY - S * 2.4, 6 * u, S * 0.6, "#3c9433");
      px(c, x + 2 * u, baseY - S * 1.5, 2 * u, u, "#265f22");
      break;
    }
    case "mountain": {
      px(c, x - u, baseY - S * 1.6, 10 * u, S * 1.6, "#7a7a7a");
      px(c, x + u, baseY - S * 2.3, 6 * u, S * 0.8, "#8f8f8f");
      px(c, x + 2.5 * u, baseY - S * 2.6, 3 * u, S * 0.5, "#e9eef2");
      break;
    }
    case "bed":
    case "bed2": {
      px(c, x + u, baseY - S * 0.85, 6 * u, S * 0.8, "#7fd7f0");
      px(c, x + u, baseY - S * 0.85, 6 * u, S * 0.28, "#f2f2f2");
      break;
    }
    case "door_closed":
    case "door_open": {
      px(c, x + u, baseY - S * 1.2, 6 * u, S * 1.2, kind === "door_open" ? "#6b4a22" : "#a3762f");
      break;
    }
    case "cave_entrance":
    case "cave_exit": {
      px(c, x, baseY - S, S, S, "#6f6f75");
      px(c, x + u, baseY - S * 0.9, 6 * u, S * 0.8, "#14141a");
      if (kind === "cave_exit") {
        px(c, x + 2 * u, baseY - S * 0.85, 4 * u, u * 0.6, "#c9a35a");
        px(c, x + 2 * u, baseY - S * 0.5, 4 * u, u * 0.6, "#c9a35a");
        px(c, x + 2 * u, baseY - S * 0.2, 4 * u, u * 0.6, "#c9a35a");
      } else {
        px(c, x + u, baseY - S * 0.35, 6 * u, u * 0.8, "#3a3a44");
        px(c, x + 2 * u, baseY - S * 0.6, 4 * u, u * 0.8, "#2a2a32");
      }
      break;
    }
    case "tall_grass": {
      // a tuft of blades on the dirt; two of them carry the seed heads you get by breaking it
      const g = S / 16;
      const bottom = baseY - S * 0.07;
      const blades: [number, number, string][] = [
        [2, 5, "#3f8a24"],
        [3.6, 8, "#58b030"],
        [5.2, 6, "#6fcf3c"],
        [6.8, 10, "#58b030"],
        [8.4, 7, "#3f8a24"],
        [10, 9, "#6fcf3c"],
        [11.6, 6, "#58b030"],
        [13, 4, "#3f8a24"],
      ];
      for (const [bx, h, col] of blades) {
        px(c, x + bx * g, bottom - h * g, g * 1.15, h * g, col);
        px(c, x + bx * g, bottom - h * g - g * 0.8, g * 1.15, g * 0.8, "#9be25a");
      }
      for (const [bx, h] of [blades[3]!, blades[5]!]) {
        const top = bottom - h * g - g * 0.8;
        px(c, x + bx * g - g * 0.6, top - g * 1.6, g * 2.35, g * 1.6, "#e3d27a");
        px(c, x + bx * g - g * 0.6, top - g * 1.6, g * 1.1, g * 0.8, "#f3e9a6");
      }
      break;
    }
    case "crop0":
    case "crop1":
    case "crop2":
    case "crop3": {
      const stage = parseInt(kind.slice(4), 10);
      const h = S * (0.25 + stage * 0.22);
      const col = stage >= 3 ? "#e0c04a" : "#8db83f";
      px(c, x + 2 * u, baseY - h, u, h, col);
      px(c, x + 5 * u, baseY - h * 0.8, u, h * 0.8, col);
      if (stage >= 2) px(c, x + 3.5 * u, baseY - h * 1.1, u, h * 0.5, col);
      break;
    }
    default: {
      const map: Record<string, [string, string]> = {
        block_dirt: ["#8b6039", "#6f4c2c"],
        block_stone: ["#9a9a9a", "#787878"],
        block_sand: ["#e6d9a2", "#c8bb84"],
        block_wood: ["#8a5f27", "#6d4a1d"],
        block_settings: ["#5a5f66", "#3d4147"],
        block_iron: ["#e6e6e6", "#bdbdbd"],
        block_diamond: ["#7fe9e2", "#41b9b3"],
      };
      const cols = map[kind] ?? ["#999", "#777"];
      px(c, x, baseY - S * 1.1, S, S * 1.1, cols[0]);
      px(c, x, baseY - S * 0.25, S, S * 0.25, cols[1]);
      px(c, x + u, baseY - S * 0.95, 2 * u, 2 * u, cols[1]);
      break;
    }
  }
}

/** every bot (player included) floats a little above its shadow */
function drawBot(c: Ctx, key: string, x: number, baseY: number, S: number, bob: number, hurt: boolean) {
  const cx = x + S / 2;
  shadow(c, cx, baseY, S);
  const img = sprite(key);
  const lift = S * (0.18 + 0.05 * Math.sin(bob));
  if (img) {
    const w = S * 1.15;
    const h = (img.naturalHeight / img.naturalWidth) * w;
    const src = hurt ? redVersion(key, img) : null;
    const dx = cx - w / 2;
    const dy = baseY - lift - h;
    if (src) c.drawImage(src, dx, dy, w, h);
    else c.drawImage(img, dx, dy, w, h);
    return;
  }
  const u = S / 8;
  px(c, x + 2 * u, baseY - lift - S * 0.9, 4 * u, 4 * u, hurt ? "#e64444" : "#f2f2f2");
  px(c, x + 3 * u, baseY - lift - S * 0.72, 2 * u, 1.2 * u, "#101014");
}

export function drawPlayer(c: Ctx, x: number, baseY: number, S: number, dir: string, hurt: boolean, bob = 0) {
  drawBot(c, "player", x, baseY, S, bob, hurt);
}

export const MOB_SPRITE: Record<string, string> = {
  insect: "insect",
  hover: "hover",
  builder: "builder",
  corrupted: "corrupted",
  phantom: "phantom",
  electric: "electric",
  creeper: "creeper",
};

export function drawMob(c: Ctx, kind: string, x: number, baseY: number, S: number, flash: boolean, bob = 0) {
  drawBot(c, MOB_SPRITE[kind] ?? "insect", x, baseY, S, bob, flash);
}

// ---------- torch ----------
// A torch is a small standing stick with a flickering pixel flame. Three flame frames, one letter
// per pixel: R = red tip, O = orange, Y = hot yellow.
const FLAME_FRAMES: string[][] = [
  [".R..", ".OO.", "OOYO", "OYYO", ".OO."],
  ["..R.", ".OO.", "OYYO", "OYYO", ".OO."],
  [".R..", "ROO.", ".OYO", "OYYO", ".OO."],
];
const FLAME_COLORS: Record<string, string> = { R: "#ff5a1f", O: "#ff9a2b", Y: "#ffe36b" };

/** draw a torch standing in the tile whose bottom edge is at `baseY`; `time` and the tile position desync the flicker */
export function drawTorch(c: Ctx, x: number, baseY: number, S: number, time: number, tx: number, ty: number) {
  const u = S / 16;
  const top = baseY - S;
  const frame = (Math.floor(time * 9) + tx * 3 + ty * 7) % FLAME_FRAMES.length;
  // stick: dark outline, then three shades of wood
  px(c, x + 5.9 * u, top + 6.9 * u, 4.2 * u, 8.4 * u, "#2a140a");
  px(c, x + 6.5 * u, top + 7.5 * u, 1 * u, 7 * u, "#b98444");
  px(c, x + 7.5 * u, top + 7.5 * u, 1.2 * u, 7 * u, "#8f5c2c");
  px(c, x + 8.7 * u, top + 7.5 * u, 0.8 * u, 7 * u, "#5a3719");
  // charred head
  px(c, x + 5.9 * u, top + 5.4 * u, 4.2 * u, 2 * u, "#2a140a");
  px(c, x + 6.4 * u, top + 5.9 * u, 3.2 * u, 1.2 * u, "#3a3632");
  // flame
  const rows = FLAME_FRAMES[frame]!;
  rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const col = FLAME_COLORS[row[rx]!];
      if (col) px(c, x + (6 + rx) * u, top + (0.9 + ry) * u, u * 1.02, u * 1.02, col);
    }
  });
  if (frame === 1) px(c, x + 7.6 * u, top + 0 * u, u * 0.8, u * 0.8, "#ffd27a"); // a stray spark
}
