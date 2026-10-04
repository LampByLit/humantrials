export type Solution = {
  hex: string;
  mass: number;
  volume: number;
};

export type Water = {
  volume: number;
};

export type Compound = {
  hex: string;
  r: number;
  g: number;
  b: number;
  x: number;
  y: number;
  hue: number;
  potency: number;
  purity: number;
  grayFloor: number;
};

const HEX = /^#([0-9a-fA-F]{6})$/;

export function derive(hex: string): Compound {
  const match = HEX.exec(hex);
  if (!match) throw new Error(`invalid hex: ${hex}`);
  const raw = match[1];
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const x = r - (g + b) / 2;
  const y = (Math.sqrt(3) / 2) * (g - b);
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const potency = Math.hypot(x, y);
  const purity = max === 0 ? 0 : (max - min) / max;
  return {
    hex: `#${raw.toUpperCase()}`,
    r,
    g,
    b,
    x,
    y,
    hue,
    potency,
    purity,
    grayFloor: min,
  };
}

export function solution(hex: string, mass: number, volume: number): Solution {
  if (mass < 0 || volume <= 0) throw new Error("solution needs non-negative mass and positive volume");
  return { hex: derive(hex).hex, mass, volume };
}

function fromChannels(r: number, g: number, b: number): string {
  const byte = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel * 255)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function complement(hex: string): string {
  const compound = derive(hex);
  const pivot = Math.max(compound.r, compound.g, compound.b) + Math.min(compound.r, compound.g, compound.b);
  return fromChannels(pivot - compound.r, pivot - compound.g, pivot - compound.b);
}

// A channel is the share of that light a compound lets through, so mixing multiplies them
// like dyes: blue and yellow make green. The floor stops a zero channel from wiping out
// that channel in any mix it touches.
export const CHANNEL_FLOOR = 0.03;

/** Mass-weighted geometric mean of two channel values. */
export function mixChannel(a: number, aMass: number, b: number, bMass: number): number {
  if (aMass <= 0) return b;
  if (bMass <= 0) return a;
  const log = (channel: number) => Math.log(Math.max(CHANNEL_FLOOR, channel));
  return Math.exp((log(a) * aMass + log(b) * bMass) / (aMass + bMass));
}

export function mix(a: Solution, b: Solution): Solution {
  const mass = a.mass + b.mass;
  const volume = a.volume + b.volume;
  if (mass <= 0) throw new Error("mix needs positive mass");
  const left = derive(a.hex);
  const right = derive(b.hex);
  const channel = (from: number, to: number) => mixChannel(from, a.mass, to, b.mass);
  return {
    hex: fromChannels(channel(left.r, right.r), channel(left.g, right.g), channel(left.b, right.b)),
    mass,
    volume,
  };
}

export function refine(input: Solution): Solution {
  const compound = derive(input.hex);
  const max = Math.max(compound.r, compound.g, compound.b);
  const min = Math.min(compound.r, compound.g, compound.b);
  if (max === min) throw new Error("cannot refine a gray compound");
  const scale = max / (max - min);
  return {
    hex: fromChannels((compound.r - min) * scale, (compound.g - min) * scale, (compound.b - min) * scale),
    mass: input.mass * compound.purity,
    volume: input.volume,
  };
}

export function water(volume: number): Water {
  if (volume < 0) throw new Error("water volume must be non-negative");
  return { volume };
}

export function dilute(input: Solution, source: Water, volumeAdded: number): { solution: Solution; water: Water } {
  if (volumeAdded <= 0 || volumeAdded > source.volume) throw new Error("dilute volume is outside the water");
  return {
    solution: { hex: input.hex, mass: input.mass, volume: input.volume + volumeAdded },
    water: { volume: source.volume - volumeAdded },
  };
}

export function draw(input: Solution, volumeDrawn: number): { mass: number; solution: Solution } {
  if (volumeDrawn <= 0 || volumeDrawn > input.volume) throw new Error("draw volume is outside the solution");
  const mass = (input.mass / input.volume) * volumeDrawn;
  return {
    mass,
    solution: {
      hex: input.hex,
      mass: input.mass - mass,
      volume: input.volume - volumeDrawn,
    },
  };
}
