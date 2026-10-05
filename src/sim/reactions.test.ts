import { describe, expect, it } from "vitest";
import listed from "../../concept/chems.json";
import { createBlood, createBody, evaluate, stepBody, type Organ } from "./body";
import { config } from "./config";
import { analogOf, analogsOf } from "./analogs";
import { foodFamilies } from "./food";
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
    expect(listed).toHaveLength(53);
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

  it("gives each catalog chemical its set of weaker analogs", () => {
    const count = config.analogs.count;
    const seen = new Set<string>();
    for (const entry of listed) {
      const analogs = analogsOf(entry.hex);
      expect(analogs).toHaveLength(count);
      for (const analog of analogs) {
        expect(analog.parent).toBe(entry.hex.toUpperCase());
        expect(analog.scale).toBeLessThan(1);
        expect(analog.scale).toBeGreaterThan(0);
        expect(seen.has(analog.hex)).toBe(false);
        expect(catalogHexes).not.toContain(analog.hex);
        seen.add(analog.hex);
      }
    }
    expect(seen.size).toBe(listed.length * count);
    expect(analogOf("#123456")).toBeNull();
    expect(catalogDrive("#123456", "heart")).toBeNull();
  });

  it("lets food move organs the same way no matter where the receptors sit", () => {
    const dose = [{ hex: "#7A1E2A", mass: 1.4 }];
    const left = evaluate([organ("heart", 10), organ("brain", 200), organ("liver", 40)], dose);
    const right = evaluate([organ("heart", 180), organ("brain", 20), organ("liver", 300)], dose);
    expect(left.organs.map((item) => item.deflection)).toEqual(right.organs.map((item) => item.deflection));
    expect(left.organs[0].deflection).toBeGreaterThan(config.symptoms.mild);
    expect(left.organs[0].deflection).toBeLessThan(config.symptoms.severe);
    const organs = [organ("heart", 0), organ("brain", 120), organ("liver", 240)];
    const parent = evaluate(organs, [{ hex: "#A0705A", mass: 0.5 }]);
    const cousin = evaluate(organs, [{ hex: foodFamilies()[0].members[1], mass: 0.5 }]);
    expect(parent.organs[2].deflection).toBeGreaterThan(config.symptoms.mild);
    expect(cousin.organs[2].deflection).toBeGreaterThan(0);
    expect(cousin.organs[2].deflection).toBeLessThan(parent.organs[2].deflection);
  });

  it("lets a caffeine analog act like caffeine, only weaker and a little off", () => {
    const organs = [organ("heart", 10), organ("brain", 200), organ("liver", 40)];
    const dose = 0.2;
    const exact = evaluate(organs, [{ hex: "#FF9900", mass: dose }]);
    const analogs = analogsOf("#FF9900");
    const moved = evaluate([organ("heart", 180), organ("brain", 20), organ("liver", 300)], [{ hex: analogs[0].hex, mass: dose }]);
    const near = evaluate(organs, [{ hex: analogs[0].hex, mass: dose }]);
    expect(near.organs.map((item) => item.deflection)).toEqual(moved.organs.map((item) => item.deflection));
    expect(near.organs[0].deflection).toBeGreaterThan(0);
    expect(near.organs[0].deflection).toBeLessThan(exact.organs[0].deflection);
    expect(near.organs[1].deflection).toBeGreaterThan(0);
    expect(near.organs[1].deflection).toBeLessThan(exact.organs[1].deflection);
    const hearts = new Set(analogs.map((analog) => catalogDrive(analog.hex, "heart")!.toFixed(4)));
    expect(hearts.size).toBeGreaterThan(4);
  });

  it("carries opioid block and milk resistance onto analogs", () => {
    const organs = [organ("heart", 0), organ("brain", 90), organ("liver", 200)];
    const fentanyl = analogsOf("#6600FF")[0].hex;
    const alone = evaluate(organs, [{ hex: fentanyl, mass: 0.2 }]);
    const reversed = evaluate(organs, [{ hex: fentanyl, mass: 0.2 }, { hex: "#00CCAA", mass: 0.12 }]);
    expect(alone.organs[1].deflection).toBeLessThan(0);
    expect(reversed.organs[1].deflection).toBeGreaterThan(alone.organs[1].deflection);

    const toxin = analogsOf("#AAFF00")[0].hex;
    const bare = evaluate(organs, [{ hex: toxin, mass: 0.15 }]);
    const covered = evaluate(organs, [{ hex: toxin, mass: 0.15 }, { hex: "#FFFFFF", mass: 0.3 }]);
    expect(bare.organs[1].deflection).toBeGreaterThan(0);
    expect(covered.organs[1].deflection).toBeCloseTo(bare.organs[1].deflection, 8);

    const body = {
      organs: [organ("heart", 0), organ("brain", 120), organ("liver", 240)],
      alive: true,
      critical: 0,
      cause: null,
      rng: createRng(4),
    };
    const blood = createBlood();
    blood.doses.push({ hex: analogsOf("#2A2A55")[0].hex, mass: 5 });
    for (let i = 0; i < 600; i++) stepBody(body, blood, 0.1);
    expect(body.alive).toBe(true);
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
