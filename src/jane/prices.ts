import catalog from "../../concept/chems.json";
import { derive } from "../sim/compound";
import { isElemental } from "../sim/recipe";

// Water and milk are the cheap end of the book. Pure channel colors and anything
// the demixer cannot split are a flat $99, because the lab cannot mix its way
// there. Catalog drugs keep one price forever. Green pays well over that for a
// stocktail litre, so Jane never sells stocktails. Everything else is priced by
// hue: violets and purples cost more, mints and limes less.
const BOOK: Record<string, number> = {
  caffeine: 24,
  acetaminophen: 20,
  fentanyl: 1600,
  sugar: 6,
  lsd: 280,
  dmt: 260,
  cocaine: 140,
  "vitamin-c": 14,
  "vitamin-b12": 14,
  "vitamin-d": 14,
  amphetamine: 70,
  methamphetamine: 110,
  nicotine: 22,
  methylphenidate: 48,
  modafinil: 40,
  theobromine: 18,
  alcohol: 12,
  diazepam: 45,
  phenobarbital: 55,
  ghb: 60,
  propofol: 200,
  diphenhydramine: 22,
  melatonin: 18,
  adrenaline: 90,
  mdma: 120,
  pseudoephedrine: 28,
  morphine: 180,
  heroin: 340,
  oxycodone: 220,
  codeine: 75,
  aspirin: 16,
  ibuprofen: 16,
  ketamine: 160,
  lidocaine: 32,
  naloxone: 80,
  propranolol: 34,
  clonidine: 40,
  ipecac: 18,
  senna: 16,
  aflatoxin: 150,
  bergamottin: 30,
  salt: 5,
  starch: 5,
  chalk: 5,
  ether: 28,
  nitrous: 30,
  capsaicin: 26,
  strychnine: 240,
  ephedrine: 36,
  wormmeal: 8,
  kelpmash: 8,
  beetmash: 8,
};

const POCKET = [42, 30, 24, 18, 22, 16, 26, 28, 36, 52, 58, 34];

const byHex = new Map(catalog.map((entry) => [entry.hex.toUpperCase(), entry.id]));

export type Fill = "water" | "milk" | number;

function isPure(hex: string): boolean {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return false;
  const bytes = [0, 2, 4].map((at) => parseInt(raw.slice(at, at + 2), 16));
  if (bytes.every((byte) => byte === 255)) return false;
  return bytes.every((byte) => byte === 0 || byte === 255);
}

function huePrice(hex: string): number {
  const compound = derive(hex);
  const stem = Math.floor(((compound.hue + 15) % 360) / 30) % 12;
  let price = POCKET[stem] * (0.65 + compound.potency);
  if (compound.purity < 0.35) price *= 0.55;
  return Math.max(6, Math.round(price));
}

/** Dollars per litre. `water` and `milk` are the words; anything else is a `#RRGGBB`. */
export function priceOf(kind: string): number {
  if (kind === "water" || kind === "milk") return 4;
  const hex = kind.toUpperCase();
  if (hex === "#FFFFFF") return 4;
  const id = byHex.get(hex);
  if (id === "milk") return 4;
  if (id && BOOK[id] !== undefined) return BOOK[id];
  if (isPure(hex) || isElemental(hex)) return 99;
  return huePrice(hex);
}

export function greenPriceOf(hex: string): number {
  return Math.max(200, priceOf(hex) * 3);
}

export function priceOfFill(fill: Fill): number {
  if (fill === "water") return 4;
  if (fill === "milk") return 4;
  return priceOf(`#${(fill & 0xffffff).toString(16).padStart(6, "0")}`);
}

export function catalogPriced(id: string): boolean {
  return id === "milk" || BOOK[id] !== undefined;
}
