import { z } from 'zod';
import { ORDER_STATUSES } from './order.types.js';

export const orderStatusSchema = z.enum(ORDER_STATUSES);

const orderSourceChannelSchema = z.enum(['whatsapp', 'instagram', 'website', 'phone']);

const orderItemRequestSchema = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.number().int().positive().safe().max(2_147_483_647),
  })
  .strict();

const optionalNullableText = (maximum: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(maximum).nullable().optional(),
  );

export const createOrderSchema = z
  .object({
    customerId: z.string().uuid(),
    sourceChannel: orderSourceChannelSchema,
    fulfilmentLocationId: z.string().uuid(),
    items: z.array(orderItemRequestSchema).min(1),
    deliveryAddress: optionalNullableText(1000),
    notes: optionalNullableText(1000),
  })
  .strict();

export const amendOrderSchema = z
  .object({
    customerId: z.string().uuid().optional(),
    sourceChannel: orderSourceChannelSchema.optional(),
    fulfilmentLocationId: z.string().uuid().optional(),
    items: z.array(orderItemRequestSchema).min(1).optional(),
    deliveryAddress: optionalNullableText(1000),
    notes: optionalNullableText(1000),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one order field to amend.',
  });

const positiveIntegerQuery = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,6}$/, 'Use a positive integer.')
    .transform(Number)
    .refine((value) => value <= maximum, 'The requested pagination value exceeds the limit.');

export const listOrdersQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.union([orderStatusSchema, z.literal('all')]).optional(),
    customerId: z.string().uuid().optional(),
    sourceChannel: orderSourceChannelSchema.optional(),
    fulfilmentLocationId: z.string().uuid().optional(),
    page: positiveIntegerQuery(1_000_000).optional(),
    pageSize: positiveIntegerQuery(100).optional(),
  })
  .strict();

export type CreateOrderRequest = z.infer<typeof createOrderSchema>;
export type AmendOrderRequest = z.infer<typeof amendOrderSchema>;
export type ListOrdersRequest = z.infer<typeof listOrdersQuerySchema>;
