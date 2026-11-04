import { z } from 'zod';

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
function isWithinPostgresBigintRange(value: string): boolean {
  try {
    return BigInt(value) <= MAX_POSTGRES_BIGINT;
  } catch {
    return true;
  }
}

const amountMinorSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'Enter a positive integer amount in kobo.')
  .refine(isWithinPostgresBigintRange, {
    message: 'The amount exceeds the supported NGN minor-unit range.',
  });

export const recordPaymentSchema = z
  .object({
    amountMinor: amountMinorSchema,
    currency: z.literal('NGN').optional().default('NGN'),
    method: z.string().trim().min(1).max(80).optional(),
    reference: z.string().trim().min(1).max(160).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const listPaymentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const verifyPaymentSchema = z.object({}).strict();
