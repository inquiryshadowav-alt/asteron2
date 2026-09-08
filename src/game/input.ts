// Physical keys -> logical actions. Game logic never reads a key directly.

export type Action = "up" | "down" | "left" | "right" | "use" | "pause" | "inventory";

export interface KeyEventLike {
  key?: string;
  keyCode?: number;
}

/** webOS TV remote reserves 461 for Back; laptops use Escape. */
export function resolveAction(e: KeyEventLike): { action: Action; slot?: number } | null {
  const code = e.keyCode ?? 0;
  const k = (e.key ?? "").toLowerCase();

  if (code === 38 || k === "arrowup" || k === "w") return { action: "up" };
  if (code === 40 || k === "arrowdown" || k === "s") return { action: "down" };
  if (code === 37 || k === "arrowleft" || k === "a") return { action: "left" };
  if (code === 39 || k === "arrowright" || k === "d") return { action: "right" };
  if (code === 13 || k === "enter" || k === " " || code === 32) return { action: "use" };
  if (code === 27 || code === 461 || code === 10009 || k === "escape" || k === "backspace")
    return { action: "pause" };
  if (code === 48 || k === "0") return { action: "inventory" };
  if (code >= 49 && code <= 57) return { action: "use", slot: code - 48 };
  if (/^[1-9]$/.test(k)) return { action: "use", slot: parseInt(k, 10) };
  return null;
}

export class InputMap {
  held: Record<string, boolean> = {};
  pressedUse = false;
  pendingSlot: number | null = null;
  onPause: (() => void) | null = null;
  onInventory: (() => void) | null = null;

  private down = (e: KeyboardEvent) => {
    const r = resolveAction(e);
    if (!r) return;
    if (r.slot) {
      this.pendingSlot = r.slot - 1;
      e.preventDefault();
      return;
    }
    if (r.action === "pause") {
      e.preventDefault();
      this.onPause?.();
      return;
    }
    if (r.action === "inventory") {
      e.preventDefault();
      this.onInventory?.();
      return;
    }
    if (r.action === "use") {
      if (!this.held["use"]) this.pressedUse = true;
      this.held["use"] = true;
      e.preventDefault();
      return;
    }
    this.held[r.action] = true;
    e.preventDefault();
  };

  private up = (e: KeyboardEvent) => {
    const r = resolveAction(e);
    if (!r || r.slot) return;
    this.held[r.action] = false;
  };

  attach(target: Window) {
    target.addEventListener("keydown", this.down);
    target.addEventListener("keyup", this.up);
  }

  detach(target: Window) {
    target.removeEventListener("keydown", this.down);
    target.removeEventListener("keyup", this.up);
  }

  consumeUse(): boolean {
    const v = this.pressedUse;
    this.pressedUse = false;
    return v;
  }

  consumeSlot(): number | null {
    const v = this.pendingSlot;
    this.pendingSlot = null;
    return v;
  }

  clear() {
    this.held = {};
    this.pressedUse = false;
  }
}
