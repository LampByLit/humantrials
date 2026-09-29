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

- **Mix**: masses and volumes add. The new hex is the mass-weighted average of the channels. The result is a new compound, not the same as giving the ingredients as separate doses: with narrow tuning, red plus green mixed becomes a yellowish compound that acts on whatever organ is tuned near yellow, while the two given separately act on the red and green organs. Only the color-plane vector (`mass * x`, `mass * y`) adds. Opposite hues still cancel toward gray (an inert neutralized salt). Do not test for equivalence with co-dosing. [Proposed]
- **Refine**: subtract the gray floor and rescale so the max channel returns to its old value: `c' = (c - min) * max / (max - min)`. Mass is multiplied by purity, so yield equals purity. Total drive is conserved, but noise falls. Refining must cost yield, time, or reagents so that cheap and muddy stays a real option. Gray and white cannot be refined. [Proposed]
- **React**: a catalyst or heat step rotates hue by a fixed step, so a synthesis route is a path around the wheel. The reagent table is **[Open]**.
- **Dilute**: adds volume, and the hex is unchanged.

**[Open] Mixing rule.** Weighted averaging means a mixture is always weaker than its ingredients, so strong secondaries cannot be made by mixing alone. The alternative is additive: the hex digits are literal atom counts of R, G, and B, mixing adds them, and there is a cap. Decide before building the economy. Also open: ingredient supply, cost, and scarcity.

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

- A compound and its complement mixed in equal mass give a gray hex with zero potency, and every organ drive is about 0.
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

- Mixing: averaging or additive atom counts.
- Ingredient supply, cost, and scarcity of the R, G, and B elements.
- Reagent table for the React operation.
- Cost of rat testing.
- Illness model: organ-driven, pathogen-driven, or both.
- Time model: ticks per game hour, and what a tick costs the player.
- Whether the player character has a fixed baseline or a persistent condition that carries between sessions.

