/** Speech-friendly money and volume. Locale is fixed so a save reads the same on every machine. */
export function moneyText(amount: number): string {
  const cents = Math.round(amount * 100) / 100;
  const whole = Math.abs(cents - Math.round(cents)) < 0.001;
  const body = whole
    ? Math.round(cents).toLocaleString("en-US")
    : cents.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${body}`;
}

export function litresText(litres: number): string {
  if (litres >= 0.995) {
    const shown = Math.round(litres * 100) / 100;
    const unit = Math.abs(shown - 1) < 0.02 ? "litre" : "litres";
    const n = Number.isInteger(shown) ? shown.toFixed(0) : shown.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
    return `${n} ${unit}`;
  }
  return `${Math.max(1, Math.round(litres * 1000))} millilitres`;
}

export function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
