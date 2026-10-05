import { createBlood, createBody, stepBody, swallow, type Blood, type Body } from "./body";
import { eat, type Nutrition } from "./nutrition";

// Rats burn hotter than the player and clear a dose faster. A pour of food is a meal.
// A pour of anything else is a dose, and a small body feels it more.
export type RatNeeds = Nutrition;

export type RatProfile = {
  id: string;
  name: string;
  drain: { energy: number; protein: number; vitamins: number };
  doseScale: number;
  clearBoost: number;
  foodScale: number;
};

export const RAT_PROFILES: readonly RatProfile[] = [
  { id: "hood", name: "Hood", drain: { energy: 6.5, protein: 1.4, vitamins: 1.1 }, doseScale: 4, clearBoost: 0.22, foodScale: 0.65 },
  { id: "albino", name: "Albino", drain: { energy: 6.2, protein: 1.6, vitamins: 2.4 }, doseScale: 5, clearBoost: 0.18, foodScale: 0.65 },
  { id: "ink", name: "Ink", drain: { energy: 4.8, protein: 1.1, vitamins: 0.9 }, doseScale: 3.5, clearBoost: 0.3, foodScale: 0.65 },
  { id: "brindle", name: "Brindle", drain: { energy: 8.5, protein: 1.8, vitamins: 1.3 }, doseScale: 4.5, clearBoost: 0.2, foodScale: 0.65 },
];

const STARVE_HOLD = 45;

export type RatVitals = { body: Body; blood: Blood; needs: RatNeeds };

export function createRatNeeds(): RatNeeds {
  return { energy: 0.92, protein: 0.8, vitamins: 0.8, starve: 0 };
}

export function createRat(seed: number): RatVitals {
  return { body: createBody(seed), blood: createBlood(), needs: createRatNeeds() };
}

/** Drains the rat. True when an empty stomach has lasted long enough to kill. */
export function stepRatNeeds(needs: RatNeeds, drain: RatProfile["drain"], dt: number): boolean {
  needs.energy = Math.max(0, needs.energy - (drain.energy * dt) / 3600);
  needs.protein = Math.max(0, needs.protein - (drain.protein * dt) / 3600);
  needs.vitamins = Math.max(0, needs.vitamins - (drain.vitamins * dt) / 3600);
  if (needs.energy > 0) {
    needs.starve = 0;
    return false;
  }
  needs.starve += dt;
  return needs.starve >= STARVE_HOLD;
}

export function stepRat(rat: RatVitals, profile: RatProfile, dt: number) {
  if (!rat.body.alive) return;
  for (const dose of rat.blood.doses) dose.mass *= Math.exp(-profile.clearBoost * dt);
  stepBody(rat.body, rat.blood, dt);
  if (!rat.body.alive) return;
  if (stepRatNeeds(rat.needs, profile.drain, dt)) {
    rat.body.alive = false;
    rat.body.cause = "starvation";
  }
}

export function feedRat(rat: RatVitals, profile: RatProfile, gulp: { hex: string; mass: number; volume: number }) {
  if (!rat.body.alive || gulp.mass <= 1e-8) return;
  if (eat(rat.needs, gulp.hex, gulp.mass * profile.foodScale)) return;
  swallow(rat.blood, { hex: gulp.hex, mass: gulp.mass * profile.doseScale, volume: gulp.volume });
}

export type RatStatus = "dead" | "starving" | "ill" | "hungry" | "fed";

export function ratCondition(rat: RatVitals): RatStatus {
  if (!rat.body.alive) return "dead";
  if (rat.needs.energy <= 0.18 || rat.needs.starve > 0) return "starving";
  const ill = rat.body.organs.some((organ) => organ.integrity < 0.85 || Math.abs(organ.deflection) > 0.45);
  if (ill) return "ill";
  if (rat.needs.energy < 0.42 || rat.needs.protein < 0.3 || rat.needs.vitamins < 0.3) return "hungry";
  return "fed";
}
