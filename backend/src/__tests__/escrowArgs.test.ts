import { describe, it, expect } from "vitest";
import { Keypair, scValToNative } from "@stellar/stellar-sdk";
import {
  buildCreateArgs,
  buildUpdateMilestonesArgs,
  milestonesToScVal,
} from "../lib/escrowArgs";

describe("milestonesToScVal", () => {
  it("round-trips milestones with the contract's field names and types", () => {
    const decoded = scValToNative(
      milestonesToScVal([
        { amount: 300n, deadline: 0n },
        { amount: 700n, deadline: 1_700_000_000n },
      ]),
    );

    expect(decoded).toEqual([
      { amount: 300n, released: false, released_amount: 0n, deadline: 0n },
      {
        amount: 700n,
        released: false,
        released_amount: 0n,
        deadline: 1_700_000_000n,
      },
    ]);
  });

  it("encodes an empty list as an empty vector", () => {
    expect(scValToNative(milestonesToScVal([]))).toEqual([]);
  });
});

describe("buildCreateArgs", () => {
  it("builds [client, freelancer, token, milestones, expiry] with correct types", () => {
    const client = Keypair.random().publicKey();
    const freelancer = Keypair.random().publicKey();
    const token = Keypair.random().publicKey();

    const args = buildCreateArgs({
      client,
      freelancer,
      token,
      milestones: [{ amount: 1_000n, deadline: 0n }],
      expiry: 1_700_000_000n,
    });

    expect(args).toHaveLength(5);
    expect(scValToNative(args[0])).toBe(client);
    expect(scValToNative(args[1])).toBe(freelancer);
    expect(scValToNative(args[2])).toBe(token);
    expect(scValToNative(args[3])).toEqual([
      { amount: 1_000n, released: false, released_amount: 0n, deadline: 0n },
    ]);
    expect(scValToNative(args[4])).toBe(1_700_000_000n);
  });
});

describe("buildUpdateMilestonesArgs", () => {
  it("builds [escrow_id, milestones] with the contract's types", () => {
    const args = buildUpdateMilestonesArgs({
      escrowId: 7n,
      milestones: [
        { amount: 300n, deadline: 0n },
        { amount: 700n, deadline: 1_700_000_000n },
      ],
    });

    expect(args).toHaveLength(2);
    expect(scValToNative(args[0])).toBe(7n);
    expect(scValToNative(args[1])).toEqual([
      { amount: 300n, released: false, released_amount: 0n, deadline: 0n },
      { amount: 700n, released: false, released_amount: 0n, deadline: 1_700_000_000n },
    ]);
  });

  it("encodes milestones exactly like create does for the same list", () => {
    // `update_milestones` replaces the whole breakdown, so the two entry points
    // must not drift apart on field names, order or types.
    const milestones = [{ amount: 1_000n, deadline: 42n }];
    const [, updateEncoded] = buildUpdateMilestonesArgs({ escrowId: 1n, milestones });

    expect(updateEncoded.toXDR("base64")).toBe(
      buildCreateArgs({
        client: Keypair.random().publicKey(),
        freelancer: Keypair.random().publicKey(),
        token: Keypair.random().publicKey(),
        milestones,
        expiry: 1_700_000_000n,
      })[3].toXDR("base64"),
    );
  });
});
