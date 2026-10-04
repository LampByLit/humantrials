import { describe, expect, it } from "vitest";
import { complement, derive, dilute, draw, mix, refine, solution, water } from "./compound";
import { noise } from "./effect";

describe("hex compounds", () => {
  it("derives primaries and secondaries at full potency", () => {
    expect(derive("#FF0000").hue).toBeCloseTo(0, 8);
    expect(derive("#FFFF00").hue).toBeCloseTo(60, 8);
    expect(derive("#00FF00").hue).toBeCloseTo(120, 8);
    expect(derive("#00FFFF").hue).toBeCloseTo(180, 8);
    expect(derive("#0000FF").hue).toBeCloseTo(240, 8);
    expect(derive("#FF00FF").hue).toBeCloseTo(300, 8);
    for (const hex of ["#FF0000", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#FF00FF"]) {
      expect(derive(hex).potency).toBeCloseTo(1, 8);
      expect(derive(hex).purity).toBeCloseTo(1, 8);
    }
  });

  it("gives gray, white, and black zero potency", () => {
    for (const hex of ["#808080", "#FFFFFF", "#000000"]) {
      const compound = derive(hex);
      expect(compound.potency).toBe(0);
      expect(compound.purity).toBe(0);
    }
  });

  it("canonicalizes hex case", () => {
    expect(solution("#ff00aa", 1, 1).hex).toBe("#FF00AA");
  });

  it("rejects a hex that is not #RRGGBB", () => {
    expect(() => derive("#FFF")).toThrow(/invalid hex/);
    expect(() => solution("#GG0000", 1, 1)).toThrow(/invalid hex/);
  });

  it("rejects a non-positive volume", () => {
    expect(() => solution("#FF0000", 1, 0)).toThrow(/volume/);
  });
});

describe("complement and mix", () => {
  it("negates the color plane and keeps purity", () => {
    const compound = derive("#C04080");
    const flipped = derive(complement(compound.hex));
    expect(flipped.x).toBeCloseTo(-compound.x, 8);
    expect(flipped.y).toBeCloseTo(-compound.y, 8);
    expect(flipped.purity).toBeCloseTo(compound.purity, 8);
    expect(flipped.potency).toBeCloseTo(compound.potency, 8);
  });

  it("mixes a saturated compound with its complement into a dark gray with zero potency", () => {
    const red = solution("#FF0000", 2, 1);
    const mixed = mix(red, solution(complement(red.hex), 2, 1));
    const compound = derive(mixed.hex);
    expect(compound.potency).toBe(0);
    expect(compound.r).toBeLessThan(0.25);
    expect(mixed.mass).toBe(4);
    expect(mixed.volume).toBe(2);
  });

  it("mixes like dyes: blue and yellow make green", () => {
    const mixed = derive(mix(solution("#2D6FDB", 1, 1), solution("#E8C43A", 1, 1)).hex);
    expect(mixed.hue).toBeGreaterThan(90);
    expect(mixed.hue).toBeLessThan(150);
    expect(mixed.g).toBeGreaterThan(mixed.r);
    expect(mixed.g).toBeGreaterThan(mixed.b);
  });

  it("mixes equal red and green into a weaker, darker yellow", () => {
    const mixed = derive(mix(solution("#FF0000", 1, 1), solution("#00FF00", 1, 1)).hex);
    expect(mixed.hue).toBeCloseTo(60, 5);
    expect(mixed.potency).toBeLessThan(1);
  });

  it("weights by mass and does not care how a pour is split", () => {
    const blue = solution("#2D6FDB", 3, 1);
    const yellow = solution("#E8C43A", 1, 1);
    const whole = mix(blue, yellow);
    const halves = mix(mix(blue, solution("#E8C43A", 0.5, 0.5)), solution("#E8C43A", 0.5, 0.5));
    for (const channel of ["r", "g", "b"] as const) {
      expect(derive(halves.hex)[channel]).toBeCloseTo(derive(whole.hex)[channel], 2);
    }
    expect(derive(whole.hex).b).toBeGreaterThan(derive(mix(solution("#2D6FDB", 1, 1), yellow).hex).b);
  });

  it("does not let a trace of black or a zero channel wipe out a mix", () => {
    const tinted = derive(mix(solution("#E8C43A", 99, 1), solution("#000000", 1, 1)).hex);
    expect(tinted.r).toBeGreaterThan(0.8);
    const magenta = derive(mix(solution("#00FF00", 99, 1), solution("#FF00FF", 1, 1)).hex);
    expect(magenta.g).toBeGreaterThan(0.9);
  });

  it("leaves a single ingredient's hex exact", () => {
    expect(mix(solution("#FF00FF", 2, 1), solution("#00FF00", 0, 1)).hex).toBe("#FF00FF");
  });
});

describe("refine, dilute, and draw", () => {
  it("preserves total drive, reduces noise, and rejects gray", () => {
    const muddy = solution("#FF8080", 2, 1);
    const before = derive(muddy.hex);
    const refined = refine(muddy);
    const after = derive(refined.hex);
    expect(refined.hex).toBe("#FF0000");
    expect(after.potency * refined.mass).toBeCloseTo(before.potency * muddy.mass, 8);
    expect(noise(after, refined.mass)).toBeLessThan(noise(before, muddy.mass));
    expect(refined.volume).toBe(muddy.volume);
    expect(() => refine(solution("#808080", 1, 1))).toThrow(/gray/);
    expect(() => refine(solution("#FFFFFF", 1, 1))).toThrow(/gray/);
    expect(() => refine(solution("#000000", 1, 1))).toThrow(/gray/);
  });

  it("dilutes with water without changing the hex or the solute mass", () => {
    const diluted = dilute(solution("#00FF00", 3, 2), water(5), 4);
    expect(diluted.solution).toEqual({ hex: "#00FF00", mass: 3, volume: 6 });
    expect(diluted.water).toEqual({ volume: 1 });
    expect(diluted.solution.mass / diluted.solution.volume).toBeCloseTo(0.5, 8);
    const drawn = draw(diluted.solution, 1);
    expect(drawn.mass).toBeCloseTo(0.5, 8);
    expect(() => dilute(solution("#00FF00", 3, 2), water(1), 4)).toThrow(/water/);
    expect(() => water(-1)).toThrow(/water/);
  });

  it("draws a dose mass from the volume", () => {
    const drawn = draw(solution("#0000FF", 10, 5), 1);
    expect(drawn.mass).toBe(2);
    expect(drawn.solution).toEqual({ hex: "#0000FF", mass: 8, volume: 4 });
    expect(() => draw(solution("#0000FF", 10, 5), 6)).toThrow(/draw/);
  });
});
