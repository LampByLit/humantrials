import { describe, expect, it } from "vitest";
import { abilityNotes, bloodCard, organClass, organTone, receiptCard, symptomCard, traceSamples, vitalReadout } from "./healthHud";
import { createBlood, createBody, type Body, type Symptom } from "./sim/body";

describe("health hud", () => {
  it("reads a resting body as a quiet pulse, breath, and temperature", () => {
    expect(vitalReadout(true, 0, 0, 1.15)).toEqual({ pulse: "69", breath: "14", temp: "37.0°", clear: "Steady" });
    expect(vitalReadout(true, 0, 0, 1.15, 0.4).clear).toBe("Fast");
    expect(vitalReadout(true, 0, 0, 1.15, -0.4).clear).toBe("Slow");
    expect(vitalReadout(false, 1, 1, 2)).toEqual({ pulse: "—", breath: "—", temp: "—", clear: "—" });
  });

  it("notes pilot eyes only once they are open", () => {
    expect(abilityNotes(false)).toEqual([]);
    expect(abilityNotes(true)).toEqual(["Pilot eyes"]);
  });

  it("warms an organ that is driven up and cools one driven down", () => {
    const up = organTone({ deflection: 0.8, integrity: 1 }, 0);
    const down = organTone({ deflection: -0.8, integrity: 1 }, 0);
    expect(up.fill).not.toBe(down.fill);
    expect(up.opacity).toBeGreaterThan(0.85);
    expect(organClass({ deflection: 0.8, integrity: 1 })).toContain("up severe");
    expect(organClass({ deflection: -0.55, integrity: 1 })).toContain("down moderate");
    expect(organClass({ deflection: 0, integrity: 0.4 })).toContain("hurt");
    expect(organClass({ deflection: 0.97, integrity: 1 })).toContain("fail");
  });

  it("draws a heartbeat, a faster brain wave, and a stalled liver", () => {
    const resting = traceSamples("heart", 0, 1, 2);
    const racing = traceSamples("heart", 0.85, 1, 2);
    expect(Math.max(...resting)).toBeGreaterThan(0.7);
    expect(peakGaps(resting)).toBeLessThan(peakGaps(racing));
    const alert = signChanges(traceSamples("brain", 0.8, 1, 1));
    const drowsy = signChanges(traceSamples("brain", -0.8, 1, 1));
    expect(alert).toBeGreaterThan(drowsy);
    const stalled = traceSamples("liver", -0.8, 1, 1);
    const even = traceSamples("liver", 0, 1, 1);
    const span = (samples: readonly number[]) => Math.max(...samples) - Math.min(...samples);
    expect(span(stalled)).toBeLessThan(span(even));
    expect(Math.min(...stalled)).toBeGreaterThan(-0.5);
    expect(Math.max(...traceSamples("heart", 0, 0, 2))).toBeLessThan(0.6);
  });

  it("lists symptoms and what is still in the blood", () => {
    const symptoms: Symptom[] = [
      { organ: "heart", direction: "up", band: "severe", text: "fast, hot, pounding; arrhythmia" },
    ];
    expect(symptomCard(symptoms)).toContain("arrhythmia");
    expect(symptomCard(symptoms)).toContain("up severe");
    expect(symptomCard([])).toBe("");
    const blood = createBlood();
    blood.doses.push({ hex: "#FF6600", mass: 0.12 });
    blood.pending.push({ hex: "#CC00FF", mass: 0.04, left: 2 });
    const card = bloodCard(blood);
    expect(card).toContain("Cocaine");
    expect(card).toContain("Acetaminophen");
    expect(card).toContain("onset");
    expect(bloodCard(createBlood())).toContain("Clear");
  });

  it("prints a toxicology receipt with the cause of death", () => {
    const body = createBody(1);
    body.alive = false;
    body.cause = "cardiac arrest";
    const blood = createBlood();
    blood.doses.push({ hex: "#FF6600", mass: 0.12 });
    blood.pending.push({ hex: "#CC00FF", mass: 0.04, left: 2 });
    const card = receiptCard(body as Body, blood);
    expect(card).toContain("Cocaine");
    expect(card).toContain("Acetaminophen");
    expect(card).toContain("cardiac arrest");
    expect(card).toContain("Still coming on");
  });
});

function peakGaps(samples: readonly number[]) {
  const peaks: number[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i] > 0.55 && samples[i] >= samples[i - 1] && samples[i] > samples[i + 1]) peaks.push(i);
  }
  if (peaks.length < 3) return 0;
  const gaps = peaks.slice(1).map((peak, index) => peak - peaks[index]);
  return Math.max(...gaps) - Math.min(...gaps);
}

function signChanges(samples: readonly number[]) {
  let changes = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] < 0 && samples[i] >= 0) changes += 1;
    if (samples[i - 1] >= 0 && samples[i] < 0) changes += 1;
  }
  return changes;
}