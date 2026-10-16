/**
 * schemas.ts
 *
 * Request schemas for the job-creation API, extracted from the route file so
 * the validation rules are unit testable without a database, config or a
 * running server (see `__tests__/app.test.ts`).
 */

import { z } from "zod";
import { isSkillTag, MAX_JOB_TAGS, SKILL_TAG_SLUGS } from "./tags";

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

/**
 * A job's skill tags: curated slugs from `lib/tags.ts`, de-duplicated and
 * capped. Defaults to none, so existing clients keep working unchanged.
 */
export const jobTagsSchema = z
  .array(
    z
      .string()
      .refine(isSkillTag, `Tags must be one of: ${SKILL_TAG_SLUGS.join(", ")}`),
  )
  .max(MAX_JOB_TAGS)
  .default([])
  .transform((tags) => [...new Set(tags)]);

export const createJobSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(10),
  milestones: z.array(milestoneSchema).min(1),
  expiresAt: z.string().datetime().optional(),
  /** Asset symbol the job pays in; must be in the registry. Defaults to USDC. */
  asset: z.string().default("USDC"),
  /** Curated skill tags describing the work (issue #70). */
  tags: jobTagsSchema,
});

export const assignJobSchema = z.object({
  freelancerAddress: z
    .string()
    .refine(isValidStellarAddress, "Invalid Stellar address"),
});

