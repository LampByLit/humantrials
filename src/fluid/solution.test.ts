import { describe, expect, it } from "vitest";
import { milk, mixIn, solutionFromHex, STOCK_CONCENTRATION, toChem, visibleRgb, water } from "./solution";

function pour(into: number, from: number) {
  const beaker = solutionFromHex(into, 1, STOCK_CONCENTRATION);
  mixIn(beaker, solutionFromHex(from, 1, STOCK_CONCENTRATION));
  return visibleRgb(beaker);
}

describe("liquid color", () => {
  it("shows a stock as its hex", () => {
    const [r, g, b] = visibleRgb(solutionFromHex(0xff8800, 1, STOCK_CONCENTRATION));
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(0x88 / 255, 5);
    expect(b).toBeCloseTo(0, 5);
  });

  it("mixes red and blue into purple", () => {
    const [r, g, b] = pour(0xff0000, 0x0000ff);
    expect(r).toBeGreaterThan(0.35);
    expect(b).toBeGreaterThan(0.35);
    expect(Math.abs(r - b)).toBeLessThan(0.05);
    expect(g).toBeLessThan(r * 0.5);
  });

  it("mixes red and yellow into orange", () => {
    const [r, g, b] = pour(0xff0000, 0xffff00);
    expect(r).toBeGreaterThan(0.95);
    expect(g).toBeGreaterThan(0.35);
    expect(g).toBeLessThan(0.8);
    expect(b).toBeLessThan(0.2);
  });

  it("mixes blue and yellow into green", () => {
    const [r, g, b] = pour(0x2d6fdb, 0xe8c43a);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("lets water lighten a dye without changing the compound", () => {
    const beaker = solutionFromHex(0xff0000, 1, STOCK_CONCENTRATION);
    mixIn(beaker, water(1));
    expect(toChem(beaker).hex).toBe("#FF0000");
    const [r, g, b] = visibleRgb(beaker);
    expect(r).toBeGreaterThan(0.95);
    expect(g).toBeGreaterThan(0.3);
    expect(b).toBeGreaterThan(0.3);
    expect(g).toBeLessThan(0.7);
  });

  it("lets milk pull the mix toward white", () => {
    const beaker = solutionFromHex(0x0000ff, 1, STOCK_CONCENTRATION);
    mixIn(beaker, milk(1));
    const [r, g, b] = visibleRgb(beaker);
    expect(r).toBeGreaterThan(0.3);
    expect(g).toBeGreaterThan(0.3);
    expect(b).toBeGreaterThan(r);
    expect(beaker.cloud).toBe(1);
  });
});
