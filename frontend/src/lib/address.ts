/**
 * address.ts
 *
 * Display helpers for Stellar addresses.
 *
 * A full address is 56 characters, so a list or a nav bar shows a shortened
 * form and keeps the full value in the `title` attribute (and behind the copy
 * button). Every abbreviation in the app goes through here so the two ends are
 * cut consistently.
 */

/**
 * `GABC…WXYZ` — enough to compare two addresses by eye without wrapping a line.
 *
 * An address shorter than the two ends combined is returned unchanged: a
 * truncated fragment of a malformed value would be more confusing than the
 * value itself.
 */
export function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
