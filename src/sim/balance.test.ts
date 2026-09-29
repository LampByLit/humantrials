import { describe, expect, it } from "vitest";
import { analyzeBalance } from "./balance";
import { bodyRank, createBody } from "./body";
import { config } from "./config";

const publishedFixture = [0, 60, 90, 120, 150];

describe("balance harness", () => {
  it("matches the published narrow-tuning measurement", () => {
    const report = analyzeBalance(publishedFixture, config.tuning.k);
    expect(report.rank).toBe(publishedFixture.length);
    expect(report.bestSelectivity).toHaveLength(publishedFixture.length);
    for (const selectivity of report.bestSelectivity) {
      const reported = Math.round(selectivity * 10) / 10;
      expect(selectivity).toBeGreaterThanOrEqual(config.balance.cleanRatio);
      expect(reported).toBeGreaterThanOrEqual(2.2);
      expect(reported).toBeLessThanOrEqual(4.7);
    }
    expect(report.broadShare).toBeLessThanOrEqual(0.1);
    expect(report.inertShare).toBeLessThanOrEqual(0.25);
    expect(report.crowdedPairs).toEqual([]);
  });

  it("clears the clean-coverage rule of thumb for three evenly spaced organs", () => {
    const report = analyzeBalance([0, 120, 240], config.tuning.k);
    expect(report.rank).toBe(3);
    expect(report.cleanCoverage).toBeGreaterThanOrEqual(0.5);
    expect(report.broadShare).toBeLessThanOrEqual(0.1);
    expect(report.inertShare).toBeLessThanOrEqual(0.25);
    expect(report.crowdedPairs).toEqual([]);
  });

  it("gives the three-organ body a response rank equal to its organ count", () => {
    for (const seed of [1, 2, 7, 42]) {
      const body = createBody(seed);
      expect(bodyRank(body)).toBe(body.organs.length);
    }
  });
});
