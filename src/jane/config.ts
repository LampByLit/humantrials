// Timings are real seconds. The minute is the wait, not the walk: the counters
// sit just inside the south door, so she is only a few steps from the glass.
export const janeConfig = {
  counterDelay: 60,
  errandDelay: 60,
  summonDelay: 60,
  analysisDelay: 15,
  walkSpeed: 1.25,
  maxOrderLitres: 8,
  minOrderLitres: 0.05,
  rewardLitres: 1,
} as const;
