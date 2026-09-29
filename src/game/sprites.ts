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
  zombie: "zombie",
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

// ---------- Ghost Block glow ----------

/**
 * The Ghost Block's aura, drawn over its sprite: a faint violet shimmer while idle, and a hard red
 * pulse that speeds up as the boss comes due. `warn` is 0 while idle and 0 -> 1 across the warning.
 */
export function drawGhostGlow(c: Ctx, x: number, baseY: number, S: number, warn: number, time: number) {
  const cx = x + S / 2;
  const cy = baseY - S / 2;
  c.save();
  c.globalCompositeOperation = "lighter";
  if (warn <= 0) {
    const a = 0.16 + 0.06 * Math.sin(time * 2);
    const gr = c.createRadialGradient(cx, cy, S * 0.1, cx, cy, S * 1.0);
    gr.addColorStop(0, `rgba(150,80,255,${a})`);
    gr.addColorStop(1, "rgba(150,80,255,0)");
    c.fillStyle = gr;
    c.fillRect(cx - S, cy - S, S * 2, S * 2);
  } else {
    // normal blending: red stays red, whatever ground it sits on
    c.globalCompositeOperation = "source-over";
    const pulse = 0.5 + 0.5 * Math.sin(time * (7 + warn * 16));
    const r = S * (1.1 + 0.7 * warn + 0.25 * pulse);
    const gr = c.createRadialGradient(cx, cy, S * 0.1, cx, cy, r);
    gr.addColorStop(0, `rgba(255,40,30,${0.45 + 0.4 * pulse})`);
    gr.addColorStop(0.5, `rgba(255,20,20,${0.22 + 0.25 * pulse})`);
    gr.addColorStop(1, "rgba(255,20,20,0)");
    c.fillStyle = gr;
    c.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  c.restore();
}

// ---------- the Stormcaller ----------

/**
 * The boss, centred on x, wrapped in a glowing green aura (the flames themselves are particles the
 * engine spawns around it). `rise` goes 0 -> 1 while it climbs out of the Ghost Block.
 */
export function drawBoss(c: Ctx, cx: number, baseY: number, S: number, flash: boolean, bob: number, rise: number, time: number) {
  const img = sprite("stormcaller");
  const lift = S * (0.5 + 0.09 * Math.sin(bob));
  const w = S * 3.7;
  const h = img ? (img.naturalHeight / img.naturalWidth) * w : w;
  const sink = (1 - rise) * S * 1.4;
  const top = baseY - lift - h + sink;
  c.save();
  shadow(c, cx, baseY, S, 1.5);
  // green fire glow behind and around the body
  c.globalCompositeOperation = "lighter";
  const gr = c.createRadialGradient(cx, top + h * 0.55, h * 0.1, cx, top + h * 0.55, h * 0.75);
  const flick = 0.5 + 0.12 * Math.sin(time * 9) + 0.06 * Math.sin(time * 23);
  gr.addColorStop(0, `rgba(60,255,90,${0.42 * flick * rise})`);
  gr.addColorStop(0.6, `rgba(40,200,70,${0.22 * flick * rise})`);
  gr.addColorStop(1, "rgba(40,200,70,0)");
  c.fillStyle = gr;
  c.fillRect(cx - h, top - h * 0.2, h * 2, h * 1.5);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = Math.min(1, 0.25 + rise * 0.75);
  if (img) {
    const src = flash ? redVersion("stormcaller", img) : null;
    c.drawImage(src ?? img, cx - w / 2, top, w, h);
  } else {
    px(c, cx - w / 4, top, w / 2, h, flash ? "#e64444" : "#2a1a3a");
  }
  c.restore();
}

// ---------- boss attack effects (screen coordinates) ----------

/** a thick red laser with a white-hot core */
export function drawBeam(c: Ctx, x0: number, y0: number, x1: number, y1: number, width: number, alpha: number) {
  c.save();
  c.lineCap = "round";
  c.globalAlpha = Math.max(0, Math.min(1, alpha));
  c.globalCompositeOperation = "lighter";
  c.strokeStyle = "rgba(255,40,40,0.55)";
  c.lineWidth = width * 1.9;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
  c.globalCompositeOperation = "source-over";
  c.strokeStyle = "#ff3030";
  c.lineWidth = width;
  c.stroke();
  c.strokeStyle = "#ffffff";
  c.lineWidth = width * 0.38;
  c.stroke();
  c.restore();
}

/** the charging orb in front of the boss before the laser fires: `p` runs 0 -> 1 */
export function drawCharge(c: Ctx, x: number, y: number, S: number, p: number, time: number) {
  const r = S * (0.25 + 0.75 * p) * (1 + 0.1 * Math.sin(time * 30));
  c.save();
  c.globalCompositeOperation = "lighter";
  const gr = c.createRadialGradient(x, y, 0, x, y, r * 1.6);
  gr.addColorStop(0, "rgba(255,255,255,0.95)");
  gr.addColorStop(0.35, "rgba(255,60,60,0.8)");
  gr.addColorStop(1, "rgba(255,30,30,0)");
  c.fillStyle = gr;
  c.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
  c.restore();
}

/** Storm Blast warning: the danger circle fills from the centre as the blast winds up (`p` 0 -> 1) */
export function drawStormWarning(c: Ctx, x: number, y: number, r: number, p: number) {
  c.save();
  c.fillStyle = `rgba(160,80,255,${0.10 + 0.12 * p})`;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = `rgba(200,140,255,${0.5 + 0.4 * p})`;
  c.lineWidth = 3;
  c.setLineDash([10, 8]);
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);
  c.strokeStyle = `rgba(255,255,255,${0.35 + 0.5 * p})`;
  c.lineWidth = 4;
  c.beginPath();
  c.arc(x, y, r * p, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

/** the Storm Blast itself: a bright shockwave that flies out and fades (`p` 0 -> 1) */
export function drawStormBurst(c: Ctx, x: number, y: number, r: number, p: number) {
  c.save();
  c.globalCompositeOperation = "lighter";
  c.strokeStyle = `rgba(210,170,255,${1 - p})`;
  c.lineWidth = 12 * (1 - p) + 2;
  c.beginPath();
  c.arc(x, y, r * (0.35 + 0.75 * p), 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = `rgba(150,90,255,${0.35 * (1 - p)})`;
  c.beginPath();
  c.arc(x, y, r * (0.35 + 0.75 * p), 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** where lightning is about to land: a pulsing yellow ring on the tile (`p` 0 -> 1) */
export function drawLightningWarning(c: Ctx, x: number, y: number, r: number, p: number, time: number) {
  const pulse = 0.5 + 0.5 * Math.sin(time * (10 + p * 20));
  c.save();
  c.fillStyle = `rgba(255,240,120,${0.10 + 0.22 * p * pulse})`;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = `rgba(255,235,90,${0.55 + 0.4 * pulse})`;
  c.lineWidth = 3;
  c.beginPath();
  c.arc(x, y, r * (1 - 0.35 * p), 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

/** the bolt: a jagged white-blue line from high above down to the tile, fading with `alpha` */
export function drawLightningBolt(c: Ctx, x: number, y: number, height: number, alpha: number, seed: number, r: number) {
  c.save();
  c.globalAlpha = Math.max(0, Math.min(1, alpha));
  const pts: [number, number][] = [[x, y]];
  const n = 9;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const jitter = (hash(i, seed, 5) - 0.5) * r * 1.3 * (1 - t * 0.2);
    pts.push([x + (i === n ? 0 : jitter), y - height * t]);
  }
  c.lineJoin = "round";
  c.lineCap = "round";
  for (const [w, col] of [[r * 1.1, "rgba(90,130,255,0.45)"], [r * 0.5, "#8fb0ff"], [r * 0.2, "#ffffff"]] as const) {
    c.strokeStyle = col;
    c.lineWidth = w;
    c.beginPath();
    pts.forEach(([px2, py2], i) => (i ? c.lineTo(px2, py2) : c.moveTo(px2, py2)));
    c.stroke();
  }
  // impact flash
  const gr = c.createRadialGradient(x, y, 0, x, y, r * 1.5);
  gr.addColorStop(0, "rgba(255,255,255,0.9)");
  gr.addColorStop(1, "rgba(150,180,255,0)");
  c.fillStyle = gr;
  c.fillRect(x - r * 1.5, y - r * 1.5, r * 3, r * 3);
  c.restore();
}
