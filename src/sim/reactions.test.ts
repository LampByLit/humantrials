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

  it("lets a swallow of a hallucinogen change vision before it threatens the body", () => {
    const organs = [organ("heart", 0), organ("brain", 90), organ("liver", 200)];
    const sip = 0.12;
    const lsd = evaluate(organs, [{ hex: "#FFCC00", mass: sip }]);
    expect(lsd.organs[1].deflection).toBeGreaterThan(0);
    expect(lsd.organs[1].deflection).toBeLessThan(config.symptoms.severe);
    const seen = senseOf(lsd.organs, [{ hex: "#FFCC00", mass: sip }], true);
    expect(seen.trip).toBeGreaterThan(0.45);
    expect(seen.spasm).toBeLessThan(0.2);
    expect(catalogFade("#FFDD33")).toBeGreaterThan(catalogFade("#FFCC00") * 4);

    const dmt = senseOf(organs, [{ hex: "#FFDD33", mass: sip }], true);
    expect(dmt.trip).toBeGreaterThan(seen.trip);
    expect(dmt.drift).toBeGreaterThan(seen.drift);

    const ketamine = evaluate(organs, [{ hex: "#7744CC", mass: sip }]);
    expect(ketamine.organs[1].deflection).toBeLessThan(0);
    expect(ketamine.organs[1].deflection).toBeGreaterThan(-config.symptoms.severe);
    const apart = senseOf(ketamine.organs, [{ hex: "#7744CC", mass: sip }], true);
    expect(apart.drift).toBeGreaterThan(0.35);
    expect(apart.blur).toBeGreaterThan(0.3);
    expect(apart.trip).toBe(0);
    expect(apart.spasm).toBeLessThan(0.2);

    const deliriant = evaluate(organs, [{ hex: "#5C5C8A", mass: sip }]);
    expect(deliriant.organs[0].deflection).toBeGreaterThan(0);
    expect(deliriant.organs[1].deflection).toBeLessThan(0);
    expect(senseOf(deliriant.organs, [{ hex: "#5C5C8A", mass: sip }], true).mud).toBeGreaterThan(0.3);
  });

  it("survives any amount of the harmless substances", () => {
    for (const hex of ["#2A2A55", "#00CCAA", "#FFE8A0", "#FFDD33", "#FFBB44"]) {
      const body = {
        organs: [organ("heart", 0), organ("brain", 120), organ("liver", 240)],
        alive: true,
        critical: 0,
        cause: null,
        rng: createRng(3),
      };
      const blood = createBlood();
      blood.doses.push({ hex, mass: 5 });
      for (let i = 0; i < 600; i++) stepBody(body, blood, 0.1);
      expect(body.alive).toBe(true);
      expect(body.organs[0].integrity).toBe(1);
      expect(body.organs[1].integrity).toBe(1);
    }
  });

  it("lets naloxone undo fentanyl and nothing else", () => {
    const organs = [organ("heart", 0), organ("brain", 90), organ("liver", 200)];
    const fentanyl = { hex: "#6600FF", mass: 0.15 };
    const naloxone = { hex: "#00CCAA", mass: 0.12 };
    const reversed = evaluate(organs, [fentanyl, naloxone]);
    expect(reversed.organs[1].deflection).toBeGreaterThan(-config.symptoms.mild);
    const caffeine = { hex: "#FF9900", mass: 0.2 };
    const alone = evaluate(organs, [caffeine]);
    const covered = evaluate(organs, [caffeine, naloxone]);
    expect(covered.organs[0].deflection).toBeCloseTo(alone.organs[0].deflection, 8);
    expect(evaluate(organs, [naloxone]).organs.every((item) => item.deflection === 0)).toBe(true);
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
