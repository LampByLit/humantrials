# Hex Chemistry: design spec for the coding agent

Paste this as project context. It describes a game simulation: a chemistry system where molecules are hex colors, and a body/health system that those chemicals act on. Code samples are JavaScript-style pseudocode. Port them to the project's language and follow the repo's existing conventions.

## Ground rules for the agent

- Treat this as the spec. Do not invent mechanics. Where something is marked **[Open]**, stop and ask instead of choosing.
- Status tags: **[Core]** is the original concept, **[Proposed]** is designed but not yet playtested, **[Open]** is undecided.
- Keep the simulation as pure functions with no rendering. Use a seeded RNG so a save is reproducible. Put every tunable number in one config object.
- Write unit tests for the invariants in section 8 as you build each system.
- Build the thin slice in section 9 first. Do not implement pathogens, tolerance, or extra organs until the slice plays well.

## 1. Premise [Core]

The player mixes chemicals to make molecules and medicines. They test them on rats, and they can take them personally, which affects their character. There are no traditional elements. The elements are red, green, and blue, and every molecule is a hex color (`#RRGGBB`). Effects on the character should be programmable and should resemble the symptoms of real drugs.

## 2. Chemistry model

### 2.1 Reading a hex

Channels `r, g, b` are in 0..1. Derive:

```js
const max = Math.max(r,g,b), min = Math.min(r,g,b);
const x = r - (g+b)/2;                    // chroma-plane coordinates,
const y = (Math.sqrt(3)/2) * (g - b);     // both linear in r,g,b
const hue = (Math.atan2(y,x) * 180/Math.PI + 360) % 360;  // red 0, yellow 60, green 120, cyan 180, blue 240, magenta 300
const potency = Math.hypot(x,y);          // 1.0 at primaries and secondaries, 0 at gray/white/black
const purity = max === 0 ? 0 : (max-min)/max;             // HSV saturation
const grayFloor = min;                    // inert filler, shared by all channels

```

- **Hue** is which way the drug pushes the body. **Potency** is how hard. **Purity** is how clean it is: a low-purity compound is a muddy, dirty drug.
- The gray floor cancels out of `x` and `y`, so filler does nothing.
- The complement of a hex flips every channel around `max+min`: `c' = (max+min) - c`. It has the same purity and the opposite hue (`x` and `y` negate).

### 2.2 Solutions [Proposed]

Concentration is not part of the hex. A hex is a compound's identity, and dilution never changes identity.

```js
Solution = { hex, mass, volume }   // concentration = mass / volume

```

A dose is the mass administered, taken from the volume drawn.

### 2.3 Lab operations

- **Mix**: masses and volumes add. Compounds mix like dyes: a channel is the share of that light the compound lets through, so the new channel is the mass-weighted geometric mean, `c = exp((mA ln cA + mB ln cB) / (mA + mB))`, with each channel floored at 0.03 so a zero channel cannot wipe out a mix. Blue and yellow make green; mixtures come out darker and weaker than their ingredients. The result is a new compound, not the same as giving the ingredients as separate doses: with narrow tuning, red plus green mixed becomes a dark yellowish compound that acts on whatever organ is tuned near yellow, while the two given separately act on the red and green organs. A fully saturated compound and its complement cancel to a dark gray (an inert neutralized salt); less saturated pairs leave a weak remainder. Do not test for equivalence with co-dosing. [Decided]
- **Refine**: subtract the gray floor and rescale so the max channel returns to its old value: `c' = (c - min) * max / (max - min)`. Mass is multiplied by purity, so yield equals purity. Total drive is conserved, but noise falls. Refining must cost yield, time, or reagents so that cheap and muddy stays a real option. Gray and white cannot be refined. [Proposed]
- **React**: a catalyst or heat step rotates hue by a fixed step, so a synthesis route is a path around the wheel. The reagent table is **[Open]**.
- **Dilute**: water is the diluting agent, `{ volume }` only. Volume drawn from the water is added to the solution. The hex and the solute mass are unchanged, so concentration falls. Water is not a hex and is not mixed.

**Appearance.** Water is clear. A solution shows its hex by Beer-Lambert: each channel's transmitted light is `c ^ (concentration / stock)`, so a stock shows its hex exactly, dilution fades it toward clear, and concentrating past stock darkens it. Cloudiness (light scattering) is a separate, mass-like quantity that only affects appearance: milk is the white compound `#FFFFFF` (which on its own lets all light through) carried in a fully cloudy liquid, so it is opaque white and lightens what it is mixed into.

**[Open]** Ingredient supply, cost, and scarcity.

### 2.5 Latin names [Decided]

Every hex has a generated Latin color name. The name describes the color. It is not unique: many hexes share a name. Identity stays the hex.

```js
const lightWord = (max) => {
  if (max < 0.15) return "negra";
  if (max < 0.35) return "fuscus";
  if (max < 0.55) return "satur";
  if (max < 0.75) return "clarus";
  if (max < 0.9) return "pallidus";
  return "albus";
};
const stems = ["ruber","aurantius","flavus","chlorus","viridis","prasinus","cyaneus","caeruleus","indicus","violaceus","purpureus","roseus"];
const latinName = (compound) => {
  const light = lightWord(Math.max(compound.r, compound.g, compound.b));
  if (compound.purity < 0.12) return `${light} vanus`;
  const chroma = compound.purity < 0.55 ? "spurius" : "merus";
  const stem = stems[Math.floor((compound.hue + 15) / 30) % 12];
  return `${light} ${chroma} ${stem}`;
};
```

- **Light** is the brightest channel: negra, fuscus, satur, clarus, pallidus, albus.
- **Chroma** is purity: vanus when nearly gray (no hue stem), spurius when muddy, merus when clean.
- **Stem** is a 30° hue bin, centered on red at 0°: ruber, aurantius, flavus, chlorus, viridis, prasinus, cyaneus, caeruleus, indicus, violaceus, purpureus, roseus.

`#FFFFFF` is **albus vanus**. In the world that compound is milk, and cloudiness (section 2.3) makes it opaque white. `#000000` is **negra vanus**. `#FF0000` is **clarus merus ruber**.

The name shown on a dose is not the Latin class. Stocked compounds are snapped to the best-of list from [color-names](https://github.com/meodai/color-names), and any other hex, including a mix, uses the nearest name on that list. An exact catalog hex keeps its common name (caffeine, milk) instead.

### 2.6 Catalog [Decided]

`concept/chems.json` lists 50 common substances and 3 foods, and the hex each one is. A catalog hex is that substance. Drinking it drives the heart, brain, and liver by the substance's profile in `src/sim/reactions.ts`, not by hue, so caffeine still alerts and pounds even though the receptors have moved. Any other hex, including a mix, still uses receptor tuning (section 3). The profile also sets how the dose feels: shake, spasm, heartbeat, color wash, skin color, blur, and how much it slows the body. A dead body cannot walk, look, or use the hands.

### 2.7 Food and nutrition [Decided]

Three catalog entries have `"category": "food"`: Wormmeal `#A0705A` (mostly protein), Kelpmash `#2E5E3A` (mostly vitamins), and Beetmash `#7A1E2A` (mostly energy). Food pushes no organ. Swallowing it feeds the body instead of entering the blood. The eight analogs nearest each food have their own names (`src/sim/food.ts`); no name is an established color name. Analogs feed less, by the analog scale. The food table is restocked at random each game with three picks from each food's family.

The body tracks energy, protein, and vitamins from 0 to 1. Each runs down in real time: a full stomach is hungry again after an hour, and protein and vitamins drain more slowly. The player starts hungry. Hunger and shortfalls show as symptom text. Starvation slows, shakes, and darkens the view; low protein slows and weakens the grip; low vitamins blur, unsteady, and pale the body. Once energy is gone, the body dies of starvation after a few seconds, unless a swallow of food lands in that time. A medium beaker of a food restores its main nutrient from empty. Tunables are in `config.nutrition`.

## 3. Effect model: receptors as color filters

Every organ has a receptor hue `theta` and a sharpness `k`. A dose acts on an organ in proportion to how well the compound's hue matches. The opposite hue is an antagonist.

```js
const tuning = (h, theta, k) => {
  const c = Math.cos((h - theta) * Math.PI / 180);
  return Math.exp(k*(c-1)) - Math.exp(k*(-c-1));  // + agonist, - antagonist, ~0 at 90 degrees off
};
const drive = (compound, organ, mass) =>
  compound.potency * mass * tuning(compound.hue, organ.theta, organ.k);

```

### Why narrow tuning is required

Do not use broad cosine tuning. With cosine tuning, every organ response is a combination of just cos and sin of the hue, so the effect space is 2D whatever the organ count. Measured on five organs at 0, 60, 90, 120, and 150 degrees:

- Cosine: rank 2, best selectivity 1.15 to 1.37 times the worst off-target, and 89% of hues noticeably hit four or more of the five organs.
- Narrow bump with `k = 6`: rank 5, best selectivity 2.2 to 4.7 times.

Selectivity is the whole basis for crafting targeted medicines.

### Impurity noise [Proposed]

```js
noise = (1 - purity) * potency * mass

```

Gray and white have zero potency, so they are harmless. Muddy compounds with real potency and low purity cause random side effects and organ damage (see 4.4).

### Dose response [Proposed]

Benefit saturates while harm accelerates. Sum the drive from everything in the blood, then:

```js
deflection = Math.tanh((totalDrive - adaptation) / scale);  // -1..1, 0 is normal

```

`adaptation` is a slow state per organ that tracks the drive (see 4.5).

### Hidden information [Proposed]

Receptor hues are randomized per save so the mapping cannot be memorized. Generate them as even spacing (360/n), plus a random global rotation, plus jitter of up to 15 degrees, with a minimum separation between any two organs (config). The UI never shows raw receptor hues, only symptoms and readings.

## 4. Body and health system

### 4.1 Organs


| Organ  | Deflection up                                  | Deflection down                                  |
| ------ | ---------------------------------------------- | ------------------------------------------------ |
| Heart  | fast, hot, pounding; arrhythmia at the extreme | slow, faint, cold; cardiac arrest at the extreme |
| Brain  | alert, jittery, seizure                        | drowsy, sleep, slowed breathing, coma            |
| Liver  | clears drugs faster                            | clears slower; toxins build up                   |
| Gut    | appetite, motility, cramping                   | nausea, shutdown                                 |
| Nerves | numbing, relief; masks injury                  | pain, hypersensitivity, dread                    |


Both directions must cost something. Setpoint is 0. Mild deflection in the intended direction is the therapeutic effect, and both extremes are harmful. Numbing hides integrity loss from the player, and fast liver clearance strips the medicine. Symptom thresholds on `|deflection|` are config: mild 0.25, moderate 0.5, severe 0.75.

Roster and count are extendable. Each organ is `{ name, theta, k, integrity, deflection, adaptation }`.

### 4.2 Two layers of health [Proposed]

- **Function** is the live output, `deflection`, driven by what is in the blood. It recovers as the drug clears.
- **Integrity** is long-term health, 0..1. Damage is slow to heal. Effects: `sensitivity = 1 + (1 - integrity)`, so a damaged organ over-responds, and `capacity = integrity` scales gameplay outputs such as stamina.

### 4.3 Blood and clearance

Doses enter the blood through a route, then clear exponentially. The liver sets the rate:

```js
clearance = k0 * (1 + 0.5 * liver.deflection) * (0.3 + 0.7 * liver.integrity);
clearance = Math.max(clearance, floor);   // kidney backup, prevents a death spiral

```

Because a drug can act on the liver receptor, drugs change each other's clearance, so interactions come for free. Dirty drugs damage the liver, which slows clearance, which makes the next dose hit harder. Keep this loop, but add regeneration, the floor above, and warning symptoms before the cliff.

### 4.4 Damage and noise

- Overdrive damage: `dmg = gain * max(0, |deflection| - 0.75)^2` per tick, applied to the overdriven organ.
- Noise (from section 3): the liver takes steady damage proportional to noise. In addition, with probability proportional to noise per tick, a randomly chosen organ gets a brief random-signed deflection, which is a random side effect.
- Regeneration: `integrity += regen * (1 - integrity)` slowly when no damage was taken.
- Critical conditions: heart or brain (breathing) deflection at or beyond +/-0.95 for N ticks, or integrity 0 on either, is death. Show escalating symptoms well before this.

### 4.5 Tolerance and rebound [Proposed]

One state gives both:

```js
adaptation += (totalDrive - adaptation) * alpha;   // alpha small

```

With repeated use, adaptation catches up to the drive, so the effect fades (tolerance). When the drug clears, drive falls to 0 while adaptation is still high, so deflection swings the opposite way (rebound or withdrawal).

### 4.6 Routes [Proposed]

Starting values, all config:


| Route    | Onset delay | Bioavailability | Notes                                                                             |
| -------- | ----------- | --------------- | --------------------------------------------------------------------------------- |
| Oral     | long        | ~0.6            | passes through gut and liver first; lost entirely if gut nausea is past threshold |
| Injected | very short  | 1.0             | fast, strong peak                                                                 |
| Inhaled  | short       | ~0.8            | in between                                                                        |


The onset delay is intentional. It creates the redose trap, where a second dose stacks on the first, and that is what makes self-testing risky. Dose response is otherwise linear at small doses, so a player could microdose everything safely.

### 4.7 Antidotes [Proposed]

The complement hex cancels live drive. It does not undo integrity damage already done, and it carries its own dose and noise.

### 4.8 Illness [Open]

Two candidate models, possibly both:

- **Organ-driven**: an organ is stuck off its setpoint, and the cure is a compound that pushes it back without overshooting.
- **Pathogen-driven**: a pathogen is itself a hex. The cure is near its complement, so it neutralizes the pathogen, but far from every host organ receptor, so it spares the patient. Therapeutic index = pathogen affinity divided by the largest host organ hit.

## 5. Species and testing

Rats use the same body model with different parameters: per-organ receptor offsets of a few degrees (hidden, and different from the human's), a clearance multiplier, and per-organ gain multipliers. Rat results are a noisy proxy for the human body.


| Organ  | Observable in rats                    | Observable in the player                |
| ------ | ------------------------------------- | --------------------------------------- |
| Heart  | heart rate, temperature               | all symptoms                            |
| Brain  | activity, sleep, seizure              | all symptoms                            |
| Liver  | only by necropsy, which costs the rat | slowed or fast effects, general malaise |
| Gut    | food intake                           | including nausea                        |
| Nerves | not observable except at extremes     | relief, pain, dread                     |


Real rats cannot vomit and cannot report subjective states, so nausea, pain, and dread are visible only through self-testing. Death is always observable. Necropsy reveals every organ's integrity. Rats must cost something (money, time, or supply) so they cannot be spammed. **[Open]** exactly what.

## 6. Balance harness

An interactive tool exists that recomputes these metrics as organ hues and tuning change. Port its logic into a test suite. Metrics, computed over a sweep of all 360 hues at potency 1:

- **Rank** of the hue-by-organ response matrix (Gram-Schmidt on the columns). Target: equals organ count.
- **Best selectivity per organ**: max over hues of `|target| / max|other organs|`, counting only hues where the target is at least half of the global peak. Target: at least the clean ratio (default 2).
- **Clean coverage**: share of hues where one organ beats the runner-up by the clean ratio and reaches half of peak. Rule of thumb: 50% or more is good.
- **Broad share**: share of hues that hit at least 80% of organs at 0.3 of peak or more. Rule of thumb: 10% or less.
- **Inert share**: share of hues where the strongest response is below 0.15 of peak. Rule of thumb: 25% or less.
- **Crowded pairs**: organ pairs whose response columns have cosine similarity above 0.8.

The thresholds are rules of thumb, not measured targets, so tune them after playtesting.

## 7. Known design risks to keep testing

- **Solvability**: once the mapping is learned, experimentation dies. Randomized receptors and species offsets are the protection.
- **Dominant strategies**: free refining, pure-upside poles, and free rat testing. Each needs a cost.
- **Death spirals**: the liver loop. Keep the clearance floor and regeneration.
- **Complexity**: five organs, two layers, routes, and species is a lot to read. Show the body as a silhouette with each organ glowing its current deflection color, and surface symptoms, not numbers.

## 8. Invariants to unit-test

- A fully saturated compound and its complement mixed in equal mass give a gray hex with zero potency, and every organ drive is about 0.
- Blue and yellow mix to green. Splitting a pour does not change the result. A trace of black or of a zero channel does not wipe out a mix.
- `drive` flips sign when the compound is replaced by its complement.
- Zero mass gives zero drive. Zero potency (gray, white, black) gives zero drive and zero noise.
- Refining preserves total drive (potency times mass) and reduces noise. Refining a gray is rejected.
- With narrow tuning and the default organ count, response-matrix rank equals the organ count.
- The same seed produces the same receptors and the same simulation.
- Clearance never drops below the floor.
- After a drug clears, adaptation causes rebound of the opposite sign.

## 9. Suggested build order

1. Hex parsing, derived properties, complement, mix, refine, with tests.
2. Receptor tuning and the balance harness metrics.
3. Three organs, one integrity value each, one route (injected), deflection and symptoms.
4. Blood, clearance with the liver link, onset delay.
5. Second and third routes, noise and side effects, overdrive damage and death.
6. Rats and observability, then self-testing.
7. Tolerance and rebound, then antidotes.
8. Extra organs, illness, economy.

## 10. Open decisions

- Ingredient supply, cost, and scarcity of the R, G, and B elements.
- Reagent table for the React operation.
- Cost of rat testing.
- Illness model: organ-driven, pathogen-driven, or both.
- Time model: ticks per game hour, and what a tick costs the player.
- Whether the player character has a fixed baseline or a persistent condition that carries between sessions.

