/**
 * events.ts
 *
 * Pure decoders for Soroban contract events (see docs/EVENTS.md).
 *
 * An event's `topic[0]` is a `Symbol` carrying the event name (e.g.
 * `milestone_released`), `topic[1]` is the struct field annotated `#[topic]`,
 * and `value` is a map of the remaining fields keyed by field name. These
 * helpers never throw — malformed events decode to `null`/`{}` and are ignored
 * by the indexer rather than crashing it.
 *
 * The two-places-the-id-lives split matters: `created` and `funded` have
 * `client` as their `#[topic]` field, so their `escrow_id` is in the data map,
 * while `milestone_released`, `dispute_opened`, `resolved`, `refunded`,
 * `raised`, `dispute_resolved` and `rated` carry `escrow_id` as the topic field
 * and *not* in the data map. Use `eventEscrowId` rather than reading
 * `escrow_id` off the data map.
 */

import { scValToNative, xdr } from "@stellar/stellar-sdk";

/** The event names the indexer knows about (others are ignored). */
export const KNOWN_EVENTS = new Set([
  "created",
  "funded",
  "milestones_updated",
  "milestone_released",
  "dispute_opened",
  "resolved",
  "refunded",
  "raised",
  "approved",
  "dispute_resolved",
  "rated",
]);

export interface ContractEventLike {
  id?: string;
  ledger: number;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
}

/** The event name from `topic[0]`, or `null` if it is missing/malformed. */
export function decodeEventName(event: Pick<ContractEventLike, "topic">): string | null {
  const topic0 = event.topic?.[0];
  if (!topic0) return null;
  try {
    const name = scValToNative(topic0);
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/** The event's data fields, or `{}` if the value is missing/malformed. */
export function decodeEventData(
  event: Pick<ContractEventLike, "value">,
): Record<string, unknown> {
  try {
    const data = scValToNative(event.value);
    return data !== null && typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The `#[topic]` field of an event (`topic[1]`) as a native value, or `null` when
 * it is missing/malformed.
 */
export function decodeEventTopic(
  event: Pick<ContractEventLike, "topic">,
): unknown {
  const topic1 = event.topic?.[1];
  if (!topic1) return null;
  try {
    return scValToNative(topic1);
  } catch {
    return null;
  }
}

/** Coerce an event field that should be a u64 into a bigint. */
function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

/**
 * The escrow an event refers to.
 *
 * Read the data map first (`created`/`funded` carry `escrow_id` there) and fall
 * back to the `#[topic]` field, which is where every other event's `escrow_id`
 * lives. Reading only the data map made those handlers return immediately, so
 * the events they were written for never reached the database.
 */
export function eventEscrowId(event: ContractEventLike): bigint | null {
  return toBigInt(decodeEventData(event).escrow_id) ?? toBigInt(decodeEventTopic(event));
}
