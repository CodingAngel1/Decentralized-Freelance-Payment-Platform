/**
 * schemas.ts
 *
 * Request schemas for the job-creation API, extracted from the route file so
 * the validation rules are unit testable without a database, config or a
 * running server (see `__tests__/app.test.ts`).
 */

import { z } from "zod";

export const milestoneSchema = z.object({
  description: z.string().optional(),
  amountUsdc: z.number().positive(),
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
