import catalog from "../../concept/chems.json";
import { config } from "./config";

// Each catalog hex owns 32 nearby colors. A cell goes to the closest catalog
// chemical. Once that chemical has its set, a neighbor that still needs analogs
// may take a free cell a little farther out.

export type Analog = {
  hex: string;
  parent: string;
  dr: number;
  dg: number;
  db: number;
  scale: number;
};

type Parent = { hex: string; r: number; g: number; b: number };

const parents: Parent[] = catalog.map((entry) => {
  const hex = entry.hex.toUpperCase();
  return {
    hex,
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
});

function hexOf(r: number, g: number, b: number) {
  const byte = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase();
}

function owner(r: number, g: number, b: number): Parent {
  let best = parents[0];
  let bestD = Infinity;
  for (const parent of parents) {
    const dr = parent.r - r;
    const dg = parent.g - g;
    const db = parent.b - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestD || (distance === bestD && parent.hex < best.hex)) {
      best = parent;
      bestD = distance;
    }
  }
  return best;
}

function scaleOf(distance: number) {
  const t = Math.min(1, distance / config.analogs.reach);
  return config.analogs.near + (config.analogs.far - config.analogs.near) * t;
}

function build() {
  const count = config.analogs.count;
  const step = config.analogs.step;
  const taken = new Set(parents.map((parent) => parent.hex));
  const buckets = new Map<string, Analog[]>(parents.map((parent) => [parent.hex, []]));

  const claim = (parent: Parent, r: number, g: number, b: number, relaxed: boolean) => {
    const bucket = buckets.get(parent.hex);
    if (!bucket || bucket.length >= count) return false;
    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return false;
    const hex = hexOf(r, g, b);
    if (taken.has(hex)) return false;
    const nearest = owner(r, g, b);
    if (nearest.hex !== parent.hex) {
      if (!relaxed) return false;
      const other = buckets.get(nearest.hex);
      if (other && other.length < count) return false;
    }
    taken.add(hex);
    const dr = r - parent.r;
    const dg = g - parent.g;
    const db = b - parent.b;
    bucket.push({ hex, parent: parent.hex, dr, dg, db, scale: scaleOf(Math.hypot(dr, dg, db)) });
    return true;
  };

  const sweep = (relaxed: boolean) => {
    for (let radius = step; radius <= 255; radius += step) {
      for (const parent of parents) {
        if ((buckets.get(parent.hex)?.length ?? 0) >= count) continue;
        for (let dr = -radius; dr <= radius; dr += step) {
          for (let dg = -radius; dg <= radius; dg += step) {
            if ((buckets.get(parent.hex)?.length ?? 0) >= count) break;
            for (let db = -radius; db <= radius; db += step) {
              if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) !== radius) continue;
              claim(parent, parent.r + dr, parent.g + dg, parent.b + db, relaxed);
              if ((buckets.get(parent.hex)?.length ?? 0) >= count) break;
            }
          }
        }
      }
      if ([...buckets.values()].every((bucket) => bucket.length >= count)) return;
    }
  };

  sweep(false);
  sweep(true);
  for (const [hex, bucket] of buckets) {
    if (bucket.length !== count) throw new Error(`${hex} has ${bucket.length} analogs`);
  }
  const byHex = new Map<string, Analog>();
  for (const bucket of buckets.values()) for (const analog of bucket) byHex.set(analog.hex, analog);
  return { buckets, byHex };
}

const built = build();

export function analogOf(hex: string): Analog | null {
  return built.byHex.get(hex.toUpperCase()) ?? null;
}

export function analogsOf(parent: string): readonly Analog[] {
  return built.buckets.get(parent.toUpperCase()) ?? [];
}

export function isAnalog(hex: string): boolean {
  return built.byHex.has(hex.toUpperCase());
}
