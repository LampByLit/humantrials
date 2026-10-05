import { describe, expect, it } from "vitest";
import { RAT_PROFILES, createRat, feedRat, ratCondition, stepRat, stepRatNeeds } from "./rat";

describe("rats", () => {
  it("gets hungry faster than a person and dies after an empty stomach", () => {
    const hood = RAT_PROFILES[0];
    const needs = createRat(1).needs;
    expect(stepRatNeeds(needs, hood.drain, 30)).toBe(false);
    expect(needs.energy).toBeLessThan(0.92);
    expect(needs.energy).toBeGreaterThan(0.8);
    const starved = createRat(1).needs;
    expect(stepRatNeeds(starved, hood.drain, 700)).toBe(true);
  });

  it("eats food and takes other pours as a dose", () => {
    const hood = RAT_PROFILES[0];
    const rat = createRat(3);
    feedRat(rat, hood, { hex: "#7A1E2A", mass: 2, volume: 0.0002 });
    expect(rat.needs.energy).toBeGreaterThan(0.92);
    expect(rat.blood.pending).toHaveLength(0);
    feedRat(rat, hood, { hex: "#6600FF", mass: 0.2, volume: 0.00002 });
    expect(rat.blood.pending).toHaveLength(1);
    expect(ratCondition(rat)).not.toBe("dead");
  });

  it("starves when the sim is left alone", () => {
    const brindle = RAT_PROFILES[3];
    const rat = createRat(4);
    stepRat(rat, brindle, 800);
    expect(rat.body.alive).toBe(false);
    expect(rat.body.cause).toBe("starvation");
    expect(ratCondition(rat)).toBe("dead");
  });
});