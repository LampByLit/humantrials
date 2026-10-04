import { describe, expect, it } from "vitest";
import { derive } from "./compound";
import { createRng } from "./rng";
import { isElemental } from "./recipe";
import { drawStock, swatches, type HueSlot } from "./labStock";

const SLOTS: HueSlot[] = [
  { stem: 0, front: 4, back: 3 },
  { stem: 0, front: 4, back: 3 },
  { stem: 5, front: 3, back: 2 },
];

function text(hex: number) {
  return `#${hex.toString(16).padStart(6, "0")}`.toUpperCase();
}

function wheel(hex: number) {
  return (derive(text(hex)).hue + 15) % 360;
}

describe("lab stock", () => {
  it("draws elemental pots and hue tables from the named list", () => {
    const named = new Set(swatches().map((swatch) => swatch.hex));
    const drawn = drawStock(createRng(7), SLOTS, 12);
    const pots = [...drawn.elementals.front, ...drawn.elementals.back];
    expect(pots).toHaveLength(12);
    for (const hex of pots) {
      expect(named.has(hex)).toBe(true);
      expect(isElemental(text(hex))).toBe(true);
    }
    const order = pots.map(wheel);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const seen = new Set<number>();
    for (const [index, row] of drawn.hues.entries()) {
      const hexes = [...row.front, ...row.back];
      expect(hexes).toHaveLength(SLOTS[index].front + SLOTS[index].back);
      for (const hex of hexes) {
        expect(named.has(hex)).toBe(true);
        expect(isElemental(text(hex))).toBe(false);
        expect(seen.has(hex)).toBe(false);
        seen.add(hex);
        expect(swatches().find((swatch) => swatch.hex === hex)?.stem).toBe(SLOTS[index].stem);
      }
      const hues = hexes.map(wheel);
      expect(hues).toEqual([...hues].sort((a, b) => a - b));
    }
  });

  it("changes the draw with the seed and repeats a seed", () => {
    const once = drawStock(createRng(1), SLOTS, 8);
    const again = drawStock(createRng(1), SLOTS, 8);
    const other = drawStock(createRng(2), SLOTS, 8);
    expect(again).toEqual(once);
    expect(other.elementals.front).not.toEqual(once.elementals.front);
  });
});
