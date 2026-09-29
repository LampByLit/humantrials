import { describe, expect, it } from "vitest";
import { derive, solution } from "./compound";
import { config } from "./config";
import { drive } from "./effect";
import {
  administerInjected,
  capacity,
  createBlood,
  createBody,
  evaluate,
  sensitivity,
  stepBody,
  swallow,
  symptomsFrom,
  type Organ,
} from "./body";

function organ(name: Organ["name"], theta: number, deflection = 0, integrity = 1): Organ {
  return {
    name,
    theta,
    k: config.tuning.k,
    integrity,
    deflection,
    adaptation: 0,
  };
}

describe("body", () => {
  it("reproduces receptors and deflections from the same seed", () => {
    const doses = [{ hex: "#FF0000", mass: 1 }];
    const first = createBody(42);
    const second = createBody(42);
    expect(first.organs.map((item) => item.theta)).toEqual(second.organs.map((item) => item.theta));
    const left = evaluate(first.organs, doses);
    const right = evaluate(second.organs, doses);
    expect(left.organs.map((item) => item.deflection)).toEqual(right.organs.map((item) => item.deflection));
    expect(left.symptoms).toEqual(right.symptoms);
    expect(createBody(1).organs.map((item) => item.theta)).not.toEqual(createBody(2).organs.map((item) => item.theta));
  });

  it("keeps generated receptors at least the configured separation apart", () => {
    for (let seed = 0; seed < 20; seed++) {
      const thetas = createBody(seed).organs.map((item) => item.theta);
      for (let i = 0; i < thetas.length; i++) {
        for (let j = i + 1; j < thetas.length; j++) {
          const delta = Math.abs(thetas[i] - thetas[j]) % 360;
          expect(Math.min(delta, 360 - delta)).toBeGreaterThanOrEqual(config.receptors.minSeparationDeg);
        }
      }
    }
  });

  it("maps deflection bands to spec phrases and hides receptor hue", () => {
    const organs = [
      organ("heart", 10, 0.24),
      organ("brain", 20, 0.25),
      organ("liver", 30, -0.5),
      organ("heart", 40, 0.75),
    ];
    const symptoms = symptomsFrom(organs);
    expect(symptoms).toEqual([
      { organ: "brain", direction: "up", band: "mild", text: "alert, jittery" },
      { organ: "liver", direction: "down", band: "moderate", text: "clears slower" },
      { organ: "heart", direction: "up", band: "severe", text: "fast, hot, pounding; arrhythmia" },
    ]);
    for (const symptom of symptoms) {
      expect(symptom).not.toHaveProperty("theta");
    }
  });

  it("includes the extreme clause only in the severe band", () => {
    expect(symptomsFrom([organ("heart", 0, -0.8)])).toEqual([
      { organ: "heart", direction: "down", band: "severe", text: "slow, faint, cold; cardiac arrest" },
    ]);
    expect(symptomsFrom([organ("brain", 0, -0.9)])[0].text).toBe("drowsy, sleep, slowed breathing; coma");
    expect(symptomsFrom([organ("brain", 0, 0.9)])[0].text).toBe("alert, jittery; seizure");
    expect(symptomsFrom([organ("liver", 0, -0.9)])[0].text).toBe("clears slower; toxins build up");
    expect(symptomsFrom([organ("liver", 0, 0.9)])[0].text).toBe("clears drugs faster");
    expect(symptomsFrom([organ("heart", 0, 0.6)])[0].text).toBe("fast, hot, pounding");
  });

  it("applies an injected dose immediately and stacks listed doses", () => {
    const source = solution("#FF0000", 10, 5);
    const given = administerInjected(source, 1);
    expect(given.dose).toEqual({
      hex: "#FF0000",
      mass: 2 * config.routes.injected.bioavailability,
    });
    expect(given.solution).toEqual({ hex: "#FF0000", mass: 8, volume: 4 });

    const heart = organ("heart", 0);
    const once = evaluate([heart], [{ hex: "#FF0000", mass: 1 }]);
    const stacked = evaluate(
      [heart],
      [
        { hex: "#FF0000", mass: 0.5 },
        { hex: "#FF0000", mass: 0.5 },
      ],
    );
    expect(once.organs[0].deflection).toBeCloseTo(stacked.organs[0].deflection, 8);
    expect(once.organs[0].deflection).toBeGreaterThan(config.symptoms.severe);
    expect(once.symptoms[0]).toMatchObject({ organ: "heart", direction: "up", band: "severe" });
    expect(once.organs[0].integrity).toBe(heart.integrity);
    expect(once.organs[0].adaptation).toBe(0);
    expect(once.organs[0].theta).toBe(heart.theta);
  });

  it("does not fold integrity into drive", () => {
    const dose = [{ hex: "#00FF00", mass: 0.4 }];
    const healthy = evaluate([organ("brain", 120, 0, 1)], dose);
    const damaged = evaluate([organ("brain", 120, 0, 0.4)], dose);
    expect(damaged.organs[0].deflection).toBeCloseTo(healthy.organs[0].deflection, 8);
    expect(sensitivity(1)).toBe(1);
    expect(sensitivity(0.4)).toBeCloseTo(1.6, 8);
    expect(capacity(0.4)).toBe(0.4);
    const compound = derive("#00FF00");
    expect(drive(compound, { theta: 120, k: config.tuning.k }, 0.4)).toBeGreaterThan(0);
  });

  it("holds a swallowed dose until onset, then clears it above the floor", () => {
    const body = { organs: [organ("heart", 0), organ("brain", 120), organ("liver", 240)] };
    const blood = createBlood();
    swallow(blood, { hex: "#FF0000", mass: 2 });
    expect(blood.pending[0].mass).toBeCloseTo(2 * config.routes.oral.bioavailability, 8);
    stepBody(body, blood, 0);
    expect(body.organs[0].deflection).toBe(0);
    stepBody(body, blood, config.routes.oral.onset);
    expect(blood.pending).toHaveLength(0);
    expect(body.organs[0].deflection).toBeGreaterThan(config.symptoms.mild);
    const entered = blood.doses[0].mass;
    stepBody(body, blood, 1);
    expect(blood.doses[0].mass).toBeLessThan(entered);
    expect(blood.doses[0].mass).toBeGreaterThan(entered * Math.exp(-1));

    const wrecked = { organs: [organ("heart", 0), organ("brain", 120), organ("liver", 240, -1, 0)] };
    const held = createBlood();
    held.doses.push({ hex: "#FF0000", mass: 1 });
    stepBody(wrecked, held, 1);
    expect(held.doses[0].mass).toBeCloseTo(Math.exp(-config.clearance.floor), 5);
  });
});
