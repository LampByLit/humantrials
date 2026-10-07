import { colornames } from "color-name-list";
import { describe, expect, it } from "vitest";
import listed from "../../concept/chems.json";
import { analogOf } from "./analogs";
import { chemLabel } from "./colorName";
import { config } from "./config";
import { drawFood, FOOD_HEXES, foodFamilies, foodName, foodNutrients } from "./food";
import { createNutrition, eat, needSymptoms, stepNutrition, strainOf } from "./nutrition";
import { senseOf } from "./reactions";
import { createRng } from "./rng";

const squash = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

describe("food", () => {
  it("lists three foods in the catalog under the food category", () => {
    const foods = listed.filter((entry) => entry.category === "food");
    expect(foods.map((entry) => entry.hex).sort()).toEqual([...FOOD_HEXES].sort());
    expect(foods.map((entry) => entry.name)).toContain("Wormmeal");
  });

  it("names the eight nearest analogs of each food without reusing a catalog name", () => {
    const taken = new Set([...colornames.map((entry) => squash(entry.name)), ...listed.map((entry) => squash(entry.name))]);
    const seen = new Set<string>();
    for (const family of foodFamilies()) {
      expect(family.members).toHaveLength(9);
      for (const hex of family.members.slice(1)) {
        expect(analogOf(hex)?.parent).toBe(family.parent);
        const name = foodName(hex)!;
        expect(name).toBeTruthy();
        // Leaf and Dandelion are also color-list names. Saying them orders the food.
        const shared = squash(name) === "leaf" || squash(name) === "dandelion";
        expect(shared || !taken.has(squash(name))).toBe(true);
        expect(seen.has(name)).toBe(false);
        seen.add(name);
        expect(chemLabel(hex)).toBe(name);
      }
    }
    expect(seen.size).toBe(24);
  });

  it("feeds less from an analog than from the food itself", () => {
    const [worm] = FOOD_HEXES;
    const analog = foodFamilies()[0].members[1];
    expect(foodNutrients(analog)!.protein).toBeLessThan(foodNutrients(worm)!.protein);
    expect(foodNutrients("#FF9900")).toBeNull();
  });

  it("draws a different table per seed, three from each family", () => {
    const a = drawFood(createRng(1));
    const b = drawFood(createRng(2));
    expect(a).toHaveLength(9);
    expect(a).not.toEqual(b);
    foodFamilies().forEach((family, i) => {
      for (const hex of a.slice(i * 3, i * 3 + 3)) expect(family.members).toContain(hex);
    });
  });
});

describe("nutrition", () => {
  it("starts hungry and says so", () => {
    const nutrition = createNutrition();
    expect(needSymptoms(nutrition).map((symptom) => symptom.text)).toContain("hungry");
  });

  it("turns a full stomach hungry after about an hour", () => {
    const nutrition = { energy: 1, protein: 1, vitamins: 1, starve: 0 };
    for (let t = 0; t < 59 * 60; t++) stepNutrition(nutrition, 1);
    expect(nutrition.energy).toBeGreaterThan(config.nutrition.hungry);
    for (let t = 0; t < 2 * 60; t++) stepNutrition(nutrition, 1);
    expect(nutrition.energy).toBeLessThan(config.nutrition.hungry);
  });

  it("is fed by a beaker of food and not by a drug", () => {
    const nutrition = createNutrition();
    expect(eat(nutrition, "#FF9900", 2)).toBe(false);
    expect(eat(nutrition, "#7A1E2A", 2.3)).toBe(true);
    expect(nutrition.energy).toBeGreaterThan(1);
    expect(needSymptoms(nutrition).map((symptom) => symptom.text)).toContain("full");
  });

  it("weakens, slows and blurs a malnourished body", () => {
    const fed = senseOf([], [], true, strainOf({ energy: 0.8, protein: 0.8, vitamins: 0.8, starve: 0 }));
    const starved = senseOf([], [], true, strainOf({ energy: 0, protein: 0, vitamins: 0, starve: 0 }));
    expect(fed.move).toBe(1);
    expect(starved.move).toBeLessThan(0.4);
    expect(starved.move).toBeGreaterThan(0);
    expect(starved.operate).toBeLessThan(fed.operate);
    expect(starved.operate).toBeGreaterThan(0.12);
    expect(starved.blur).toBeGreaterThan(0.3);
    const texts = needSymptoms({ energy: 0, protein: 0, vitamins: 0, starve: 0 }).map((symptom) => symptom.band);
    expect(texts).toEqual(["severe", "severe", "severe"]);
  });

  it("kills once an empty stomach has lasted, and a sip calls it off", () => {
    const nutrition = { energy: 0, protein: 1, vitamins: 1, starve: 0 };
    expect(stepNutrition(nutrition, config.nutrition.starveHold - 0.1)).toBe(false);
    expect(stepNutrition(nutrition, 0.2)).toBe(true);
    const saved = { energy: 0, protein: 1, vitamins: 1, starve: config.nutrition.starveHold };
    eat(saved, "#7A1E2A", 0.2);
    expect(stepNutrition(saved, 0.1)).toBe(false);
    expect(saved.starve).toBe(0);
  });
});
