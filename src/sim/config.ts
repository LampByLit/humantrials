export const config = {
  tuning: {
    k: 6,
  },
  receptors: {
    jitterDeg: 15,
    minSeparationDeg: 30,
  },
  deflectionScale: 1,
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
} as const;
