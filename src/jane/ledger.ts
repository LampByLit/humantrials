import { analogOf } from "../sim/analogs";
import { chemLabel } from "../sim/colorName";
import { swatches } from "../sim/labStock";
import { createRng } from "../sim/rng";
import { STOCK_CONCENTRATION } from "../fluid/solution";
import catalog from "../../concept/chems.json";
import { cents } from "./format";
import { blueReason, blueReport, greenReason, greenReport, type BlueReport, type GreenReport } from "./lines";
import { priceOf, priceOfFill, type Fill } from "./prices";

// A stock litre is the mass in one litre at shelf strength. Dilution keeps the hex
// and lowers the mass, so a thin litre credits less than a shelf litre.
export const MASS_PER_LITRE = STOCK_CONCENTRATION / 1000;

export type Sample = { hex: string; mass: number; volume: number };

export type Contract = {
  faction: "green" | "blue";
  hex: string;
  name: string;
  litres: number;
  filled: number;
  pricePerLitre: number;
  allowAnalogs: boolean;
  reason: string;
  generation: number;
};

export type Ledger = {
  credits: number;
  green: Contract;
  blue: Contract;
  awaitingReward: boolean;
  rng: () => number;
};

const DUST = 0.005;

export function stockLitres(mass: number): number {
  return Math.max(0, mass) / MASS_PER_LITRE;
}

export function createLedger(seed: number): Ledger {
  return {
    credits: 500,
    rng: createRng(seed),
    awaitingReward: false,
    green: {
      faction: "green",
      hex: "#6600FF",
      name: "Fentanyl",
      litres: 1,
      filled: 0,
      pricePerLitre: 1000,
      allowAnalogs: true,
      reason: "They did not say for whom.",
      generation: 0,
    },
    blue: {
      faction: "blue",
      hex: "#398514",
      name: "Thy Flesh Consumed",
      litres: 1,
      filled: 0,
      pricePerLitre: 0,
      allowAnalogs: false,
      reason: "They answer in hexchem, not in money.",
      generation: 0,
    },
  };
}

function matchOf(hex: string, contract: Contract): { scale: number; cousin: boolean } {
  const key = hex.toUpperCase();
  if (key === contract.hex) return { scale: 1, cousin: false };
  const analog = analogOf(key);
  const cousin = !!analog && analog.parent === contract.hex;
  if (!contract.allowAnalogs || !cousin || !analog) return { scale: 0, cousin };
  return { scale: analog.scale, cousin: true };
}

function pickNamed(rng: () => number, avoid: string): { hex: string; name: string } {
  const pool = swatches();
  for (let attempt = 0; attempt < 12; attempt++) {
    const swatch = pool[Math.floor(rng() * pool.length)];
    const hex = `#${(swatch.hex & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
    if (hex === avoid) continue;
    return { hex, name: chemLabel(hex) };
  }
  return { hex: "#FF0000", name: chemLabel("#FF0000") };
}

function pickBlue(rng: () => number, avoid: string): { hex: string; name: string } {
  if (rng() < 0.45) {
    const entry = catalog[Math.floor(rng() * catalog.length)];
    const hex = entry.hex.toUpperCase();
    if (hex !== avoid) return { hex, name: entry.name };
  }
  return pickNamed(rng, avoid);
}

function rollGreen(ledger: Ledger, avoid: string): Contract {
  const picked = pickNamed(ledger.rng, avoid);
  return {
    faction: "green",
    hex: picked.hex,
    name: picked.name,
    litres: 1,
    filled: 0,
    pricePerLitre: priceOf(picked.hex),
    allowAnalogs: true,
    reason: greenReason(picked.name, ledger.rng),
    generation: ledger.green.generation + 1,
  };
}

function rollBlue(ledger: Ledger, avoid: string): Contract {
  const picked = pickBlue(ledger.rng, avoid);
  return {
    faction: "blue",
    hex: picked.hex,
    name: picked.name,
    litres: 1,
    filled: 0,
    pricePerLitre: 0,
    allowAnalogs: false,
    reason: blueReason(picked.name, ledger.rng),
    generation: ledger.blue.generation + 1,
  };
}

export type Submission = { pay: number; line: string; note: string };

export function submitSamples(ledger: Ledger, faction: "green" | "blue", samples: Sample[]): Submission {
  const contract = faction === "green" ? ledger.green : ledger.blue;
  let exact = 0;
  let analog = 0;
  let rejected = 0;
  let cousins = 0;
  let surplus = 0;
  let pay = 0;
  for (const sample of samples) {
    const matched = matchOf(sample.hex, contract);
    const raw = stockLitres(sample.mass);
    const worth = raw * matched.scale;
    if (matched.cousin && matched.scale <= 0) cousins += 1;
    if (worth < DUST) {
      rejected += 1;
      continue;
    }
    const room = contract.litres - contract.filled;
    if (room <= DUST) {
      surplus += worth;
      continue;
    }
    const credit = Math.min(worth, room);
    contract.filled += credit;
    pay += credit * contract.pricePerLitre;
    if (matched.scale === 1) exact += credit;
    else analog += credit;
    if (worth - credit > DUST) surplus += worth - credit;
  }
  pay = cents(pay);
  ledger.credits = cents(ledger.credits + pay);
  const left = Math.max(0, contract.litres - contract.filled);
  const complete = contract.filled >= contract.litres - DUST;
  if (faction === "green") {
    const report: GreenReport = {
      name: contract.name,
      exact,
      analog,
      rejected,
      surplus,
      pay,
      left,
      complete,
      next: null,
    };
    if (complete) {
      const next = rollGreen(ledger, contract.hex);
      ledger.green = next;
      report.next = { name: next.name, price: next.pricePerLitre, reason: next.reason };
    }
    return {
      pay,
      line: greenReport(report),
      note: pay > 0 ? `Green paid ${pay} for ${contract.name}.` : `Green refused a submission toward ${contract.name}.`,
    };
  }
  const report: BlueReport = { name: contract.name, hex: contract.hex, exact, cousins, rejected, left, complete };
  if (complete) ledger.awaitingReward = true;
  return {
    pay: 0,
    line: blueReport(report),
    note: complete ? `Blue accepted the litre of ${contract.name}.` : `Blue counted ${exact.toFixed(2)} L of ${contract.name}.`,
  };
}

export function tryOrder(
  ledger: Ledger,
  fill: Fill,
  litres: number,
): { ok: true; cost: number } | { ok: false; cost: number } {
  const cost = cents(priceOfFill(fill) * litres);
  if (ledger.credits + 0.001 < cost) return { ok: false, cost };
  ledger.credits = cents(ledger.credits - cost);
  return { ok: true, cost };
}

export type Reward = { fill: Fill; name: string; nextName: string; reason: string };

export function acceptReward(ledger: Ledger, fill: Fill, name: string): Reward | null {
  if (!ledger.awaitingReward) return null;
  ledger.awaitingReward = false;
  const next = rollBlue(ledger, ledger.blue.hex);
  ledger.blue = next;
  return { fill, name, nextName: next.name, reason: next.reason };
}
