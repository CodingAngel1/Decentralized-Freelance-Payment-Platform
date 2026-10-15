/**
 * scval.ts
 *
 * Typed ScVal construction for every contract call the API builds.
 *
 * `nativeToScVal(value)` infers the Soroban type from the JS value: a small
 * non-negative `number`/`bigint` becomes `scvU64` (`scvI64` when negative),
 * never `u32` or `i128`. Soroban decodes entry-point arguments against the
 * contract spec, so a mismatch fails *before* the function body runs —
 * `Error(WasmVm, InvalidAction)` / `VM call trapped` — i.e. a transaction that
 * can never succeed. Three routes shipped that way (docs: issue #97), which is
 * why the type is always named explicitly here.
 *
 * This mirrors the frontend's `frontend/src/lib/stellar.ts`
 * (scAddress / scU32 / scU64 / scI128) so both clients encode the same calls
 * identically, and it is the only place the backend should build ScVals for a
 * route argument.
 *
 * Contract signatures these builders must keep matching:
 *   escrow.fund(escrow_id: u64)
 *   escrow.release_milestone(escrow_id: u64, milestone_index: u32)
 *   escrow.reclaim_expired(escrow_id: u64)
 *   escrow.reclaim_after_dispute_timeout(escrow_id: u64)
 *   escrow.open_dispute(escrow_id: u64, initiator: Address)
 *   reputation.submit(rater: Address, ratee: Address, escrow_id: u64, score: u32)
 *   dispute.arbitrate(dispute_id: u64, client_share: i128, freelancer_share: i128)
 */

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

// ---------------------------------------------------------------------------
// Typed encoders
// ---------------------------------------------------------------------------

export const scAddress = (address: string): xdr.ScVal =>
  Address.fromString(address).toScVal();

export const scU32 = (n: number): xdr.ScVal => nativeToScVal(n, { type: "u32" });

export const scU64 = (n: number | bigint): xdr.ScVal =>
  nativeToScVal(n, { type: "u64" });

export const scI128 = (n: number | bigint): xdr.ScVal =>
  nativeToScVal(n, { type: "i128" });

// ---------------------------------------------------------------------------
// Route argument builders
//
// One per route, so the positional types are asserted in a test instead of
// being re-derived at each call site.
// ---------------------------------------------------------------------------

/** `escrow.fund(escrow_id)` */
export function buildFundArgs(escrowId: number | bigint): xdr.ScVal[] {
  return [scU64(escrowId)];
}

/** `escrow.release_milestone(escrow_id, milestone_index)` */
export function buildReleaseMilestoneArgs(
  escrowId: number | bigint,
  milestoneIndex: number,
): xdr.ScVal[] {
  return [scU64(escrowId), scU32(milestoneIndex)];
}

/** `escrow.reclaim_expired(escrow_id)` */
export function buildReclaimArgs(escrowId: number | bigint): xdr.ScVal[] {
  return [scU64(escrowId)];
}

/**
 * `escrow.reclaim_after_dispute_timeout(escrow_id)`
 *
 * Same single-`u64` shape as `reclaim_expired`, but a different entry point: this
 * is the timelock escape hatch from `Disputed`, not the expiry refund from
 * `Active`. Keep it separate so the two calls cannot be swapped silently.
 */
export function buildReclaimDisputeArgs(escrowId: number | bigint): xdr.ScVal[] {
  return [scU64(escrowId)];
}

/** `escrow.open_dispute(escrow_id, initiator)` */
export function buildOpenDisputeArgs(
  escrowId: number | bigint,
  initiator: string,
): xdr.ScVal[] {
  return [scU64(escrowId), scAddress(initiator)];
}

/** `reputation.submit(rater, ratee, escrow_id, score)` */
export function buildReputationSubmitArgs(
  rater: string,
  ratee: string,
  escrowId: number | bigint,
  score: number,
): xdr.ScVal[] {
  return [scAddress(rater), scAddress(ratee), scU64(escrowId), scU32(score)];
}

/**
 * `dispute.arbitrate(dispute_id, client_share, freelancer_share)`
 *
 * Shares are already in base units (i128 stroops) by the time they get here.
 */
export function buildArbitrateArgs(
  disputeId: number | bigint,
  clientShareBaseUnits: bigint,
  freelancerShareBaseUnits: bigint,
): xdr.ScVal[] {
  return [
    scU64(disputeId),
    scI128(clientShareBaseUnits),
    scI128(freelancerShareBaseUnits),
  ];
}
