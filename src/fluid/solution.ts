export type Solution = {
  r: number;
  g: number;
  b: number;
  volume: number;
};

export function solutionFromHex(hex: number, volume: number): Solution {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
    volume,
  };
}

/** Mass-weighted channel average. Volume stands in for mass at uniform density. */
export function mixIn(dst: Solution, r: number, g: number, b: number, volume: number) {
  if (volume <= 0) return;
  const next = dst.volume + volume;
  if (dst.volume <= 1e-9) {
    dst.r = r;
    dst.g = g;
    dst.b = b;
    dst.volume = volume;
    return;
  }
  dst.r = (dst.r * dst.volume + r * volume) / next;
  dst.g = (dst.g * dst.volume + g * volume) / next;
  dst.b = (dst.b * dst.volume + b * volume) / next;
  dst.volume = next;
}
