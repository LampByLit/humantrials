export function tuning(hue: number, theta: number, k: number): number {
  const c = Math.cos(((hue - theta) * Math.PI) / 180);
  return Math.exp(k * (c - 1)) - Math.exp(k * (-c - 1));
}

export function drive(
  compound: { potency: number; hue: number },
  organ: { theta: number; k: number },
  mass: number,
): number {
  return compound.potency * mass * tuning(compound.hue, organ.theta, organ.k);
}

export function noise(compound: { purity: number; potency: number }, mass: number): number {
  return (1 - compound.purity) * compound.potency * mass;
}
