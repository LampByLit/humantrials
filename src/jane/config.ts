// Timings are real seconds. The minute is the wait, not the walk: the counters
// sit just inside the south door, so she is only a few steps from the glass.
// After a summons she stays through the conversation, then leaves once the
// talk has been quiet for a minute.
export const janeConfig = {
  counterDelay: 60,
  errandDelay: 60,
  summonDelay: 60,
  linger: 60,
  analysisDelay: 15,
  walkSpeed: 1.25,
  maxOrderLitres: 8,
  minOrderLitres: 0.05,
  rewardLitres: 1,
} as const;
