import { config } from "./config";
import { tuning } from "./effect";

const RANK_EPSILON = 1e-8;
const HUE_STEPS = 360;

export type BalanceReport = {
  rank: number;
  bestSelectivity: number[];
  cleanCoverage: number;
  broadShare: number;
  inertShare: number;
  crowdedPairs: [number, number][];
};

export function analyzeBalance(thetas: readonly number[], k: number = config.tuning.k): BalanceReport {
  const columns = thetas.map((theta) => {
    const column = new Array<number>(HUE_STEPS);
    for (let hue = 0; hue < HUE_STEPS; hue++) column[hue] = tuning(hue, theta, k);
    return column;
  });

  let peak = 0;
  for (const column of columns) {
    for (const value of column) peak = Math.max(peak, Math.abs(value));
  }

  const bestSelectivity = columns.map((column, organ) => {
    let best = 0;
    for (let hue = 0; hue < HUE_STEPS; hue++) {
      const target = Math.abs(column[hue]);
      if (target < config.balance.halfPeak * peak) continue;
      let other = 0;
      for (let index = 0; index < columns.length; index++) {
        if (index !== organ) other = Math.max(other, Math.abs(columns[index][hue]));
      }
      const ratio = other === 0 ? Number.POSITIVE_INFINITY : target / other;
      if (ratio > best) best = ratio;
    }
    return best;
  });

  let clean = 0;
  let broad = 0;
  let inert = 0;
  for (let hue = 0; hue < HUE_STEPS; hue++) {
    const responses = columns.map((column) => Math.abs(column[hue])).sort((a, b) => b - a);
    const strongest = responses[0] ?? 0;
    const runnerUp = responses[1] ?? 0;
    if (
      strongest >= config.balance.halfPeak * peak &&
      (runnerUp === 0 || strongest >= config.balance.cleanRatio * runnerUp)
    ) {
      clean++;
    }
    const hits = columns.filter((column) => Math.abs(column[hue]) >= config.balance.broadOfPeak * peak).length;
    if (columns.length > 0 && hits / columns.length >= config.balance.broadOrganFraction) broad++;
    if (strongest < config.balance.inertOfPeak * peak) inert++;
  }

  const crowdedPairs: [number, number][] = [];
  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      if (cosine(columns[i], columns[j]) > config.balance.crowdedSimilarity) crowdedPairs.push([i, j]);
    }
  }

  return {
    rank: matrixRank(columns),
    bestSelectivity,
    cleanCoverage: clean / HUE_STEPS,
    broadShare: broad / HUE_STEPS,
    inertShare: inert / HUE_STEPS,
    crowdedPairs,
  };
}

function matrixRank(columns: number[][]): number {
  const basis: number[][] = [];
  for (const column of columns) {
    const residual = column.slice();
    for (const vector of basis) {
      const coeff = dot(residual, vector);
      for (let i = 0; i < residual.length; i++) residual[i] -= coeff * vector[i];
    }
    const residualNorm = vectorNorm(residual);
    const columnNorm = vectorNorm(column);
    if (residualNorm > RANK_EPSILON * Math.max(1, columnNorm)) {
      for (let i = 0; i < residual.length; i++) residual[i] /= residualNorm;
      basis.push(residual);
    }
  }
  return basis.length;
}

function cosine(a: number[], b: number[]): number {
  return dot(a, b) / (vectorNorm(a) * vectorNorm(b));
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function vectorNorm(values: number[]): number {
  return Math.sqrt(dot(values, values));
}
