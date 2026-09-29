import { describe, expect, it } from "vitest";
import { complement, derive, mix, solution } from "./compound";
import { drive, noise, tuning } from "./effect";

const organ = (theta: number) => ({ theta, k: 6 });

describe("drive and noise", () => {
  it("flips sign when the compound is replaced by its complement", () => {
    const compound = derive("#FF0000");
    const flipped = derive(complement(compound.hex));
    const heart = organ(20);
    const forward = drive(compound, heart, 1.5);
    expect(forward).not.toBe(0);
    expect(drive(flipped, heart, 1.5)).toBeCloseTo(-forward, 8);
    expect(tuning(flipped.hue, heart.theta, heart.k)).toBeCloseTo(-tuning(compound.hue, heart.theta, heart.k), 8);
  });

  it("gives zero drive and zero noise for zero mass and for zero potency", () => {
    const red = derive("#FF0000");
    const heart = organ(0);
    expect(drive(red, heart, 0)).toBe(0);
    expect(noise(red, 0)).toBe(0);
    for (const hex of ["#808080", "#FFFFFF", "#000000"]) {
      const compound = derive(hex);
      expect(drive(compound, heart, 4)).toBe(0);
      expect(noise(compound, 4)).toBe(0);
    }
  });

  it("does not treat a red-green mix as co-dosing the two hues", () => {
    const mixed = derive(mix(solution("#FF0000", 1, 1), solution("#00FF00", 1, 1)).hex);
    const red = derive("#FF0000");
    const green = derive("#00FF00");
    const organs = [organ(0), organ(120), organ(60)];
    const mixedDrive = organs.map((item) => drive(mixed, item, 2));
    const coDose = organs.map((item) => drive(red, item, 1) + drive(green, item, 1));
    expect(mixed.hue).toBeCloseTo(60, 5);
    expect(mixedDrive[2]).toBeGreaterThan(mixedDrive[0]);
    expect(mixedDrive[2]).toBeGreaterThan(mixedDrive[1]);
    expect(coDose[0]).toBeGreaterThan(coDose[2]);
    expect(coDose[1]).toBeGreaterThan(coDose[2]);
    for (let index = 0; index < organs.length; index++) {
      expect(mixedDrive[index]).not.toBeCloseTo(coDose[index], 1);
    }
  });

  it("gives about zero drive on every organ after a complement mix", () => {
    const mixed = derive(mix(solution("#C04080", 1, 1), solution(complement("#C04080"), 1, 1)).hex);
    for (const theta of [0, 60, 90, 120, 150]) {
      expect(Math.abs(drive(mixed, organ(theta), 2))).toBeLessThan(1e-6);
    }
    expect(mixed.potency).toBeLessThan(1e-6);
  });
});
