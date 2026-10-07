import { analogOf, analogsOf } from "./analogs";

export type Nutrients = { energy: number; protein: number; vitamins: number };

type Food = { hex: string; nutrients: Nutrients; analogs: readonly string[] };

// Nutrients per unit of solute mass. A 10mL stock sip is 0.1 mass, so a medium beaker of a
// food (about 2.3) restores its main nutrient from empty. The eight nearest analogs of each
// food carry their own names. Leaf and Dandelion also name colors; the food hex wins when you say them.
const FOODS: readonly Food[] = [
  {
    hex: "#A0705A",
    nutrients: { energy: 0.15, protein: 0.45, vitamins: 0.03 },
    analogs: ["Grubs", "Loamcake", "Siltgrubs", "Bug Paste", "Burrowmash", "Rootworm", "Mudlarva", "Clodmeal"],
  },
  {
    hex: "#2E5E3A",
    nutrients: { energy: 0.08, protein: 0.06, vitamins: 0.45 },
    analogs: ["Wrackpulp", "Tidecress", "Saltfrond", "Brinecurd", "Driftleaf", "Shoalweed", "Deepwrack", "Kelps"],
  },
  {
    hex: "#7A1E2A",
    nutrients: { energy: 0.45, protein: 0.03, vitamins: 0.05 },
    analogs: ["Tuberclot", "Leaf", "Cellarbeet", "Mangelmash", "Rootclot", "Sugarknob", "Gristbeet", "Dandelion"],
  },
];

export const FOOD_HEXES = FOODS.map((food) => food.hex);

const byHex = new Map(FOODS.map((food) => [food.hex, food]));

function nearestAnalogs(parent: string, count: number): string[] {
  return analogsOf(parent)
    .slice()
    .sort((a, b) => a.dr * a.dr + a.dg * a.dg + a.db * a.db - (b.dr * b.dr + b.dg * b.dg + b.db * b.db) || (a.hex < b.hex ? -1 : 1))
    .slice(0, count)
    .map((analog) => analog.hex);
}

const families = FOODS.map((food) => ({ parent: food.hex, members: [food.hex, ...nearestAnalogs(food.hex, food.analogs.length)] }));

const names = new Map<string, string>();
FOODS.forEach((food, index) => {
  families[index].members.slice(1).forEach((hex, i) => names.set(hex, food.analogs[i]));
});

/** The name of a named food analog. Catalog foods are named in concept/chems.json. */
export function foodName(hex: string): string | null {
  return names.get(hex.toUpperCase()) ?? null;
}

/** Hex of a named food analog such as Grubs. */
export function foodHex(name: string): string | null {
  const key = name.trim().toLowerCase();
  for (const [hex, label] of names) if (label.toLowerCase() === key) return hex;
  return null;
}

/** Each food and its eight named analogs. */
export function foodFamilies(): readonly { parent: string; members: readonly string[] }[] {
  return families;
}

/** Nutrients per unit mass, or null for anything that is not food. Analogs feed less. */
export function foodNutrients(hex: string): Nutrients | null {
  const key = hex.toUpperCase();
  const exact = byHex.get(key);
  if (exact) return exact.nutrients;
  const analog = analogOf(key);
  const parent = analog ? byHex.get(analog.parent) : undefined;
  if (!analog || !parent) return null;
  const n = parent.nutrients;
  return { energy: n.energy * analog.scale, protein: n.protein * analog.scale, vitamins: n.vitamins * analog.scale };
}

/** A game's food table: `perFamily` random picks from each food and its named analogs. */
export function drawFood(rng: () => number, perFamily = 3): string[] {
  const out: string[] = [];
  for (const family of families) {
    const pool = family.members.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.push(...pool.slice(0, perFamily));
  }
  return out;
}
