import { z } from 'zod';

const positiveIntegerQuery = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,6}$/, 'Use a positive integer.')
    .transform(Number)
    .refine((value) => value <= maximum, 'The requested value exceeds the limit.');

export const createSupplierSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
  })
  .strict();

export const updateSupplierSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide a supplier field to update.');

export const listSuppliersQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'inactive', 'all']).optional(),
    page: positiveIntegerQuery(1_000_000).optional(),
    pageSize: positiveIntegerQuery(100).optional(),
  })
  .strict();

export const duplicateSupplierQuerySchema = z
  .object({
    name: z.string().trim().min(2).max(200),
  })
  .strict();
