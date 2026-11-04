import { z } from 'zod';

const positiveIntegerQuery = (maximum: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,5}$/, 'Use a positive integer.')
    .transform(Number)
    .refine(Number.isSafeInteger, 'Use a safe integer.')
    .refine((value) => value <= maximum, 'The requested pagination value exceeds the limit.');

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');

export const listAuditLogsQuerySchema = z
  .object({
    actorUserId: z.string().uuid().optional(),
    action: z.string().trim().min(1).max(160).optional(),
    entityType: z.string().trim().min(1).max(100).optional(),
    entityId: z.string().uuid().optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    page: positiveIntegerQuery(100_000).optional(),
    pageSize: positiveIntegerQuery(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'The start date must not be later than the end date.',
      });
    }
  });
