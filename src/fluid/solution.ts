import { CHANNEL_FLOOR, mixChannel, type Solution as ChemSolution } from "../sim/compound";

// Solute mass per cubic metre of stock solution: 10 per litre, so a 10mL draw is a dose
// of 0.1 against the body's deflection scale of 1. A stock shows its hex exactly.
export const STOCK_CONCENTRATION = 10000;

// Liquid as the fluid sim carries it. The channels are the solute's hex identity and
// mass is how much solute there is; water is volume with no mass, so it dilutes without
// changing the hex (concept/chems-health.md 2.2-2.3). Appearance (ar, ag, ab) is that
// color in linear light, mixed like dyes so a pour looks like the liquids that went in.
// Cloud is how much the liquid scatters light, as volume of milk-strength cloudiness;
// it plays no part in the chemistry.
export type Solution = {
  r: number;
  g: number;
  b: number;
  ar: number;
  ag: number;
  ab: number;
  mass: number;
  cloud: number;
  volume: number;
};

// A zero channel would wipe every mix it touches. The floor is only used while mixing.
const MIX_FLOOR = 0.02;

function toLinear(channel: number): number {
  const c = Math.min(1, Math.max(0, channel));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toSrgb(channel: number): number {
  const c = Math.min(1, Math.max(0, channel));
  const shown = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, shown));
}

// One compound at `depth` stock-lengths. Stock is the hex itself; dilution fades toward clear.
function transmit(channel: number, depth: number): number {
  if (depth <= 1e-6) return 1;
  const shown = Math.abs(depth - 1) <= 1e-4 ? channel : Math.pow(Math.max(channel, CHANNEL_FLOOR), depth);
  return toLinear(Math.min(1, Math.max(0, shown)));
}

function geo(from: number, to: number, share: number): number {
  const log = (channel: number) => Math.log(Math.max(channel, MIX_FLOOR));
  return Math.exp(log(from) * (1 - share) + log(to) * share);
}

/** The color to draw, before milk's scatter. Stocks match their hex. */
export function visibleRgb(solution: Solution): [number, number, number] {
  return [toSrgb(solution.ar), toSrgb(solution.ag), toSrgb(solution.ab)];
}

export function solutionFromHex(hex: number, volume: number, concentration: number): Solution {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const depth = concentration / STOCK_CONCENTRATION;
  return {
    r,
    g,
    b,
    ar: transmit(r, depth),
    ag: transmit(g, depth),
    ab: transmit(b, depth),
    mass: volume * concentration,
    cloud: 0,
    volume,
  };
}

export function water(volume: number): Solution {
  return { r: 1, g: 1, b: 1, ar: 1, ag: 1, ab: 1, mass: 0, cloud: 0, volume };
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
    ar: solution.ar,
    ag: solution.ag,
    ab: solution.ab,
    mass: solution.mass * share,
    cloud: solution.cloud * share,
    volume,
  };
}

/** Masses, cloud and volumes add. The hex mixes like dyes; the color mixes in linear light. */
export function mixIn(dst: Solution, src: Solution) {
  if (src.mass > 0) {
    dst.r = mixChannel(dst.r, dst.mass, src.r, src.mass);
    dst.g = mixChannel(dst.g, dst.mass, src.g, src.mass);
    dst.b = mixChannel(dst.b, dst.mass, src.b, src.mass);
    dst.mass += src.mass;
  }
  const srcV = Math.max(0, src.volume);
  const total = dst.volume + srcV;
  if (srcV > 0 && total > 0) {
    if (dst.volume <= 1e-12) {
      dst.ar = src.ar;
      dst.ag = src.ag;
      dst.ab = src.ab;
    } else {
      const share = srcV / total;
      dst.ar = geo(dst.ar, src.ar, share);
      dst.ag = geo(dst.ag, src.ag, share);
      dst.ab = geo(dst.ab, src.ab, share);
    }
  }
  dst.cloud += Math.max(0, src.cloud);
  dst.volume += srcV;
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
