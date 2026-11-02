import { z } from 'zod';

const emptyToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const optionalNullableText = (max: number) =>
  z.preprocess(
    emptyToNull,
    z.string().trim().min(1).max(max).nullable().optional(),
  );

const optionalEmail = z.preprocess(
  emptyToNull,
  z.string().trim().email().max(254).nullable().optional(),
);

export const createCustomerSchema = z
  .object({
    fullName: z.string().trim().min(1).max(160),
    phone: optionalNullableText(40),
    email: optionalEmail,
    notes: optionalNullableText(1000),
  })
  .strict();

export const updateCustomerSchema = z
  .object({
    fullName: z.string().trim().min(1).max(160).optional(),
    phone: optionalNullableText(40),
    email: optionalEmail,
    notes: optionalNullableText(1000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one customer field to update.');

const positiveIntegerQuery = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9]\\d{0,6}$/, 'Use a positive integer.')
    .transform(Number)
    .refine((value) => value <= maximum, `Value must not exceed ${maximum}.`);

export const listCustomersQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'archived', 'all']).optional(),
    page: positiveIntegerQuery(1_000_000).optional(),
    pageSize: positiveIntegerQuery(100).optional(),
  })
  .strict();
