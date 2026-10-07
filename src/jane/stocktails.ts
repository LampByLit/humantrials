import catalog from "../../concept/chems.json";

// Mixable catalog chemicals. Each has every channel above zero, so the demixer
// can split it, and the catalog bench keeps a sample every game. Green buys
// one litre of one of these at a time.
const STOCKTAIL_IDS = [
  "sugar",
  "vitamin-c",
  "nicotine",
  "alcohol",
  "melatonin",
  "mdma",
  "senna",
  "aflatoxin",
  "bergamottin",
] as const;

export type Stocktail = { id: string; name: string; hex: string };

const byId = new Map(catalog.map((entry) => [entry.id, entry]));

export function stocktails(): Stocktail[] {
  return STOCKTAIL_IDS.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`missing stocktail ${id}`);
    return { id, name: entry.name, hex: entry.hex.toUpperCase() };
  });
}

export function isStocktail(hex: string): boolean {
  return stocktails().some((item) => item.hex === hex.toUpperCase());
}

export function pickStocktail(rng: () => number, avoid: string): Stocktail {
  const pool = stocktails().filter((item) => item.hex !== avoid.toUpperCase());
  return pool[Math.floor(rng() * pool.length)] ?? stocktails()[0];
}
