/**
 * json.ts
 *
 * Response serialization helpers.
 *
 * Prisma maps `BigInt` columns (`Job.escrowId`, `Dispute.onChainId`) to JS
 * `BigInt`, and `JSON.stringify` refuses to serialize a `BigInt` — it throws
 * `TypeError: Do not know how to serialize a BigInt`. Express calls it from
 * `res.json()`, so returning a row directly would answer 500 *after* a
 * successful write: the client sees a failure for a job that did save.
 *
 * Rendering it as a string keeps the value exact (an escrow id is a u64 and
 * would lose precision as a JS number) and matches the frontend's
 * `escrowId: string | number | null`.
 */

/** Express `json replacer`: stringify bigints, pass everything else through. */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
