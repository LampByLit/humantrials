import { config } from "./config";

// One short feeling, only after a marked drug has come and gone.
// Pairs fire when two of them were in the blood together. Anything else leaves nothing.

const SINGLE: Record<string, string> = {
  "#FF6600": "flat",
  "#FF4400": "flat",
  "#FF8844": "tender",
  "#FFCC00": "still",
  "#6600FF": "hollow",
  "#8800BB": "hollow",
  "#9900CC": "hollow",
  "#7744CC": "far",
};

const PAIRS: readonly { a: string; b: string; text: string }[] = [
  { a: "#FF6600", b: "#4466CC", text: "frayed" },
  { a: "#FF4400", b: "#4466CC", text: "frayed" },
  { a: "#FF5500", b: "#4466CC", text: "frayed" },
  { a: "#FF8844", b: "#FFCC00", text: "open" },
  { a: "#FF8844", b: "#4466CC", text: "spent" },
  { a: "#6600FF", b: "#4466CC", text: "adrift" },
  { a: "#8800BB", b: "#4466CC", text: "adrift" },
  { a: "#9900CC", b: "#4466CC", text: "adrift" },
  { a: "#6600FF", b: "#5544AA", text: "adrift" },
  { a: "#8800BB", b: "#5544AA", text: "adrift" },
  { a: "#FF6600", b: "#6600FF", text: "uneven" },
  { a: "#FF4400", b: "#8800BB", text: "uneven" },
  { a: "#FF5500", b: "#9900CC", text: "uneven" },
];

type Trace = {
  peak: number;
  with: string[];
  spent: boolean;
  down: boolean;
};

export type Affect = {
  traces: Record<string, Trace>;
  line: string | null;
  left: number;
  quiet: number;
};

export function createAffect(): Affect {
  return { traces: {}, line: null, left: 0, quiet: 0 };
}

export function stepAffect(affect: Affect, doses: readonly { hex: string; mass: number }[], dt: number): string | null {
  const live = new Set<string>();
  for (const dose of doses) {
    const hex = dose.hex.toUpperCase();
    if (hex === "#FFFFFF" || hex === "#C93F38" || dose.mass < config.affect.live) continue;
    live.add(hex);
    const trace = affect.traces[hex] ?? { peak: 0, with: [], spent: false, down: false };
    if (trace.down && trace.spent) {
      trace.peak = 0;
      trace.with = [];
      trace.spent = false;
      trace.down = false;
    }
    trace.peak = Math.max(trace.peak, dose.mass);
    for (const other of live) {
      if (other !== hex && !trace.with.includes(other)) trace.with.push(other);
    }
    trace.down = false;
    affect.traces[hex] = trace;
  }

  for (const hex of live) {
    const trace = affect.traces[hex];
    for (const other of live) {
      if (other !== hex && !trace.with.includes(other)) trace.with.push(other);
    }
  }

  for (const [hex, trace] of Object.entries(affect.traces)) {
    if (live.has(hex)) continue;
    const mass = massOf(doses, hex);
    if (mass >= config.affect.echo) continue;
    trace.down = true;
    if (trace.spent || trace.peak < config.affect.peak) continue;
    trace.spent = true;
    const phrase = aftermath(hex, trace, affect.traces);
    if (!phrase || affect.quiet > 0 || affect.line) continue;
    affect.line = phrase;
    affect.left = config.affect.hold;
    affect.quiet = config.affect.quiet;
  }

  if (affect.left > 0) {
    affect.left = Math.max(0, affect.left - dt);
    if (affect.left === 0) affect.line = null;
  }
  if (affect.quiet > 0) affect.quiet = Math.max(0, affect.quiet - dt);
  return affect.line;
}

function aftermath(hex: string, trace: Trace, traces: Record<string, Trace>): string | null {
  for (const pair of PAIRS) {
    const other = pair.a === hex ? pair.b : pair.b === hex ? pair.a : null;
    if (!other || !trace.with.includes(other)) continue;
    const mate = traces[other];
    if (!mate || mate.peak < config.affect.peak) continue;
    mate.spent = true;
    return pair.text;
  }
  return SINGLE[hex] ?? null;
}

function massOf(doses: readonly { hex: string; mass: number }[], hex: string) {
  let mass = 0;
  for (const dose of doses) if (dose.hex.toUpperCase() === hex) mass += dose.mass;
  return mass;
}
