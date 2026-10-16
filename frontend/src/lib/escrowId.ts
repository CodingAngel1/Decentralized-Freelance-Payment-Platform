/**
 * escrowId.ts
 *
 * Defensive parsing for on-chain escrow IDs.
 *
 * The escrow contract uses a `u64` counter, so valid ids are non-negative
 * integers in [0, 2^64 - 1]. Route params and user input arrive as arbitrary
 * strings; using `BigInt()` directly throws on anything that is not an integer
 * literal (e.g. "abc", "1.5", "-1"), and that throw happens during render —
 * before any guard can catch it — producing a blank page instead of an error
 * message (issue #106).
 *
 * `parseEscrowId` validates the string first and returns `null` for any input
 * that is not a valid u64 integer, so callers can show a friendly error without
 * ever reaching `BigInt()`.
 */

/** Maximum value of a Soroban `u64` (2^64 − 1). */
const U64_MAX = 18_446_744_073_709_551_615n;

/**
 * Parse a string as a u64 escrow ID.
 *
 * Returns the `bigint` value if `s` is a sequence of ASCII digits representing
 * an integer in [0, 2^64 - 1].  Returns `null` for any other input — including
 * the empty string, floating-point notation, negative numbers, and non-numeric
 * strings.
 */
export function parseEscrowId(s: string): bigint | null {
  if (!/^\d+$/.test(s)) return null;
  try {
    const value = BigInt(s);
    if (value > U64_MAX) return null;
    return value;
  } catch {
    return null;
  }
}
