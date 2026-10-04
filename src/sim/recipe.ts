import { CHANNEL_FLOOR } from "./compound";

// Equal masses mix to the geometric mean of each channel (see mixChannel), so a recipe
// is found channel by channel: the bytes whose logs average to one that rounds back to
// the target byte.

const LOG = Array.from({ length: 256 }, (_, v) => Math.log(Math.max(CHANNEL_FLOOR, v / 255)));

/** Smallest byte whose log is at least `low`, or 256 if none. */
function lowest(low: number) {
  let lo = 0;
  let hi = 256;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (LOG[mid] >= low) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Bounds on the summed logs of `parts` bytes that mix to `target`. */
function bounds(target: number, parts: number) {
  const low = target <= 0.5 ? -Infinity : parts * Math.log((target - 0.5) / 255);
  const high = parts * Math.log((target + 0.5) / 255);
  return { low, high };
}

/** The smallest byte, up to `cap`, that brings `sum` into the window, or -1. */
function complete(sum: number, low: number, high: number, cap: number) {
  const byte = lowest(low - sum);
  return byte <= cap && sum + LOG[byte] < high ? byte : -1;
}

// Widest pair, so the two parts look as different as they can.
function pairFor(target: number): [number, number] | null {
  const { low, high } = bounds(target, 2);
  let best: [number, number] | null = null;
  for (let hi = 0; hi < 256; hi++) {
    const lo = complete(LOG[hi], low, high, hi);
    if (lo < 0) continue;
    if (!best || hi - lo > best[0] - best[1]) best = [hi, lo];
  }
  return best;
}

// Most evenly spaced triple, then the widest.
function tripleFor(target: number): [number, number, number] | null {
  const { low, high } = bounds(target, 3);
  let best: [number, number, number] | null = null;
  let bestGap = -1;
  for (let hi = 0; hi < 256; hi++) {
    for (let mid = 0; mid <= hi; mid++) {
      const lo = complete(LOG[hi] + LOG[mid], low, high, mid);
      if (lo < 0) continue;
      const gap = Math.min(hi - mid, mid - lo);
      if (gap > bestGap || (gap === bestGap && best && hi - lo > best[0] - best[2])) {
        best = [hi, mid, lo];
        bestGap = gap;
      }
    }
  }
  return best;
}

function bytesOf(hex: string) {
  const raw = hex.replace("#", "");
  return [0, 2, 4].map((at) => parseInt(raw.slice(at, at + 2), 16));
}

function hexOf(bytes: number[]) {
  return `#${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Two different hexes that mix to `hex` in equal parts, or null if none can. */
export function twoParts(hex: string): [string, string] | null {
  const pairs = bytesOf(hex).map(pairFor);
  if (pairs.some((pair) => !pair)) return null;
  const parts = [0, 1].map((at) => hexOf(pairs.map((pair) => pair![at])));
  return parts[0] === parts[1] ? null : [parts[0], parts[1]];
}

/** Three different hexes that mix to `hex` in equal parts, or null if none can. */
export function threeParts(hex: string): [string, string, string] | null {
  const triples = bytesOf(hex).map(tripleFor);
  if (triples.some((triple) => !triple)) return null;
  const parts = [0, 1, 2].map((at) => hexOf(triples.map((triple) => triple![at])));
  return new Set(parts).size === 3 ? [parts[0], parts[1], parts[2]] : null;
}

/** A hexchem no mix of different hexchems can make. */
export function isElemental(hex: string): boolean {
  return twoParts(hex) === null;
}
