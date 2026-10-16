/**
 * schemas.ts
 *
 * Request schemas for the job-creation API, extracted from the route file so
 * the validation rules are unit testable without a database, config or a
 * running server (see `__tests__/app.test.ts`).
 */

import { z } from "zod";

/**
 * A milestone amount: a positive number, or a positive decimal string.
 *
 * The string form lets a client send exactly what the user typed instead of a
 * binary float it round-tripped through `Number`, so the value the API stores
 * and sums is the value that was entered (see `sumAmounts` in lib/assets.ts).
 */
const amountUsdcSchema = z.union([
  z.number().positive(),
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Amount must be a positive decimal number")
    .refine((value) => Number(value) > 0, "Amount must be greater than zero"),
]);

export const milestoneSchema = z.object({
  description: z.string().optional(),
  amountUsdc: amountUsdcSchema,
  deadline: z.string().datetime().optional(),
});

export const createJobSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10),
  milestones: z.array(milestoneSchema).min(1),
  expiresAt: z.string().datetime().optional(),
  /** Asset symbol the job pays in; must be in the registry. Defaults to USDC. */
  asset: z.string().default("USDC"),
});

export const createProposalSchema = z.object({
  coverLetter: z.string().min(5).max(3000).optional(),
  proposedRate: amountUsdcSchema.optional(),
});

export const createDeliverableSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileUrl: z.string().min(1),
  fileSize: z.number().int().nonnegative().optional(),
  fileType: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
});

