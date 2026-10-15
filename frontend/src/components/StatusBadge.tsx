/**
 * StatusBadge.tsx
 *
 * Renders an escrow status with a distinct colour per state. Unknown statuses
 * fall back to a neutral badge rather than throwing.
 *
 * Contributor Notes:
 * - The two sources disagree on case: the escrow contract returns
 *   `EscrowStatus`'s `Debug` form (`Active`), while `GET /api/jobs` serializes
 *   the Prisma enum (`ACTIVE`). Looking the status up case-insensitively means
 *   the dashboard's list is colour-coded too, instead of every row falling
 *   through to the neutral badge.
 */

const STATUS_CLASS: Record<string, string> = {
  created: "badge badge-created",
  active: "badge badge-active",
  completed: "badge badge-completed",
  disputed: "badge badge-disputed",
  refunded: "badge badge-refunded",
};

export default function StatusBadge({ status }: { status: string }) {
  const className = STATUS_CLASS[status.toLowerCase()] ?? "badge badge-unknown";
  return <span className={className}>{status}</span>;
}
