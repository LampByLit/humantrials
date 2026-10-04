import { describe, expect, it } from "vitest";
import { mixIn, solutionFromHex, STOCK_CONCENTRATION, toChem } from "../fluid/solution";
import { createRng } from "./rng";
import { isElemental, threeParts, twoParts } from "./recipe";

function pour(hexes: string[]) {
  const [first, ...rest] = hexes.map((hex) => solutionFromHex(parseInt(hex.slice(1), 16), 1e-5, STOCK_CONCENTRATION));
  for (const part of rest) mixIn(first, part);
  return toChem(first).hex;
}

describe("recipes", () => {
  it("mixes back to the target in equal parts", () => {
    const rng = createRng(5);
    for (let i = 0; i < 200; i++) {
      const bytes = [0, 1, 2].map(() => 8 + Math.floor(rng() * 247));
      const hex = `#${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
      const two = twoParts(hex);
      const three = threeParts(hex);
      expect(two).not.toBeNull();
      expect(three).not.toBeNull();
      expect(pour(two!)).toBe(hex);
      expect(pour(three!)).toBe(hex);
      expect(new Set(three).size).toBe(3);
    }
  });

  it("splits a gray into white and a darker gray", () => {
    expect(twoParts("#808080")).toEqual(["#FFFFFF", "#404040"]);
  });

  it("calls white, black, and anything with a channel under the floor elemental", () => {
    for (const hex of ["#FFFFFF", "#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#2A0055"]) {
      expect(isElemental(hex)).toBe(true);
      expect(threeParts(hex)).toBeNull();
    }
    expect(isElemental("#FFFFFE")).toBe(false);
    expect(isElemental("#2A2A55")).toBe(false);
  });
});
