import { chemLabel, latinName } from "../sim/colorName";
import { derive } from "../sim/compound";
import { STOCK_CONCENTRATION, toChem, type Solution } from "./solution";

export type Spec = { label: string; value: string };

export type Readout = {
  title: string;
  latin: string;
  hex: string;
  solute: Spec[];
  liquid: Spec[];
};

const DASH = "—";

const SOLUTE = ["hue", "potency", "purity", "gray", "x", "y", "r", "g", "b"];
const LIQUID = ["mass", "vol", "conc", "stock", "cloud"];

function blank(labels: string[]): Spec[] {
  return labels.map((label) => ({ label, value: DASH }));
}

export function blankReadout(): Readout {
  return { title: DASH, latin: DASH, hex: DASH, solute: blank(SOLUTE), liquid: blank(LIQUID) };
}

function fixed(n: number, digits: number): string {
  return n.toFixed(digits);
}

function formatMass(mass: number): string {
  if (mass >= 10) return mass.toFixed(1);
  if (mass >= 1) return mass.toFixed(2);
  return mass.toFixed(3);
}

function formatVolume(cubicMetres: number): string {
  const millilitres = cubicMetres * 1e6;
  if (millilitres >= 1000) return `${(millilitres / 1000).toFixed(2)} L`;
  if (millilitres >= 100) return `${millilitres.toFixed(1)} mL`;
  return `${millilitres.toFixed(2)} mL`;
}

function liquidSpecs(solution: Solution): Spec[] {
  const volume = solution.volume;
  const empty = volume <= 1e-12;
  const perLitre = empty ? 0 : solution.mass / volume / 1000;
  const stock = empty ? 0 : solution.mass / volume / STOCK_CONCENTRATION;
  const cloud = empty ? 0 : solution.cloud / volume;
  return [
    { label: "mass", value: formatMass(solution.mass) },
    { label: "vol", value: empty ? DASH : formatVolume(volume) },
    { label: "conc", value: empty ? DASH : `${fixed(perLitre, 2)} /L` },
    { label: "stock", value: empty ? DASH : `${fixed(stock, 2)}×` },
    { label: "cloud", value: empty ? DASH : `${Math.round(cloud * 100)}%` },
  ];
}

/** Name, Latin, hex, the compound's derived measures, and every liquid property. */
export function substanceReadout(solution: Solution): Readout {
  const named = solution.mass > 1e-8;
  if (!named) {
    return { title: "water", latin: DASH, hex: DASH, solute: blank(SOLUTE), liquid: liquidSpecs(solution) };
  }
  const hex = toChem(solution).hex;
  const compound = derive(hex);
  return {
    title: chemLabel(hex),
    latin: latinName(hex),
    hex,
    solute: [
      { label: "hue", value: `${fixed(compound.hue, 1)}°` },
      { label: "potency", value: fixed(compound.potency, 3) },
      { label: "purity", value: fixed(compound.purity, 3) },
      { label: "gray", value: fixed(compound.grayFloor, 3) },
      { label: "x", value: fixed(compound.x, 3) },
      { label: "y", value: fixed(compound.y, 3) },
      { label: "r", value: fixed(compound.r, 3) },
      { label: "g", value: fixed(compound.g, 3) },
      { label: "b", value: fixed(compound.b, 3) },
    ],
    liquid: liquidSpecs(solution),
  };
}
