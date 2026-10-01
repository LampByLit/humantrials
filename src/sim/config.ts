export const config = {
  tuning: {
    k: 6,
  },
  receptors: {
    jitterDeg: 15,
    minSeparationDeg: 30,
  },
  // A stock 10mL sip is 0.1 mass. At 0.35 a matched sip stays mild and a matched beaker is an overdose.
  deflectionScale: 0.35,
  symptoms: {
    mild: 0.25,
    moderate: 0.5,
    severe: 0.75,
  },
  routes: {
    injected: {
      bioavailability: 1,
    },
    oral: {
      bioavailability: 0.6,
      onset: 4,
    },
  },
  clearance: {
    k0: 0.12,
    floor: 0.03,
  },
  balance: {
    cleanRatio: 2,
    halfPeak: 0.5,
    broadOrganFraction: 0.8,
    broadOfPeak: 0.3,
    inertOfPeak: 0.15,
    crowdedSimilarity: 0.8,
  },
  body: {
    integrity: 1,
    adaptation: 0,
  },
  damage: {
    overdrive: 0.8,
    noise: 0.15,
    regen: 0.02,
    critical: 0.95,
    criticalHold: 2.5,
    sideChance: 0.8,
    sideDrive: 0.35,
    sideDecay: 1.2,
  },
} as const;
