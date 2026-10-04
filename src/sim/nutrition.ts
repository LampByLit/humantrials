import type { SymptomBand } from "./body";
import { config } from "./config";
import { foodNutrients, type Nutrients } from "./food";
import type { Strain } from "./reactions";

export type Nutrition = Nutrients & { starve: number };

export type NeedSymptom = { direction: "up" | "down"; band: SymptomBand; text: string };

const KEYS = ["energy", "protein", "vitamins"] as const;

export function createNutrition(): Nutrition {
  return { ...config.nutrition.start, starve: 0 };
}

/** Drains the body and reports when an empty stomach has lasted long enough to kill. */
export function stepNutrition(nutrition: Nutrition, dt: number): boolean {
  for (const key of KEYS) {
    nutrition[key] = Math.max(0, nutrition[key] - (config.nutrition.drainPerHour[key] * dt) / 3600);
  }
  if (nutrition.energy > 0) {
    nutrition.starve = 0;
    return false;
  }
  nutrition.starve += dt;
  return nutrition.starve >= config.nutrition.starveHold;
}

/** Feeds the body if the swallowed hex is food. Returns false for anything else. */
export function eat(nutrition: Nutrition, hex: string, mass: number): boolean {
  const value = foodNutrients(hex);
  if (!value) return false;
  for (const key of KEYS) nutrition[key] = Math.min(config.nutrition.cap, nutrition[key] + value[key] * Math.max(0, mass));
  return true;
}

// 0 at the threshold, 1 at empty.
function deficit(level: number, threshold: number) {
  return Math.min(1, Math.max(0, (threshold - level) / threshold));
}

export function needSymptoms(nutrition: Nutrition): NeedSymptom[] {
  const { full, hungry, starving, deficient } = config.nutrition;
  const out: NeedSymptom[] = [];
  const { energy, protein, vitamins } = nutrition;
  if (energy <= 0.02) out.push({ direction: "down", band: "severe", text: "starving; faint and shaking" });
  else if (energy < starving) out.push({ direction: "down", band: "moderate", text: "starving, weak, shaky" });
  else if (energy < hungry) out.push({ direction: "down", band: "mild", text: "hungry" });
  else if (energy > full) out.push({ direction: "up", band: "mild", text: "full" });
  const lack = (level: number, mild: string, moderate: string, severe: string) => {
    const d = deficit(level, deficient);
    if (d <= 0) return;
    if (d > 0.66) out.push({ direction: "down", band: "severe", text: severe });
    else if (d > 0.33) out.push({ direction: "down", band: "moderate", text: moderate });
    else out.push({ direction: "down", band: "mild", text: mild });
  };
  lack(protein, "weak grip", "muscles weak, wasting", "muscles wasting; arms give out");
  lack(vitamins, "pale, tired eyes", "pale, dizzy, poor sight", "scurvy; vision failing");
  return out;
}

/** Malnutrition's pull on the body, before saturation in senseOf. */
export function strainOf(nutrition: Nutrition): Strain {
  const hunger = deficit(nutrition.energy, config.nutrition.starving);
  const protein = deficit(nutrition.protein, config.nutrition.deficient);
  const vitamins = deficit(nutrition.vitamins, config.nutrition.deficient);
  return {
    slow: hunger * 0.7 + protein * 0.9,
    shake: hunger * 0.35,
    vignette: hunger * 0.6,
    numb: protein * 0.6,
    blur: vitamins * 0.7,
    sway: vitamins * 0.5,
    pale: vitamins * 0.8 + hunger * 0.4,
  };
}
