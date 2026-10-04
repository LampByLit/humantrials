import { colornames } from "color-name-list/bestof";
import catalog from "../../concept/chems.json";

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
const drugName = new Map(catalog.map((entry) => [entry.hex.toUpperCase(), entry.name]));

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

/** The common name of a catalog drug, otherwise the nearest color name. */
export function chemLabel(hex: string): string {
  const key = hex.toUpperCase();
  return drugName.get(key) ?? colorName(key);
}

/** Snap a shelf color onto an exact named hexchem. */
export function namedColor(hex: number): number {
  const text = `#${(hex & 0xffffff).toString(16).padStart(6, "0")}`.toUpperCase();
  return parseInt(nearest(text).hex.slice(1), 16);
}
