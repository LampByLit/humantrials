export type Vec3 = { x: number; y: number; z: number };

const DEADZONE = 0.000002;
// Liquid that no longer fits under the lip leaves within about this long. Without it the
// weir term alone makes wide, shallow vessels such as trays dribble instead of pour.
const OVERFLOW_DRAIN_TIME = 0.3;

export function cylinderCapacity(radius: number, height: number) {
  return Math.PI * radius * radius * height;
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function simpson(fn: (u: number) => number, a: number, b: number, n: number) {
  const h = (b - a) / n;
  let sum = fn(a) + fn(b);
  for (let i = 1; i < n; i++) sum += fn(a + i * h) * (i % 2 === 0 ? 2 : 4);
  return (sum * h) / 3;
}

/**
 * Volume of a capped cylinder sitting below a plane.
 * `up` is world-up in the beaker's local frame (unit). The plane is `up · p = d`,
 * and liquid is the side with the smaller dot product. The cylinder runs along
 * local Y from -half to +half; the opening is the disc at +half.
 */
export function liquidVolume(up: Vec3, d: number, radius: number, half: number) {
  const n = normalize(up);
  const horiz = Math.hypot(n.x, n.z);
  const chord = (u: number) => 2 * Math.sqrt(Math.max(0, radius * radius - u * u));

  if (n.y > 0.08) {
    const y0 = d / n.y;
    const slope = horiz / n.y;
    return simpson((u) => {
      const yTop = Math.min(half, y0 - slope * u);
      return Math.max(0, yTop + half) * chord(u);
    }, -radius, radius, 64);
  }

  if (n.y < -0.08) {
    const y0 = d / n.y;
    const slope = horiz / n.y;
    return simpson((u) => {
      const yMin = Math.max(-half, y0 - slope * u);
      return Math.max(0, half - yMin) * chord(u);
    }, -radius, radius, 64);
  }

  const limit = horiz < 1e-8 ? (d >= 0 ? radius : -radius - 1) : d / horiz;
  return simpson((u) => (u <= limit ? chord(u) * half * 2 : 0), -radius, radius, 64);
}

export type Surface = {
  /** Plane constant in beaker-local space. Liquid is `up · p <= plane`. */
  plane: number;
  overflow: number;
  up: Vec3;
};

export function solveSurface(up: Vec3, volume: number, radius: number, half: number): Surface {
  const n = normalize(up);
  const horiz = Math.hypot(n.x, n.z);
  const dSpill = n.y * half - horiz * radius;
  const dEmpty = -Math.abs(n.y) * half - horiz * radius;
  if (volume <= 1e-9) return { plane: dEmpty, overflow: 0, up: n };

  const vMax = liquidVolume(n, dSpill, radius, half);
  if (volume >= vMax) return { plane: dSpill, overflow: Math.max(0, volume - vMax), up: n };

  let lo = dEmpty;
  let hi = dSpill;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) * 0.5;
    if (liquidVolume(n, mid, radius, half) < volume) lo = mid;
    else hi = mid;
  }
  return { plane: hi, overflow: 0, up: n };
}

/** Weir flow in m³/s for liquid that cannot fit under the lip. */
export function pourFlow(overflow: number, radius: number) {
  const headroom = overflow - DEADZONE;
  if (headroom <= 0) return 0;
  const area = Math.PI * radius * radius;
  const head = headroom / area;
  const width = Math.min(2 * radius, 2 * Math.sqrt(Math.max(0, radius * head)));
  const weir = 1.65 * Math.max(width, 0.004) * Math.pow(head, 1.5);
  return Math.min(Math.max(weir, headroom / OVERFLOW_DRAIN_TIME), 0.0025);
}

/** Lowest point on the opening rim, in beaker-local space. */
export function lowestRim(up: Vec3, radius: number, half: number): Vec3 {
  const n = normalize(up);
  const horiz = Math.hypot(n.x, n.z);
  if (horiz < 1e-6) return { x: radius, y: half, z: 0 };
  return { x: (-n.x / horiz) * radius, y: half, z: (-n.z / horiz) * radius };
}
