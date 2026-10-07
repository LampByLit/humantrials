import { describe, expect, it } from "vitest";
import { analogsOf } from "../sim/analogs";
import { isElemental } from "../sim/recipe";
import { acceptReward, createLedger, MASS_PER_LITRE, submitSamples, tryOrder } from "./ledger";
import { priceOf } from "./prices";
import { stocktails } from "./stocktails";

describe("ledger", () => {
  it("opens on a stocktail and rolls another after a shelf litre", () => {
    const ledger = createLedger(1);
    const opening = ledger.green.hex;
    expect(stocktails().some((item) => item.hex === opening)).toBe(true);
    for (const item of stocktails()) expect(isElemental(item.hex)).toBe(false);
    const price = priceOf(opening);
    const result = submitSamples(ledger, "green", [{ hex: opening, mass: MASS_PER_LITRE, volume: 0.001 }]);
    expect(result.pay).toBe(price);
    expect(ledger.credits).toBe(500 + price);
    expect(ledger.green.generation).toBe(1);
    expect(ledger.green.hex).not.toBe(opening);
    expect(stocktails().some((item) => item.hex === ledger.green.hex)).toBe(true);
    expect(ledger.green.reason.length).toBeGreaterThan(20);
    expect(result.line).toContain(ledger.green.name);
    expect(result.line.toLowerCase()).toContain("closes the sale");
  });

  it("pays a stocktail analog on a scale and leaves the order open", () => {
    const ledger = createLedger(2);
    const price = ledger.green.pricePerLitre;
    const cousin = analogsOf(ledger.green.hex)[0];
    const result = submitSamples(ledger, "green", [{ hex: cousin.hex, mass: MASS_PER_LITRE, volume: 0.001 }]);
    expect(result.pay).toBeCloseTo(cousin.scale * price, 1);
    expect(ledger.green.filled).toBeCloseTo(cousin.scale, 5);
    expect(ledger.green.generation).toBe(0);
    expect(result.line.toLowerCase()).toContain("cousin");
    expect(result.line.toLowerCase()).toContain("still want");
  });

  it("pays only the requested litre when the glass runs over, and counts a thin pour short", () => {
    const over = createLedger(8);
    const price = over.green.pricePerLitre;
    const extra = submitSamples(over, "green", [{ hex: over.green.hex, mass: MASS_PER_LITRE * 2, volume: 0.002 }]);
    expect(extra.pay).toBe(price);
    expect(over.green.generation).toBe(1);
    expect(extra.line.toLowerCase()).toContain("more than the slip");
    const thin = createLedger(9);
    const half = submitSamples(thin, "green", [{ hex: thin.green.hex, mass: MASS_PER_LITRE * 0.5, volume: 0.001 }]);
    expect(half.pay).toBeCloseTo(thin.green.pricePerLitre * 0.5, 1);
    expect(thin.green.generation).toBe(0);
    expect(thin.green.filled).toBeCloseTo(0.5, 5);
    expect(half.line.toLowerCase()).toContain("thin");
    expect(half.line.toLowerCase()).toContain("still want");
  });

  it("refuses water and the wrong color", () => {
    const ledger = createLedger(3);
    const water = submitSamples(ledger, "green", [{ hex: "#FFFFFF", mass: 0, volume: 0.001 }]);
    expect(water.pay).toBe(0);
    expect(ledger.credits).toBe(500);
    const wrong = submitSamples(ledger, "green", [{ hex: "#00FF00", mass: 10, volume: 0.001 }]);
    expect(wrong.pay).toBe(0);
    expect(ledger.green.filled).toBe(0);
  });

  it("takes only the exact blue hex and then a named reward", () => {
    const ledger = createLedger(4);
    const wrong = submitSamples(ledger, "blue", [{ hex: "#6600FF", mass: 10, volume: 0.001 }]);
    expect(wrong.pay).toBe(0);
    expect(ledger.awaitingReward).toBe(false);
    const part = submitSamples(ledger, "blue", [{ hex: "#398514", mass: 4, volume: 0.0004 }]);
    expect(ledger.blue.filled).toBeCloseTo(0.4, 5);
    expect(part.line.toLowerCase()).toContain("still want");
    submitSamples(ledger, "blue", [{ hex: "#398514", mass: 6, volume: 0.0006 }]);
    expect(ledger.awaitingReward).toBe(true);
    const reward = acceptReward(ledger, 0xff9900, "Caffeine");
    expect(reward?.name).toBe("Caffeine");
    expect(ledger.awaitingReward).toBe(false);
    expect(ledger.blue.generation).toBe(1);
    expect(ledger.blue.allowAnalogs).toBe(false);
  });

  it("sells water only when the account can cover it", () => {
    const ledger = createLedger(5);
    expect(ledger.credits).toBe(500);
    const bought = tryOrder(ledger, "water", 1);
    expect(bought.ok).toBe(true);
    if (bought.ok) expect(bought.cost).toBe(4);
    expect(ledger.credits).toBe(496);
    expect(tryOrder(ledger, 0x6600ff, 2).ok).toBe(false);
  });
});
