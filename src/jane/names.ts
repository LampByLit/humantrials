import catalog from "../../concept/chems.json";
import { chemLabel, hexNamed } from "../sim/colorName";
import { foodHex } from "../sim/food";
import type { Fill } from "./prices";

const PURE: Record<string, string> = {
  red: "#FF0000",
  "pure red": "#FF0000",
  green: "#00FF00",
  "pure green": "#00FF00",
  blue: "#0000FF",
  "pure blue": "#0000FF",
  yellow: "#FFFF00",
  "pure yellow": "#FFFF00",
  cyan: "#00FFFF",
  "pure cyan": "#00FFFF",
  magenta: "#FF00FF",
  "pure magenta": "#FF00FF",
  black: "#000000",
  "pure black": "#000000",
};

const byCatalog = new Map<string, string>();
for (const entry of catalog) {
  byCatalog.set(entry.name.toLowerCase(), entry.hex.toUpperCase());
  byCatalog.set(entry.id.replace(/-/g, " "), entry.hex.toUpperCase());
}

export type ChemRef = { fill: Fill; name: string; hex: string | null };

export function readLitres(text: string): { litres: number | null; rest: string } {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(ml|millilit(?:re|er)s?|l|lit(?:re|er)s?)\b/i);
  if (!match || match.index === undefined) return { litres: null, rest: text };
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const litres = unit.startsWith("m") ? amount / 1000 : amount;
  const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
  return { litres, rest };
}

export function cleanQuery(text: string): string {
  let rest = text.replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const next = rest.replace(/^(of|some|please|the|a|an|me)\s+/i, "");
    if (next === rest) break;
    rest = next;
  }
  return rest.trim();
}

function asHex(query: string): string | null {
  const match = query.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  if (!query.startsWith("#") && !/\d/.test(match[1])) return null;
  return `#${match[1].toUpperCase()}`;
}

/** A chem the player named. White and the word water are their own fills. */
export function resolveChem(query: string): ChemRef | null {
  const cleaned = cleanQuery(query);
  if (!cleaned) return null;
  const key = cleaned.toLowerCase();
  if (key === "water" || key === "distilled water") return { fill: "water", name: "water", hex: null };
  if (key === "milk" || key === "white") return { fill: "milk", name: "milk", hex: "#FFFFFF" };
  if (key === "thy flesh" || key === "thy flesh consumed") {
    return { fill: 0x398514, name: "Thy Flesh Consumed", hex: "#398514" };
  }
  const pure = PURE[key];
  if (pure) {
    const hex = pure.toUpperCase();
    return { fill: parseInt(hex.slice(1), 16), name: chemLabel(hex), hex };
  }
  const found = asHex(cleaned) ?? byCatalog.get(key) ?? foodHex(key) ?? hexNamed(key);
  if (!found) return null;
  const hex = found.toUpperCase();
  if (hex === "#FFFFFF") return { fill: "milk", name: "milk", hex };
  return { fill: parseInt(hex.slice(1), 16), name: chemLabel(hex), hex };
}

export function orderBody(text: string): string | null {
  const patterns = [
    /^(?:please\s+)?(?:can i |could i |could you |would you )?(?:order|buy|purchase)\s+(.+)$/i,
    /^(?:please\s+)?(?:can you |could you |would you )?bring me\s+(.+)$/i,
    /^(?:please\s+)?(?:get me|sell me)\s+(.+)$/i,
    /^(?:please\s+)?i (?:want|need|would like|'d like|will take|'ll take)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = text.trim().match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function priceBody(text: string): string | null {
  const match = text
    .trim()
    .match(/^(?:please\s+)?(?:how much(?:\s+is|\s+for|\s+does)?|what(?:'s| is) the (?:price|cost)(?: of)?|price of|cost of)\s+(.+)$/i);
  return match ? match[1] : null;
}
