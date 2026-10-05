import { describe, expect, it } from "vitest";
import { analogsOf } from "../sim/analogs";
import { acceptReward, createLedger, submitSamples, tryOrder } from "./ledger";

describe("ledger", () => {
  it("pays a shelf litre of fentanyl and opens the next green order", () => {
    const ledger = createLedger(1);
    const result = submitSamples(ledger, "green", [{ hex: "#6600FF", mass: 10, volume: 0.001 }]);
    expect(result.pay).toBe(1000);
    expect(ledger.credits).toBe(1500);
    expect(ledger.green.generation).toBe(1);
    expect(ledger.green.hex).not.toBe("#6600FF");
    expect(ledger.green.reason.length).toBeGreaterThan(20);
    expect(result.line).toContain(ledger.green.name);
  });

  it("pays a fentanyl analog on a scale and leaves the order open", () => {
    const ledger = createLedger(2);
    const cousin = analogsOf("#6600FF")[0];
    const result = submitSamples(ledger, "green", [{ hex: cousin.hex, mass: 10, volume: 0.001 }]);
    expect(result.pay).toBeCloseTo(cousin.scale * 1000, 1);
    expect(ledger.green.filled).toBeCloseTo(cousin.scale, 5);
    expect(ledger.green.generation).toBe(0);
    expect(result.line.toLowerCase()).toContain("cousin");
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
