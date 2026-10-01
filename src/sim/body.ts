import { analyzeBalance } from "./balance";
import { derive, draw, type Solution } from "./compound";
import { config } from "./config";
import { drive, noise } from "./effect";
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
  side: number;
};

export type Condition = "steady" | "mild" | "moderate" | "severe" | "critical" | "dead";

export type Body = {
  organs: Organ[];
  alive: boolean;
  critical: number;
  cause: string | null;
  rng: () => number;
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
        side: 0,
      })),
      alive: true,
      critical: 0,
      cause: null,
      rng,
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

export type PendingDose = {
  hex: string;
  mass: number;
  left: number;
};

export type Blood = {
  pending: PendingDose[];
  doses: Dose[];
};

export function createBlood(): Blood {
  return { pending: [], doses: [] };
}

export function swallow(blood: Blood, dose: { hex: string; mass: number }) {
  const mass = dose.mass * config.routes.oral.bioavailability;
  if (mass <= 1e-8) return;
  blood.pending.push({ hex: dose.hex, mass, left: config.routes.oral.onset });
}

export function stepBody(body: Body, blood: Blood, dt: number): Symptom[] {
  if (!body.alive) return symptomsFrom(body.organs);

  const liver = body.organs.find((organ) => organ.name === "liver");
  const rate = clearanceRate(liver);
  for (const dose of blood.doses) dose.mass *= Math.exp(-rate * dt);
  blood.doses = blood.doses.filter((dose) => dose.mass > 1e-5);

  for (let i = blood.pending.length - 1; i >= 0; i--) {
    blood.pending[i].left -= dt;
    if (blood.pending[i].left > 0) continue;
    blood.doses.push({ hex: blood.pending[i].hex, mass: blood.pending[i].mass });
    blood.pending.splice(i, 1);
  }

  const burden = noiseBurden(blood.doses);
  for (const organ of body.organs) organ.side *= Math.exp(-config.damage.sideDecay * dt);
  const chance = 1 - Math.exp(-config.damage.sideChance * burden * dt);
  if (burden > 0 && body.rng() < chance) {
    const organ = body.organs[Math.floor(body.rng() * body.organs.length)];
    const sign = body.rng() < 0.5 ? -1 : 1;
    organ.side += sign * config.damage.sideDrive;
  }

  const next = evaluate(body.organs, blood.doses);
  for (const organ of next.organs) {
    const over = Math.max(0, Math.abs(organ.deflection) - config.symptoms.severe);
    const overdrive = config.damage.overdrive * over * over * dt;
    const dirty = organ.name === "liver" ? config.damage.noise * burden * dt : 0;
    const taken = overdrive + dirty;
    if (taken > 0) organ.integrity = Math.max(0, organ.integrity - taken);
    else if (organ.integrity > 0) {
      organ.integrity = Math.min(1, organ.integrity + config.damage.regen * (1 - organ.integrity) * dt);
    }
  }
  body.organs = next.organs;
  applyCritical(body, dt);
  return next.symptoms;
}

function noiseBurden(doses: readonly Dose[]) {
  let total = 0;
  for (const dose of doses) total += noise(derive(dose.hex), dose.mass);
  return total;
}

function applyCritical(body: Body, dt: number) {
  const heart = body.organs.find((organ) => organ.name === "heart");
  const brain = body.organs.find((organ) => organ.name === "brain");
  if (heart && heart.integrity <= 0) return die(body, "the heart gives out");
  if (brain && brain.integrity <= 0) return die(body, "the brain gives out");
  const heartCrash = !!heart && Math.abs(heart.deflection) >= config.damage.critical;
  const brainCrash = !!brain && Math.abs(brain.deflection) >= config.damage.critical;
  if (!heartCrash && !brainCrash) {
    body.critical = 0;
    return;
  }
  body.critical += dt;
  if (body.critical < config.damage.criticalHold) return;
  if (heartCrash && brainCrash) return die(body, "the heart and breathing fail");
  if (heartCrash) return die(body, "cardiac arrest");
  die(body, "breathing stops");
}

function die(body: Body, cause: string) {
  body.alive = false;
  body.cause = cause;
}

function clearanceRate(liver: Organ | undefined) {
  if (!liver) return config.clearance.floor;
  const rate = config.clearance.k0 * (1 + 0.5 * liver.deflection) * (0.3 + 0.7 * liver.integrity);
  return Math.max(config.clearance.floor, rate);
}

export function evaluate(organs: readonly Organ[], doses: readonly Dose[]): { organs: Organ[]; symptoms: Symptom[] } {
  const next = organs.map((organ) => {
    let totalDrive = organ.side;
    for (const dose of doses) totalDrive += drive(derive(dose.hex), organ, dose.mass);
    totalDrive *= sensitivity(organ.integrity);
    const deflection = Math.tanh((totalDrive - organ.adaptation) / config.deflectionScale);
    return { ...organ, deflection };
  });
  return { organs: next, symptoms: symptomsFrom(next) };
}

export function conditionOf(body: Body, symptoms: readonly Symptom[]): Condition {
  if (!body.alive) return "dead";
  if (body.critical > 0) return "critical";
  const rank: Record<SymptomBand, number> = { mild: 1, moderate: 2, severe: 3 };
  let worst: Condition = "steady";
  let worstRank = 0;
  for (const symptom of symptoms) {
    if (rank[symptom.band] > worstRank) {
      worst = symptom.band;
      worstRank = rank[symptom.band];
    }
  }
  return worst;
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
