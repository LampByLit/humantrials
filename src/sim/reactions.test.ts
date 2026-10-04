import { describe, expect, it } from "vitest";
import listed from "../../concept/chems.json";
import { createBlood, createBody, evaluate, stepBody, type Organ } from "./body";
import { config } from "./config";
import { catalogDrive, catalogFade, catalogHexes, senseOf } from "./reactions";
import { createRng } from "./rng";

function organ(name: Organ["name"], theta: number): Organ {
  return {
    name,
    theta,
    k: config.tuning.k,
    integrity: 1,
    deflection: 0,
    adaptation: 0,
    side: 0,
  };
}

describe("catalog reactions", () => {
  it("covers every catalog hex", () => {
    expect(listed).toHaveLength(50);
    expect(catalogHexes.slice().sort()).toEqual(listed.map((entry) => entry.hex).sort());
  });

  it("pushes caffeine the same way no matter where the receptors sit", () => {
    const dose = [{ hex: "#FF9900", mass: 0.2 }];
    const left = evaluate([organ("heart", 10), organ("brain", 200), organ("liver", 40)], dose);
    const right = evaluate([organ("heart", 180), organ("brain", 20), organ("liver", 300)], dose);
    expect(left.organs.map((item) => item.deflection)).toEqual(right.organs.map((item) => item.deflection));
    expect(left.organs[0].deflection).toBeGreaterThan(config.symptoms.moderate);
    expect(left.organs[1].deflection).toBeGreaterThan(config.symptoms.moderate);
    expect(catalogDrive("#FF0000", "heart")).toBeNull();
  });

  it("sedates with fentanyl and seizes with strychnine", () => {
    const organs = [organ("heart", 0), organ("brain", 90), organ("liver", 200)];
    const fentanyl = evaluate(organs, [{ hex: "#6600FF", mass: 0.15 }]);
    expect(fentanyl.organs[1].deflection).toBeLessThan(-config.symptoms.severe);
    expect(fentanyl.organs[0].deflection).toBeLessThan(0);
    const strychnine = evaluate(organs, [{ hex: "#AAFF00", mass: 0.15 }]);
    expect(strychnine.organs[1].deflection).toBeGreaterThan(config.symptoms.severe);
    const felt = senseOf(strychnine.organs, [{ hex: "#AAFF00", mass: 0.15 }], true);
    expect(felt.spasm).toBeGreaterThan(0.5);
  });

  it("leaves the inert fillers with no drive", () => {
    for (const hex of ["#FFFFFF", "#E8E8E8", "#F0EDE4", "#EEEEEE"]) {
      const result = evaluate([organ("heart", 0), organ("brain", 10), organ("liver", 20)], [{ hex, mass: 4 }]);
      expect(result.organs.every((item) => item.deflection === 0)).toBe(true);
    }
  });

  it("clears nicotine faster than caffeine", () => {
    expect(catalogFade("#FF7722")).toBeGreaterThan(catalogFade("#FF9900"));
    const run = (hex: string) => {
      const body = {
        organs: [organ("heart", 0), organ("brain", 120), organ("liver", 240)],
        alive: true,
        critical: 0,
        cause: null,
        rng: createRng(1),
      };
      const blood = createBlood();
      blood.doses.push({ hex, mass: 0.2 });
      stepBody(body, blood, 2);
      return blood.doses[0].mass;
    };
    expect(run("#FF7722")).toBeLessThan(run("#FF9900"));
  });

  it("stops a dead body", () => {
    const body = createBody(1);
    body.alive = false;
    const sense = senseOf(body.organs, [{ hex: "#FF9900", mass: 2 }], false);
    expect(sense.move).toBe(0);
    expect(sense.operate).toBe(0);
    expect(sense.vignette).toBe(1);
  });
});
