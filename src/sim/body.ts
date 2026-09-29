import { analyzeBalance } from "./balance";
import { derive, draw, type Solution } from "./compound";
import { config } from "./config";
import { drive } from "./effect";
import { createRng } from "./rng";

export const organNames = ["heart", "brain", "liver"] as const;

export type OrganName = (typeof organNames)[number];

export type Organ = {
  name: OrganName;
  theta: number;
  k: number;
  integrity: number;
  deflection: number;
  adaptation: number;
};

export type Body = {
  organs: Organ[];
};

export type Dose = {
  hex: string;
  mass: number;
};

export type SymptomBand = "mild" | "moderate" | "severe";

export type Symptom = {
  organ: OrganName;
  direction: "up" | "down";
  band: SymptomBand;
  text: string;
};

type Phrase = { base: string; extreme: string | null };

const phrases: Record<OrganName, { up: Phrase; down: Phrase }> = {
  heart: {
    up: { base: "fast, hot, pounding", extreme: "arrhythmia" },
    down: { base: "slow, faint, cold", extreme: "cardiac arrest" },
  },
  brain: {
    up: { base: "alert, jittery", extreme: "seizure" },
    down: { base: "drowsy, sleep, slowed breathing", extreme: "coma" },
  },
  liver: {
    up: { base: "clears drugs faster", extreme: null },
    down: { base: "clears slower", extreme: "toxins build up" },
  },
};

export function sensitivity(integrity: number): number {
  return 1 + (1 - integrity);
}

export function capacity(integrity: number): number {
  return integrity;
}

export function createBody(seed: number): Body {
  const rng = createRng(seed);
  const step = 360 / organNames.length;
  for (let attempt = 0; attempt < 10000; attempt++) {
    const rotation = rng() * 360;
    const thetas = organNames.map((_, index) => {
      const jitter = (rng() * 2 - 1) * config.receptors.jitterDeg;
      return wrapDegrees(index * step + rotation + jitter);
    });
    if (!separated(thetas)) continue;
    return {
      organs: organNames.map((name, index) => ({
        name,
        theta: thetas[index],
        k: config.tuning.k,
        integrity: config.body.integrity,
        deflection: 0,
        adaptation: config.body.adaptation,
      })),
    };
  }
  throw new Error("receptor generation failed");
}

export function administerInjected(input: Solution, volumeDrawn: number): { dose: Dose; solution: Solution } {
  const drawn = draw(input, volumeDrawn);
  return {
    dose: {
      hex: input.hex,
      mass: drawn.mass * config.routes.injected.bioavailability,
    },
    solution: drawn.solution,
  };
}

export function evaluate(organs: readonly Organ[], doses: readonly Dose[]): { organs: Organ[]; symptoms: Symptom[] } {
  const next = organs.map((organ) => {
    let totalDrive = 0;
    for (const dose of doses) totalDrive += drive(derive(dose.hex), organ, dose.mass);
    const deflection = Math.tanh((totalDrive - organ.adaptation) / config.deflectionScale);
    return { ...organ, deflection };
  });
  return { organs: next, symptoms: symptomsFrom(next) };
}

export function symptomsFrom(organs: readonly Organ[]): Symptom[] {
  const symptoms: Symptom[] = [];
  for (const organ of organs) {
    const magnitude = Math.abs(organ.deflection);
    const band = bandFor(magnitude);
    if (!band) continue;
    const direction = organ.deflection > 0 ? "up" : "down";
    const phrase = phrases[organ.name][direction];
    const text = band === "severe" && phrase.extreme ? `${phrase.base}; ${phrase.extreme}` : phrase.base;
    symptoms.push({ organ: organ.name, direction, band, text });
  }
  return symptoms;
}

export function bodyRank(body: Body): number {
  return analyzeBalance(
    body.organs.map((organ) => organ.theta),
    body.organs[0]?.k ?? config.tuning.k,
  ).rank;
}

function bandFor(magnitude: number): SymptomBand | null {
  if (magnitude < config.symptoms.mild) return null;
  if (magnitude < config.symptoms.moderate) return "mild";
  if (magnitude < config.symptoms.severe) return "moderate";
  return "severe";
}

function separated(thetas: readonly number[]): boolean {
  for (let i = 0; i < thetas.length; i++) {
    for (let j = i + 1; j < thetas.length; j++) {
      if (circularDistance(thetas[i], thetas[j]) < config.receptors.minSeparationDeg) return false;
    }
  }
  return true;
}

function circularDistance(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

function wrapDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
