import { describe, expect, it } from "vitest";
import { config } from "./config";
import { createAffect, stepAffect } from "./affect";

const cocaine = { hex: "#FF6600", mass: 0.2 };
const alcohol = { hex: "#4466CC", mass: 0.2 };
const heroin = { hex: "#8800BB", mass: 0.2 };

describe("aftermath", () => {
  it("stays quiet during a dose and after an unmarked one", () => {
    const affect = createAffect();
    expect(stepAffect(affect, [cocaine], 0.2)).toBeNull();
    expect(stepAffect(affect, [], 0.2)).toBe("flat");
    const caffeine = createAffect();
    stepAffect(caffeine, [{ hex: "#FF9900", mass: 0.4 }], 0.2);
    expect(stepAffect(caffeine, [], 0.2)).toBeNull();
  });

  it("names a compounded aftermath instead of either drug alone", () => {
    const affect = createAffect();
    stepAffect(affect, [cocaine, alcohol], 0.2);
    expect(stepAffect(affect, [alcohol], 0.2)).toBe("frayed");
    stepAffect(affect, [], config.affect.hold);
    expect(affect.line).toBeNull();
  });

  it("lets a second feeling pass unshown", () => {
    const affect = createAffect();
    stepAffect(affect, [cocaine], 0.2);
    expect(stepAffect(affect, [], 0.2)).toBe("flat");
    stepAffect(affect, [heroin], 0.2);
    stepAffect(affect, [], 0.2);
    expect(affect.line).toBe("flat");
    stepAffect(affect, [], config.affect.hold);
    expect(affect.line).toBeNull();
  });

  it("can feel the same drug again once the quiet has passed", () => {
    const affect = createAffect();
    stepAffect(affect, [cocaine], 0.2);
    stepAffect(affect, [], 0.2);
    stepAffect(affect, [], config.affect.quiet);
    stepAffect(affect, [cocaine], 0.2);
    expect(stepAffect(affect, [], 0.2)).toBe("flat");
  });

  it("ignores a trace that never became a real dose", () => {
    const affect = createAffect();
    stepAffect(affect, [{ hex: "#FF6600", mass: config.affect.peak * 0.5 }], 0.2);
    expect(stepAffect(affect, [], 0.2)).toBeNull();
  });
});
