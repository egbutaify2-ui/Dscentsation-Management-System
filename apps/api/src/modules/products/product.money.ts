const MAX_BIGINT = 9_223_372_036_854_775_807n;
const MONEY_PATTERN = /^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$/;

export function toMinorUnits(amount: string): string {
  if (!MONEY_PATTERN.test(amount)) {
    throw new Error('Enter a non-negative amount with no more than two decimal places.');
  }
  const [whole, fraction = ''] = amount.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > MAX_BIGINT) throw new Error('The amount is too large.');
  return minor.toString();
}

export function fromMinorUnits(minorValue: string | bigint): string {
  const minor = BigInt(minorValue);
  const whole = minor / 100n;
  const fraction = (minor % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${fraction}`;
}
