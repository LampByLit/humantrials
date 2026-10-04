import { colornames } from "color-name-list/bestof";
import { derive } from "./compound";
import { isElemental } from "./recipe";

// Twelve 30° stems, same bins as latinName. Stem 0 wraps past 0°.
const STEMS = 12;

export type Swatch = { hex: number; hue: number; stem: number; elemental: boolean };

export type Row = { front: number[]; back: number[] };

export type HueSlot = { stem: number; front: number; back: number };

let cache: Swatch[] | null = null;

function wheel(hue: number) {
  return (hue + 15) % 360;
}

/** Every distinct named color, once. */
export function swatches(): Swatch[] {
  if (cache) return cache;
  const seen = new Set<number>();
  const out: Swatch[] = [];
  for (const entry of colornames) {
    const hex = parseInt(entry.hex.slice(1), 16);
    if (seen.has(hex)) continue;
    seen.add(hex);
    const compound = derive(entry.hex);
    out.push({
      hex,
      hue: compound.hue,
      stem: Math.floor(wheel(compound.hue) / 30) % STEMS,
      elemental: isElemental(entry.hex),
    });
  }
  cache = out;
  return out;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

function byWheel(a: Swatch, b: Swatch) {
  return wheel(a.hue) - wheel(b.hue);
}

function take(pool: Swatch[], at: number, count: number): Swatch[] {
  return pool.slice(at, at + count);
}

/**
 * A fresh draw from the whole named list. Elementals are separate; each hue
 * table is a random sample of that stem, then ordered around the wheel.
 * Two tables of the same stem do not repeat a color.
 */
export function drawStock(rng: () => number, slots: HueSlot[], pots: number): { elementals: Row; hues: Row[] } {
  const elementals: Swatch[] = [];
  const byStem: Swatch[][] = Array.from({ length: STEMS }, () => []);
  for (const swatch of swatches()) {
    if (swatch.elemental) elementals.push(swatch);
    else byStem[swatch.stem].push(swatch);
  }
  const potRow = shuffle(elementals, rng).slice(0, pots).sort(byWheel);
  const mid = Math.ceil(potRow.length / 2);
  const pools = byStem.map((bin) => shuffle(bin, rng));
  const cursor = Array<number>(STEMS).fill(0);
  const hues = slots.map((slot) => {
    const pool = pools[slot.stem];
    const picked = take(pool, cursor[slot.stem], slot.front + slot.back).sort(byWheel);
    cursor[slot.stem] += slot.front + slot.back;
    return {
      front: picked.slice(0, slot.front).map((swatch) => swatch.hex),
      back: picked.slice(slot.front).map((swatch) => swatch.hex),
    };
  });
  return {
    elementals: { front: potRow.slice(0, mid).map((swatch) => swatch.hex), back: potRow.slice(mid).map((swatch) => swatch.hex) },
    hues,
  };
}
