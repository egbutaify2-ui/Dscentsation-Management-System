import { describe, expect, it } from 'vitest';
import {
  calculateLineTotalMinor,
  calculateOrderTotals,
  toNgnMinorUnits,
} from './order.money.js';

describe('order money', () => {
  it('converts decimal NGN prices to integer kobo without floating-point arithmetic', () => {
    expect(toNgnMinorUnits('125')).toBe('12500');
    expect(toNgnMinorUnits('125.4')).toBe('12540');
    expect(toNgnMinorUnits('125.49')).toBe('12549');
    expect(toNgnMinorUnits('0.01')).toBe('1');
  });

  it('rejects malformed, negative and over-precision product prices', () => {
    expect(() => toNgnMinorUnits('-1.00')).toThrow();
    expect(() => toNgnMinorUnits('01.00')).toThrow();
    expect(() => toNgnMinorUnits('1.001')).toThrow();
    expect(() => toNgnMinorUnits('1e3')).toThrow();
  });

  it('multiplies unit prices by whole-number quantities using BigInt', () => {
    expect(calculateLineTotalMinor('12549', 3)).toBe('37647');
    expect(calculateLineTotalMinor('0', 5)).toBe('0');
    expect(() => calculateLineTotalMinor('100', 1.5)).toThrow();
    expect(() => calculateLineTotalMinor('100', 0)).toThrow();
  });

  it('calculates order totals with zero discount and delivery fee', () => {
    expect(
      calculateOrderTotals([
        { lineTotalMinor: '15000' },
        { lineTotalMinor: '25050' },
      ]),
    ).toEqual({
      subtotalMinor: '40050',
      discountMinor: '0',
      deliveryFeeMinor: '0',
      totalMinor: '40050',
    });
  });

  it('rejects amounts that exceed PostgreSQL BIGINT', () => {
    expect(() => toNgnMinorUnits('92233720368547758.08')).toThrow();
    expect(() => calculateLineTotalMinor('9223372036854775807', 2)).toThrow();
    expect(() => calculateOrderTotals([{ lineTotalMinor: '9223372036854775808' }])).toThrow();
  });
});
