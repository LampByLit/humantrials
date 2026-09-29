import type { Solution as ChemSolution } from "../sim/compound";

// Liquid as the fluid sim carries it. The channels are the solute's hex identity and
// mass is how much solute there is; water is volume with no mass, so it dilutes without
// changing the hex (concept/chems-health.md 2.2-2.3).
export type Solution = {
  r: number;
  g: number;
  b: number;
  mass: number;
  volume: number;
};

export function solutionFromHex(hex: number, volume: number, concentration: number): Solution {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
    mass: volume * concentration,
    volume,
  };
}

export function water(volume: number): Solution {
  return { r: 1, g: 1, b: 1, mass: 0, volume };
}

/** Solute mass carried by `volume` drawn from a well-mixed solution. */
export function massIn(solution: Solution, volume: number) {
  return solution.volume > 1e-12 ? (solution.mass * volume) / solution.volume : 0;
}

/** Masses and volumes add; the hex is the mass-weighted average of the channels. */
export function mixIn(dst: Solution, r: number, g: number, b: number, mass: number, volume: number) {
  if (volume <= 0 && mass <= 0) return;
  if (mass > 0) {
    const total = dst.mass + mass;
    if (dst.mass <= 1e-12) {
      dst.r = r;
      dst.g = g;
      dst.b = b;
    } else {
      dst.r = (dst.r * dst.mass + r * mass) / total;
      dst.g = (dst.g * dst.mass + g * mass) / total;
      dst.b = (dst.b * dst.mass + b * mass) / total;
    }
    dst.mass = total;
  }
  dst.volume += Math.max(0, volume);
}

export function toChem(solution: Solution): ChemSolution {
  const byte = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel * 255)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return {
    hex: `#${byte(solution.r)}${byte(solution.g)}${byte(solution.b)}`,
    mass: solution.mass,
    volume: solution.volume,
  };
}
