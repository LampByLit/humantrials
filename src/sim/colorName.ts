import { colornames } from "color-name-list/bestof";
import catalog from "../../concept/chems.json";
import { derive } from "./compound";
import { foodName } from "./food";

// The stocked hexchems are the best-of names from https://github.com/meodai/color-names.
// A mix that is not an exact entry still takes the nearest name.

type Named = {
  name: string;
  hex: string;
  r: number;
  g: number;
  b: number;
};

const named: Named[] = colornames.map((entry) => {
  const hex = entry.hex.toUpperCase();
  return {
    name: entry.name,
    hex,
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
});

const byHex = new Map(named.map((entry) => [entry.hex, entry]));
const byName = new Map<string, string>();
for (const entry of named) {
  const key = entry.name.toLowerCase();
  if (!byName.has(key)) byName.set(key, entry.hex);
}

// A blue-counter material that is not in the public color list.
const PROPER = new Map<string, string>([["#398514", "Thy Flesh Consumed"]]);
const drugName = new Map(catalog.map((entry) => [entry.hex.toUpperCase(), entry.name]));
const drugLatin = new Map(catalog.map((entry) => [entry.hex.toUpperCase(), entry.latin]));

function nearest(hex: string): Named {
  const exact = byHex.get(hex);
  if (exact) return exact;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let best = named[0];
  let bestDistance = Infinity;
  for (const entry of named) {
    const dr = entry.r - r;
    const dg = entry.g - g;
    const db = entry.b - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

export function colorName(hex: string): string {
  return nearest(hex.toUpperCase()).name;
}

/** Catalog name, a proper order name, a named food analog, or the exact color-list name. */
export function chemLabel(hex: string): string {
  const key = hex.toUpperCase();
  return PROPER.get(key) ?? drugName.get(key) ?? foodName(key) ?? byHex.get(key)?.name ?? key;
}

/** Exact color-list hex for a name, or null. */
export function hexNamed(name: string): string | null {
  return byName.get(name.trim().toLowerCase()) ?? null;
}

export function isCatalog(hex: string): boolean {
  return drugName.has(hex.toUpperCase());
}

/** Latin catalog name, an exact color name, or the hex itself. */
export function nomenclature(hex: string): string {
  const key = hex.toUpperCase();
  return drugLatin.get(key) ?? byHex.get(key)?.name ?? key;
}

/** Snap a shelf color onto an exact named hexchem. */
export function namedColor(hex: number): number {
  const text = `#${(hex & 0xffffff).toString(16).padStart(6, "0")}`.toUpperCase();
  return parseInt(nearest(text).hex.slice(1), 16);
}

const STEMS = ["ruber", "aurantius", "flavus", "chlorus", "viridis", "prasinus", "cyaneus", "caeruleus", "indicus", "violaceus", "purpureus", "roseus"];

// concept/chems-health.md 2.5. Light, then chroma, then a 30° hue stem.
export function latinName(hex: string): string {
  const compound = derive(hex);
  const max = Math.max(compound.r, compound.g, compound.b);
  const light =
    max < 0.15 ? "negra" : max < 0.35 ? "fuscus" : max < 0.55 ? "satur" : max < 0.75 ? "clarus" : max < 0.9 ? "pallidus" : "albus";
  if (compound.purity < 0.12) return `${light} vanus`;
  const chroma = compound.purity < 0.55 ? "spurius" : "merus";
  const stem = STEMS[Math.floor((compound.hue + 15) / 30) % 12];
  return `${light} ${chroma} ${stem}`;
}
