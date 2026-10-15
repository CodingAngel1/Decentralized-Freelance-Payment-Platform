/**
 * time.ts
 *
 * Formatting helpers for the dispute timelock. The contract stores deadline and
 * ledger time as unix seconds (`u64`), so these work in seconds rather than
 * milliseconds and never assume a timezone beyond the viewer's locale.
 *
 * Kept out of the page components so they stay pure and testable, and so the
 * files that render them export only components (react-refresh).
 */

/** Whole seconds from `now` (unix seconds) until `deadline`, floored at zero. */
export function secondsUntil(deadline: bigint, now: number): number {
  const diff = Number(deadline) - now;
  return diff > 0 ? diff : 0;
}

/** A coarse countdown, e.g. `2d 3h` / `3h 4m` / `12s`. */
export function formatRemaining(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/** The deadline as a local wall-clock time, so a client knows when to return. */
export function formatDeadline(deadline: bigint): string {
  return new Date(Number(deadline) * 1000).toLocaleString();
}
