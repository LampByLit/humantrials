import { describe, expect, it } from "vitest";
import { mixIn, solutionFromHex, STOCK_CONCENTRATION, water } from "./solution";
import { substanceReadout } from "./readout";

const TEN_ML = 1e-5;

describe("analyzer readout", () => {
  it("lists the compound measures and the liquid properties of a stock", () => {
    const read = substanceReadout(solutionFromHex(0xff0000, TEN_ML, STOCK_CONCENTRATION));
    expect(read.hex).toBe("#FF0000");
    expect(read.latin).toBe("albus merus ruber");
    expect(read.solute).toEqual([
      { label: "hue", value: "0.0°" },
      { label: "potency", value: "1.000" },
      { label: "purity", value: "1.000" },
      { label: "gray", value: "0.000" },
      { label: "x", value: "1.000" },
      { label: "y", value: "0.000" },
      { label: "r", value: "1.000" },
      { label: "g", value: "0.000" },
      { label: "b", value: "0.000" },
    ]);
    expect(read.liquid).toEqual([
      { label: "mass", value: "0.100" },
      { label: "vol", value: "10.00 mL" },
      { label: "conc", value: "10.00 /L" },
      { label: "stock", value: "1.00×" },
      { label: "cloud", value: "0%" },
    ]);
  });

  it("keeps the hex and halves the concentration when water is added", () => {
    const sample = solutionFromHex(0xff0000, TEN_ML, STOCK_CONCENTRATION);
    mixIn(sample, water(TEN_ML));
    const read = substanceReadout(sample);
    expect(read.hex).toBe("#FF0000");
    expect(read.liquid.find((spec) => spec.label === "conc")?.value).toBe("5.00 /L");
    expect(read.liquid.find((spec) => spec.label === "stock")?.value).toBe("0.50×");
    expect(read.liquid.find((spec) => spec.label === "vol")?.value).toBe("20.00 mL");
    expect(read.liquid.find((spec) => spec.label === "mass")?.value).toBe("0.100");
  });

  it("reads water as a liquid with no compound", () => {
    const read = substanceReadout(water(TEN_ML));
    expect(read.title).toBe("water");
    expect(read.hex).toBe("—");
    expect(read.solute.every((spec) => spec.value === "—")).toBe(true);
    expect(read.liquid).toEqual([
      { label: "mass", value: "0.000" },
      { label: "vol", value: "10.00 mL" },
      { label: "conc", value: "0.00 /L" },
      { label: "stock", value: "0.00×" },
      { label: "cloud", value: "0%" },
    ]);
  });

  it("reports milk as fully cloudy", () => {
    const read = substanceReadout({ ...solutionFromHex(0xffffff, TEN_ML, STOCK_CONCENTRATION), cloud: TEN_ML });
    expect(read.title).toBe("Milk");
    expect(read.liquid.find((spec) => spec.label === "cloud")?.value).toBe("100%");
  });
});
