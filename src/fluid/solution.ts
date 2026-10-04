import { mixChannel, type Solution as ChemSolution } from "../sim/compound";

// Solute mass per cubic metre of stock solution: 10 per litre, so a 10mL draw is a dose
// of 0.1 against the body's deflection scale of 1. A stock shows its hex exactly.
export const STOCK_CONCENTRATION = 10000;

// Liquid as the fluid sim carries it. The channels are the solute's hex identity and
// mass is how much solute there is; water is volume with no mass, so it dilutes without
// changing the hex (concept/chems-health.md 2.2-2.3). Cloud is how much the liquid
// scatters light, as volume of milk-strength cloudiness; it plays no part in the chemistry.
export type Solution = {
  r: number;
  g: number;
  b: number;
  mass: number;
  cloud: number;
  volume: number;
};

export function solutionFromHex(hex: number, volume: number, concentration: number): Solution {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
    mass: volume * concentration,
    cloud: 0,
    volume,
  };
}

export function water(volume: number): Solution {
  return { r: 1, g: 1, b: 1, mass: 0, cloud: 0, volume };
}

/** A white compound that lets all light through, made opaque by scattering it. */
export function milk(volume: number): Solution {
  return { ...solutionFromHex(0xffffff, volume, STOCK_CONCENTRATION), cloud: volume };
}

/** What `volume` drawn from a well-mixed solution carries. */
export function portion(solution: Solution, volume: number): Solution {
  const share = solution.volume > 1e-12 ? volume / solution.volume : 0;
  return {
    r: solution.r,
    g: solution.g,
    b: solution.b,
    mass: solution.mass * share,
    cloud: solution.cloud * share,
    volume,
  };
}

/** Masses, cloud and volumes add; the hex mixes like dyes (see `mixChannel`). */
export function mixIn(dst: Solution, src: Solution) {
  if (src.mass > 0) {
    dst.r = mixChannel(dst.r, dst.mass, src.r, src.mass);
    dst.g = mixChannel(dst.g, dst.mass, src.g, src.mass);
    dst.b = mixChannel(dst.b, dst.mass, src.b, src.mass);
    dst.mass += src.mass;
  }
  dst.cloud += Math.max(0, src.cloud);
  dst.volume += Math.max(0, src.volume);
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
