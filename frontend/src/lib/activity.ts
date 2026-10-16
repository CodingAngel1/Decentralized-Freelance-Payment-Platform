/**
 * activity.ts
 *
 * Human labels for the contract events the backend indexes into a transaction
 * history (issue #72). The API returns the raw event name from `topic[0]`
 * (`docs/EVENTS.md`); the UI should not show `milestone_released` to a client.
 *
 * Kept out of the page components so it stays pure and testable.
 */

const ACTION_LABELS: Record<string, string> = {
  created: "Escrow created",
  funded: "Escrow funded",
  milestones_updated: "Milestones updated",
  milestone_released: "Milestone released",
  dispute_opened: "Dispute opened",
  raised: "Dispute raised",
  approved: "Dispute approved",
  resolved: "Dispute resolved",
  dispute_resolved: "Dispute resolved",
  refunded: "Escrow refunded",
  rated: "Rating submitted",
};

/**
 * A readable label for an indexed event name. An event this build does not know
 * (a contract deployed ahead of the frontend) falls back to its name with the
 * underscores opened up rather than being hidden.
 */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}
