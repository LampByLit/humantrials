import catalog from "../../concept/chems.json";
import { describe, expect, it } from "vitest";
import { litresText, moneyText } from "./format";
import { catalogPriced, priceOf } from "./prices";

describe("prices", () => {
  it("keeps water, milk, pures, and the catalog on fixed prices", () => {
    expect(priceOf("water")).toBe(4);
    expect(priceOf("milk")).toBe(4);
    expect(priceOf("#FFFFFF")).toBe(4);
    expect(priceOf("#FF0000")).toBe(99);
    expect(priceOf("#00FF00")).toBe(99);
    expect(priceOf("#0000FF")).toBe(99);
    expect(priceOf("#000000")).toBe(99);
    expect(priceOf("#6600FF")).toBe(1600);
    expect(priceOf("#A0705A")).toBe(8);
  });

  it("prices every catalog chemical", () => {
    for (const entry of catalog) expect(catalogPriced(entry.id)).toBe(true);
  });

  it("speaks money and litres", () => {
    expect(moneyText(1600)).toBe("$1,600");
    expect(moneyText(4)).toBe("$4");
    expect(litresText(1)).toBe("1 litre");
    expect(litresText(0.4)).toBe("400 millilitres");
  });
});
