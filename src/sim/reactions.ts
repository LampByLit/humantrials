// Catalog substances push named organs directly. Hue tuning is for every other hex.
// Coefficients are drive per unit of mass already in the blood. A 10mL stock sip
// arrives as about 0.06. Fade multiplies clearance: nicotine leaves quickly, a toxin stays.

export type Profile = {
  heart: number;
  brain: number;
  liver: number;
  fade: number;
  shake: number;
  spasm: number;
  pound: number;
  sway: number;
  blur: number;
  slow: number;
  numb: number;
  wash: number;
  tint: readonly [number, number, number];
  flush: number;
  skin: readonly [number, number, number];
  pulse: number;
  // Open-eye color hallucination. Surfaces shift hue and pick up fringe color.
  trip: number;
  // The room breathes and the field of view narrows. Dissociation, not a convulsion.
  drift: number;
  // Anticholinergic delirium: gray, unstable, things slip.
  mud: number;
};

export type Sense = {
  shake: number;
  spasm: number;
  pound: number;
  rate: number;
  tint: readonly [number, number, number];
  wash: number;
  skin: readonly [number, number, number];
  flush: number;
  vignette: number;
  sway: number;
  blur: number;
  move: number;
  operate: number;
  pulse: number;
  trip: number;
  drift: number;
  mud: number;
};

const BLACK: readonly [number, number, number] = [0, 0, 0];
const FLUSH: readonly [number, number, number] = [0.86, 0.32, 0.24];
const PALE: readonly [number, number, number] = [0.72, 0.78, 0.84];
const JAUNDICE: readonly [number, number, number] = [0.78, 0.68, 0.28];
const WARM: readonly [number, number, number] = [1, 0.45, 0.15];
const PSY: readonly [number, number, number] = [0.72, 0.12, 0.95];
const SLEEP: readonly [number, number, number] = [0.12, 0.16, 0.42];
const SICK: readonly [number, number, number] = [0.35, 0.72, 0.22];
const OPIOID: readonly [number, number, number] = [0.42, 0.32, 0.55];
const BURN: readonly [number, number, number] = [0.95, 0.18, 0.08];

function drug(heart: number, brain: number, liver: number, extra: Partial<Profile> = {}): Profile {
  return {
    heart,
    brain,
    liver,
    fade: 1,
    shake: 0,
    spasm: 0,
    pound: 0,
    sway: 0,
    blur: 0,
    slow: 0,
    numb: 0,
    wash: 0,
    tint: BLACK,
    flush: 0,
    skin: BLACK,
    pulse: 0,
    trip: 0,
    drift: 0,
    mud: 0,
    ...extra,
  };
}

const profiles: Record<string, Profile> = {
  "#FFFFFF": drug(0, 0, 0),
  "#FF9900": drug(2.4, 2.2, 0.3, { shake: 2.2, pound: 2.4, wash: 1.2, tint: WARM, flush: 1.6, skin: FLUSH }),
  "#CC00FF": drug(0, -0.15, -1.8, { numb: 1.4, wash: 0.4, tint: [0.55, 0.4, 0.7] }),
  "#6600FF": drug(-3.6, -7.2, -0.4, { blur: 8, slow: 7, numb: 10, sway: 2, wash: 3, tint: OPIOID, flush: 2, skin: PALE }),
  "#FFE8A0": drug(0.35, 0.55, 0, { pound: 0.3, wash: 0.2, tint: WARM }),
  // A swallow is a long color trip with a warm, faster heart. Seizure is an overdose, not the dose.
  "#FFCC00": drug(0.55, 0.65, 0, {
    fade: 0.32,
    shake: 0.35,
    wash: 1.6,
    tint: PSY,
    flush: 0.45,
    skin: [0.9, 0.5, 0.48],
    trip: 16,
    drift: 4,
  }),
  // A short blast. The body stays upright; the eyes do not.
  "#FFDD33": drug(0.45, 0.8, 0, {
    fade: 2.4,
    shake: 0.2,
    wash: 5,
    tint: PSY,
    flush: 0.3,
    skin: [0.86, 0.42, 0.62],
    trip: 90,
    drift: 70,
  }),
  "#FF6600": drug(4.4, 3.8, -0.2, { shake: 4, pound: 4.5, wash: 2, tint: WARM, flush: 3, skin: FLUSH }),
  "#66FF99": drug(0, 0.1, 0.7),
  "#FF66AA": drug(0, 0.15, 0.25),
  "#FFE0A0": drug(0, 0.05, 0.15),
  "#FF5500": drug(2.8, 3.4, 0, { shake: 3.2, pound: 2.2, wash: 1.4, tint: WARM, flush: 1.8, skin: FLUSH }),
  "#FF4400": drug(3.6, 4.4, -0.3, { shake: 4.5, spasm: 1.5, pound: 3, wash: 1.8, tint: WARM, flush: 2.4, skin: FLUSH }),
  "#FF7722": drug(1.8, 2.8, 0, { fade: 3.5, shake: 2.4, pound: 1.6, wash: 0.8, tint: WARM }),
  "#FFAA22": drug(1.4, 2.6, 0, { shake: 1.6, pound: 0.8, wash: 0.6, tint: WARM }),
  "#FFBB44": drug(0.4, 2.2, 0.3, { shake: 0.6, wash: 0.3, tint: [1, 0.85, 0.4] }),
  "#E8A060": drug(1.2, 1.0, 0.2, { pound: 0.8, wash: 0.4, tint: WARM }),
  "#4466CC": drug(-0.7, -2.4, -0.9, { sway: 4, blur: 3, slow: 2.2, wash: 1.6, tint: SLEEP, flush: 1.2, skin: [0.8, 0.45, 0.45] }),
  "#5544AA": drug(-0.3, -2.6, 0, { blur: 2.4, slow: 1.6, sway: 1.2, numb: 1.2, wash: 1.4, tint: SLEEP }),
  "#333366": drug(-1.3, -3.8, -0.4, { blur: 4, slow: 3.5, sway: 1.5, wash: 2, tint: SLEEP, flush: 1, skin: PALE }),
  "#222288": drug(-1.5, -4.2, 0, { blur: 4.5, slow: 4, sway: 2, wash: 2, tint: SLEEP }),
  "#1A1A40": drug(-2.4, -6.8, 0, { blur: 7, slow: 7, numb: 4, wash: 2.5, tint: [0.05, 0.05, 0.12], flush: 1.5, skin: PALE }),
  // Sedating, but the heart runs fast, and a real dose turns the room gray and unsteady.
  "#5C5C8A": drug(0.8, -1.0, 0, {
    shake: 0.55,
    pound: 0.5,
    sway: 1.8,
    blur: 2.2,
    slow: 1,
    wash: 1.6,
    tint: [0.42, 0.4, 0.36],
    flush: 0.35,
    skin: [0.78, 0.62, 0.55],
    mud: 10,
  }),
  "#2A2A55": drug(-0.1, -1.1, 0, { fade: 0.7, blur: 1.2, slow: 0.6, wash: 0.8, tint: [0.15, 0.12, 0.35] }),
  "#FF2200": drug(5.8, 2.2, 0.2, { fade: 2.5, shake: 3, pound: 6, wash: 1.5, tint: BURN, flush: 4, skin: FLUSH }),
  "#FF8844": drug(3.4, 3.0, -0.2, { shake: 2, pound: 3.2, wash: 2.2, tint: [1, 0.35, 0.55], flush: 3, skin: FLUSH, pulse: 1.5 }),
  "#FF7744": drug(2.2, 0.9, 0, { pound: 1.6, flush: 1.2, skin: FLUSH }),
  "#9900CC": drug(-1.8, -3.8, -0.2, { blur: 3.5, slow: 3, numb: 4, wash: 1.8, tint: OPIOID, flush: 1, skin: PALE }),
  "#8800BB": drug(-2.6, -5.2, -0.3, { blur: 5, slow: 4.5, numb: 6, wash: 2, tint: OPIOID, flush: 1.4, skin: PALE }),
  "#AA22DD": drug(-1.7, -3.4, -0.2, { blur: 3, slow: 2.6, numb: 3.5, wash: 1.5, tint: OPIOID }),
  "#BB66EE": drug(-0.8, -1.9, 0, { blur: 1.6, slow: 1.2, numb: 2, wash: 0.8, tint: OPIOID }),
  "#DD88FF": drug(0, -0.1, -0.25, { numb: 0.8 }),
  "#CC66DD": drug(0, -0.1, -0.2, { numb: 0.7 }),
  // Dissociation: numb, unsteady, the room pulls away. Anesthesia if the dose keeps climbing.
  "#7744CC": drug(-0.35, -1.05, 0, {
    sway: 4,
    blur: 4.5,
    slow: 2,
    numb: 3.5,
    wash: 0.8,
    tint: [0.22, 0.2, 0.32],
    flush: 0.6,
    skin: PALE,
    drift: 12,
  }),
  "#AA88CC": drug(-0.5, -0.7, 0, { numb: 3.5, wash: 0.4, tint: [0.6, 0.55, 0.7] }),
  "#00CCAA": drug(0.9, 1.8, 0.5, { shake: 1.5, wash: 0.8, tint: [0.2, 0.9, 0.7] }),
  "#00CCCC": drug(-3.0, -0.3, 0, { slow: 0.8, wash: 0.6, tint: [0.2, 0.7, 0.75], flush: 1.5, skin: PALE }),
  "#008888": drug(-2.4, -1.3, 0, { slow: 1.2, blur: 0.8, flush: 1.2, skin: PALE }),
  "#00AA66": drug(0.5, -0.5, 0.2, { sway: 3.5, wash: 2.5, tint: SICK, flush: 1.5, skin: [0.65, 0.75, 0.4] }),
  "#33CC66": drug(0.3, 0, 0, { spasm: 1.2, wash: 0.5, tint: SICK }),
  "#665522": drug(-0.5, -0.4, -4.8, { fade: 0.35, wash: 1.2, tint: JAUNDICE, flush: 3, skin: JAUNDICE }),
  "#88AA44": drug(0, 0, -2.4, { wash: 0.5, tint: [0.6, 0.7, 0.3] }),
  "#E8E8E8": drug(0, 0, 0),
  "#F0EDE4": drug(0, 0, 0),
  "#EEEEEE": drug(0, 0, 0),
  "#6666AA": drug(-1.1, -3.4, 0, { fade: 2, blur: 3.5, slow: 2.5, sway: 1.5, wash: 1.4, tint: SLEEP }),
  "#99CCFF": drug(0.2, -1.4, 0, { fade: 5, blur: 2, numb: 2.5, sway: 1.5, wash: 1, tint: [0.6, 0.8, 1] }),
  "#FF3300": drug(1.6, 0.8, 0, { shake: 2.5, spasm: 0.8, wash: 2, tint: BURN, flush: 4, skin: BURN, numb: 0.6 }),
  "#AAFF00": drug(2.2, 5.8, -0.5, { shake: 2, spasm: 8, pound: 1.5, wash: 1, tint: [0.8, 1, 0.2], flush: 1, skin: FLUSH }),
  "#CCFF00": drug(2.8, 1.8, 0, { shake: 1.4, pound: 2.4, wash: 0.7, tint: WARM, flush: 1.4, skin: FLUSH }),
};

function profileOf(hex: string): Profile | null {
  return profiles[hex.toUpperCase()] ?? null;
}

export function catalogDrive(hex: string, organ: "heart" | "brain" | "liver"): number | null {
  const profile = profileOf(hex);
  return profile ? profile[organ] : null;
}

export function catalogFade(hex: string): number {
  return profileOf(hex)?.fade ?? 1;
}

export const MILK_HEX = "#FFFFFF";
// Aflatoxin and strychnine are not the sort of poisoning milk can wash out.
const BEYOND_MILK = new Set(["#665522", "#AAFF00"]);

// 1 is no milk. A swallowed sip pulls this toward 0 and dulls most other drives.
export function milkScale(doses: readonly { hex: string; mass: number }[]): number {
  let mass = 0;
  for (const dose of doses) if (dose.hex.toUpperCase() === MILK_HEX) mass += dose.mass;
  return Math.exp(-mass * 22);
}

export function milkReaches(hex: string): boolean {
  return !BEYOND_MILK.has(hex.toUpperCase());
}

export const catalogHexes = Object.keys(profiles);

type Reading = { name: string; deflection: number };

export function senseOf(organs: readonly Reading[], doses: readonly { hex: string; mass: number }[], alive: boolean): Sense {
  if (!alive) {
    return {
      shake: 0,
      spasm: 0,
      pound: 0,
      rate: 0,
      tint: [0.04, 0.05, 0.08],
      wash: 0.9,
      skin: [0.42, 0.46, 0.5],
      flush: 0.9,
      vignette: 1,
      sway: 0,
      blur: 0.45,
      move: 0,
      operate: 0,
      pulse: 0,
      trip: 0,
      drift: 0,
      mud: 0,
    };
  }

  const deflection = (name: string) => organs.find((organ) => organ.name === name)?.deflection ?? 0;
  const heart = deflection("heart");
  const brain = deflection("brain");
  const liver = deflection("liver");
  const up = (value: number) => Math.max(0, value);
  const down = (value: number) => Math.max(0, -value);

  let shake = up(brain) * 0.85 + up(heart) * 0.3;
  let spasm = up(brain) * 0.35;
  let pound = up(heart) * 1.05;
  let sway = down(brain) * 0.45;
  let blur = down(brain) * 1.05;
  let slow = down(brain) * 1.25 + down(heart) * 0.45;
  let numb = down(brain) * 0.55;
  let pulse = 0;
  let trip = 0;
  let drift = 0;
  let mud = 0;

  let tr = 0;
  let tg = 0;
  let tb = 0;
  let tw = 0;
  const addWash = (color: readonly [number, number, number], weight: number) => {
    if (weight <= 0) return;
    tr += color[0] * weight;
    tg += color[1] * weight;
    tb += color[2] * weight;
    tw += weight;
  };
  addWash(WARM, up(brain) * 0.25 + up(heart) * 0.35);
  addWash(SLEEP, down(brain) * 0.7 + down(heart) * 0.4);
  addWash(JAUNDICE, down(liver) * 0.8);

  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sw = 0;
  const addSkin = (color: readonly [number, number, number], weight: number) => {
    if (weight <= 0) return;
    sr += color[0] * weight;
    sg += color[1] * weight;
    sb += color[2] * weight;
    sw += weight;
  };
  addSkin(FLUSH, up(heart) * 0.9);
  addSkin(PALE, down(heart) * 1.1);
  addSkin(JAUNDICE, down(liver) * 1.3);

  let mph = 0;
  const softened = milkScale(doses);
  for (const dose of doses) {
    if (dose.hex.toUpperCase() === "#C93F38") {
      mph += dose.mass;
      continue;
    }
    const profile = profileOf(dose.hex);
    if (!profile || dose.mass <= 0) continue;
    const mass = dose.mass * (milkReaches(dose.hex) ? softened : 1);
    shake += profile.shake * mass;
    spasm += profile.spasm * mass;
    pound += profile.pound * mass;
    sway += profile.sway * mass;
    blur += profile.blur * mass;
    slow += profile.slow * mass;
    numb += profile.numb * mass;
    pulse = Math.max(pulse, profile.pulse * mass);
    trip += profile.trip * mass;
    drift += profile.drift * mass;
    mud += profile.mud * mass;
    addWash(profile.tint, profile.wash * mass);
    addSkin(profile.skin, profile.flush * mass);
  }

  const sat = (value: number) => 1 - Math.exp(-Math.max(0, value));
  // Psychedelic visuals need headroom. A swallow of DMT approaches the ceiling; LSD stays well under it.
  const open = (value: number, ceiling: number) => ceiling * (1 - Math.exp(-Math.max(0, value) / ceiling));
  const tint = tw > 0 ? ([tr / tw, tg / tw, tb / tw] as const) : BLACK;
  const skin = sw > 0 ? ([sr / sw, sg / sw, sb / sw] as const) : BLACK;
  const red = 1 - Math.exp(-mph * 40);
  return {
    shake: sat(shake),
    spasm: sat(spasm),
    pound: sat(pound),
    rate: Math.max(0.35, 1.15 + heart * 1.7),
    tint: red > 0 ? ([0.82, 0.02, 0.02] as const) : tint,
    wash: Math.max(sat(tw), red),
    skin,
    flush: sat(sw),
    vignette: sat(down(heart) * 1.3 + down(brain) * 0.65),
    sway: sat(sway),
    blur: sat(blur),
    move: 1 - sat(slow),
    operate: 1 - sat(numb),
    pulse,
    trip: open(trip, 5.5),
    drift: open(drift, 3),
    mud: sat(mud),
  };
}
