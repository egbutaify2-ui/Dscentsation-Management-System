import { invalidOrder } from './order.errors.js';
import type { OrderTotals } from './order.types.js';

export const ORDER_CURRENCY = 'NGN' as const;
export const ZERO_MINOR_UNITS = '0';

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const MINOR_UNIT_PATTERN = /^(?:0|[1-9]\d*)$/;

function checkedMinorUnits(value: string): bigint {
  if (!MINOR_UNIT_PATTERN.test(value)) {
    throw invalidOrder('Order money must be a non-negative integer minor-unit value.');
  }

  const amount = BigInt(value);
  if (amount > MAX_POSTGRES_BIGINT) {
    throw invalidOrder('The order amount exceeds the supported NGN range.');
  }
  return amount;
}

export function toNgnMinorUnits(amount: string): string {
  if (!DECIMAL_AMOUNT_PATTERN.test(amount)) {
    throw invalidOrder(
      'Product selling prices must be non-negative NGN amounts with up to two decimals.',
    );
  }

  const [whole = '0', fraction = ''] = amount.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > MAX_POSTGRES_BIGINT) {
    throw invalidOrder('The product selling price exceeds the supported NGN range.');
  }
  return minor.toString();
}

export function calculateLineTotalMinor(unitPriceMinor: string, quantity: number): string {
  const unitPrice = checkedMinorUnits(unitPriceMinor);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw invalidOrder('Order quantity must be a positive whole number.');
  }

  const total = unitPrice * BigInt(quantity);
  if (total > MAX_POSTGRES_BIGINT) {
    throw invalidOrder('The order line amount exceeds the supported NGN range.');
  }
  return total.toString();
}

export function calculateOrderTotals(lines: readonly { lineTotalMinor: string }[]): OrderTotals {
  let subtotal = 0n;
  for (const line of lines) {
    subtotal += checkedMinorUnits(line.lineTotalMinor);
    if (subtotal > MAX_POSTGRES_BIGINT) {
      throw invalidOrder('The order subtotal exceeds the supported NGN range.');
    }
  }

  // Discounts and delivery fees stay disabled until the business rules are approved.
  return {
    subtotalMinor: subtotal.toString(),
    discountMinor: ZERO_MINOR_UNITS,
    deliveryFeeMinor: ZERO_MINOR_UNITS,
    totalMinor: subtotal.toString(),
  };
}
