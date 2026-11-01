import { z } from 'zod';

const money = z
  .string()
  .regex(/^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$/, 'Use a non-negative amount with up to two decimal places.');
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

export const variantInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    sku: nullableText(80),
    unitOfMeasure: z.string().trim().min(1).max(40),
    sellingPrice: money,
    costPrice: money,
  })
  .strict();

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: nullableText(4000),
    internalCode: nullableText(80),
    categoryId: z.string().uuid().nullable().optional(),
    variant: variantInputSchema,
  })
  .strict();

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: nullableText(4000),
    internalCode: nullableText(80),
    categoryId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one product field to update.');

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: nullableText(2000),
    parentId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: nullableText(2000),
    parentId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one category field to update.');

export const createVariantSchema = variantInputSchema;
export const updateVariantSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    sku: nullableText(80),
    unitOfMeasure: z.string().trim().min(1).max(40).optional(),
    sellingPrice: money.optional(),
    costPrice: money.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one variant field to update.');

export const statusSchema = z.object({ isActive: z.boolean() }).strict();
export const productStatusSchema = z.object({ status: z.enum(['active', 'archived']) }).strict();
