/**
 * contractErrors.ts
 *
 * Turns a Soroban host error into something worth returning to an API caller.
 *
 * A contract failure reaches the caller as
 * `HostError: Error(Contract, #N)` inside the simulation response, where `N` is
 * the `#[contracterror]` discriminant from `contracts/interface/src/lib.rs`.
 * Passing that through as an HTTP 400 body tells the client nothing, so the
 * codes the escrow routes can produce are named here — mirroring the same
 * mapping the frontend uses to render contract failures
 * (`frontend/src/lib/errors.ts`).
 *
 * Never throws: an unrecognized message is returned unchanged so a genuinely
 * unexpected failure is still visible rather than swallowed.
 */

/** `EscrowError` discriminants from `contracts/interface/src/lib.rs`. */
export const ESCROW_ERROR_MESSAGES: Record<number, string> = {
  1: "That escrow doesn't exist.",
  2: "The escrow isn't in a state that allows this action (milestones can only be edited before the escrow is funded).",
  3: "You're not authorized to perform this action.",
  4: "That milestone has already been released.",
  5: "That milestone index is out of range.",
  6: "The escrow hasn't reached its expiry yet, or funds were already released.",
  7: "Amounts must be greater than zero.",
  8: "The milestone list is invalid.",
  9: "The expiry time is invalid.",
  10: "The client and freelancer must be different addresses.",
  11: "This contract is already initialized.",
  12: "This contract isn't initialized yet.",
  13: "The dispute shares don't match the funds held.",
  14: "A numeric overflow occurred.",
  15: "That amount is more than what's left on the milestone.",
  16: "The dispute timeout hasn't been reached yet.",
};

/** Extract the `#N` discriminant from a Soroban contract error, if present. */
export function parseContractErrorCode(message: string): number | null {
  const match = /Error\(Contract,\s*#(\d+)\)/.exec(message);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isInteger(code) ? code : null;
}

/**
 * Map a simulation error to a readable message. Recognized escrow codes are
 * translated; anything else (host/crypto failures, RPC errors) keeps its
 * original text.
 */
export function friendlyContractError(message: string): string {
  const code = parseContractErrorCode(message);
  if (code === null) return message;
  return ESCROW_ERROR_MESSAGES[code] ?? message;
}
