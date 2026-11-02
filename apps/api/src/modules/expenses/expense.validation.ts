import { z } from 'zod';

const emptyToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

const nullableDescription = z.preprocess(
  emptyToNull,
  z.string().trim().max(2000).nullable().optional(),
);

const positiveIntegerQuery = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,6}$/, 'Use a positive integer.')
    .transform(Number)
    .refine((value) => value <= maximum, 'The requested pagination value exceeds the limit.');

const minorUnits = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/, 'Amount must be a positive integer number of kobo.')
  .refine(
    (value) => BigInt(value) <= 9223372036854775807n,
    'Amount exceeds the supported BIGINT range.',
  );

const businessDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid YYYY-MM-DD date.')
  .refine((value) => {
    const parsed = new Date(value + 'T00:00:00.000Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');

const categoryFields = {
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(100),
  description: nullableDescription,
};

export const createExpenseCategorySchema = z.object(categoryFields).strict();

export const updateExpenseCategorySchema = z
  .object({
    code: categoryFields.code.optional(),
    name: categoryFields.name.optional(),
    description: nullableDescription,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one category field.');

export const listExpenseCategoriesQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'inactive', 'all']).optional(),
    page: positiveIntegerQuery(1_000_000).optional(),
    pageSize: positiveIntegerQuery(100).optional(),
  })
  .strict();

const expenseFields = {
  categoryId: z.string().uuid(),
  description: z.string().trim().min(1).max(5000),
  amountMinor: minorUnits,
  currency: z.literal('NGN').default('NGN'),
  incurredOn: businessDate,
  payeeName: z.string().trim().min(1).max(200),
};

export const createExpenseSchema = z.object(expenseFields).strict();

export const updateExpenseSchema = z
  .object({
    categoryId: expenseFields.categoryId.optional(),
    description: expenseFields.description.optional(),
    amountMinor: expenseFields.amountMinor.optional(),
    currency: z.literal('NGN').optional(),
    incurredOn: expenseFields.incurredOn.optional(),
    payeeName: expenseFields.payeeName.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one expense field.');

export const listExpensesQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    categoryId: z.string().uuid().optional(),
    page: positiveIntegerQuery(1_000_000).optional(),
    pageSize: positiveIntegerQuery(100).optional(),
  })
  .strict();
