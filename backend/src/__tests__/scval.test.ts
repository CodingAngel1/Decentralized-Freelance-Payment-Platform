import { describe, expect, it } from "vitest";
import { Keypair, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  buildArbitrateArgs,
  buildFundArgs,
  buildOpenDisputeArgs,
  buildReclaimArgs,
  buildReleaseMilestoneArgs,
  buildReputationSubmitArgs,
  scAddress,
  scI128,
  scU32,
  scU64,
} from "../lib/scval";

/**
 * The ScVal union tag ("scvU32", "scvI128", …). Soroban decodes an entry-point
 * argument against the contract spec by this tag, so a test that only checks the
 * decoded *value* would not catch the bug these helpers exist to prevent.
 */
const tag = (val: xdr.ScVal): string => val.switch().name;

describe("typed ScVal encoders", () => {
  it("names the type explicitly instead of letting the SDK infer it", () => {
    expect(tag(scU32(5))).toBe("scvU32");
    expect(tag(scU64(5n))).toBe("scvU64");
    expect(tag(scI128(5n))).toBe("scvI128");
    // A negative share must stay i128, not become i64.
    expect(tag(scI128(-1n))).toBe("scvI128");
    expect(tag(scAddress(Keypair.random().publicKey()))).toBe("scvAddress");
  });

  it("documents the inference that shipped the bug", () => {
    // `nativeToScVal` picks u64/i64 for plain numbers and bigints — never u32
    // or i128 — which is why every argument goes through the encoders above.
    expect(tag(nativeToScVal(5))).toBe("scvU64");
    expect(tag(nativeToScVal(5n))).toBe("scvU64");
    expect(tag(nativeToScVal(-1))).toBe("scvI64");
  });
});

describe("route argument builders", () => {
  it("buildFundArgs: escrow_id is u64", () => {
    const args = buildFundArgs(7n);
    expect(args.map(tag)).toEqual(["scvU64"]);
    expect(scValToNative(args[0])).toBe(7n);
  });

  it("buildReleaseMilestoneArgs: milestone_index is u32, not the inferred u64", () => {
    const args = buildReleaseMilestoneArgs(7n, 2);
    expect(args.map(tag)).toEqual(["scvU64", "scvU32"]);
    expect(scValToNative(args[0])).toBe(7n);
    expect(scValToNative(args[1])).toBe(2);
    // The same index through the raw helper is a u64, which the contract rejects.
    expect(tag(nativeToScVal(2))).toBe("scvU64");
  });

  it("buildReclaimArgs: escrow_id is u64", () => {
    expect(buildReclaimArgs(7n).map(tag)).toEqual(["scvU64"]);
  });

  it("buildOpenDisputeArgs: escrow_id is u64 and initiator is an address", () => {
    const initiator = Keypair.random().publicKey();
    const args = buildOpenDisputeArgs(7n, initiator);
    expect(args.map(tag)).toEqual(["scvU64", "scvAddress"]);
    expect(scValToNative(args[1])).toBe(initiator);
  });

  it("buildReputationSubmitArgs: score is u32", () => {
    const rater = Keypair.random().publicKey();
    const ratee = Keypair.random().publicKey();

    const args = buildReputationSubmitArgs(rater, ratee, 7n, 5);

    expect(args.map(tag)).toEqual(["scvAddress", "scvAddress", "scvU64", "scvU32"]);
    expect(scValToNative(args[0])).toBe(rater);
    expect(scValToNative(args[1])).toBe(ratee);
    expect(scValToNative(args[2])).toBe(7n);
    expect(scValToNative(args[3])).toBe(5);
  });

  it("buildArbitrateArgs: both shares are i128", () => {
    const args = buildArbitrateArgs(3n, 25_000_000n, 0n);

    expect(args.map(tag)).toEqual(["scvU64", "scvI128", "scvI128"]);
    expect(scValToNative(args[1])).toBe(25_000_000n);
    expect(scValToNative(args[2])).toBe(0n);
    // A share through the raw helper is a u64, which the contract rejects.
    expect(tag(nativeToScVal(25_000_000n))).toBe("scvU64");
  });
});
