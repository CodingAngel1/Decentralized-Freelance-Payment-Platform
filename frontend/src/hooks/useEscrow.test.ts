import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// Hoisted so the vi.mock factories below can reference them.
const h = vi.hoisted(() => ({
  wallet: {
    publicKey: "GCLIENT" as string | null,
    connecting: false,
    error: null as string | null,
    connect: vi.fn(async () => "GCLIENT"),
    disconnect: vi.fn(),
    sign: vi.fn(async () => "signed-xdr"),
    signMessage: vi.fn(async () => "sig"),
  },
  buildContractCall: vi.fn(),
  readContract: vi.fn(),
  sendTransaction: vi.fn(),
  pollTransaction: vi.fn(),
}));

vi.mock("./wallet-context", () => ({ useWallet: () => h.wallet }));

vi.mock("../lib/stellar", () => ({
  CONTRACT_ADDRESSES: {
    escrow: "CESCROW",
    dispute: "CDISPUTE",
    reputation: "CREP",
    usdc: "CUSDC",
  },
  buildContractCall: h.buildContractCall,
  readContract: h.readContract,
  milestonesToScVal: vi.fn(() => ({})),
  networkPassphrase: "Test SDF Network ; September 2015",
  pollTransaction: h.pollTransaction,
  scAddress: vi.fn(() => ({})),
  scString: vi.fn(() => ({})),
  scU32: vi.fn(() => ({})),
  scU64: vi.fn(() => ({})),
  server: { sendTransaction: h.sendTransaction },
}));

vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: { fromXDR: vi.fn(() => ({})) },
  SorobanRpc: { Api: { GetTransactionStatus: { SUCCESS: "SUCCESS", NOT_FOUND: "NOT_FOUND" } } },
  xdr: {},
}));

import { useEscrow } from "./useEscrow";
// The mocked helpers, so we can assert how the arguments are encoded.
import { scString, scU32, scU64 } from "../lib/stellar";

beforeEach(() => {
  h.wallet.publicKey = "GCLIENT";
  h.buildContractCall.mockReset();
  h.readContract.mockReset();
  h.sendTransaction.mockReset();
  h.pollTransaction.mockReset();

  h.buildContractCall.mockResolvedValue({ xdr: "tx-xdr", result: 0n });
  h.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH" });
  h.pollTransaction.mockResolvedValue({ status: "SUCCESS" });
});

afterEach(() => cleanup());

/** A buildContractCall whose promise is resolved manually. */
function deferredBuild() {
  let resolve: (value: { xdr: string; result: unknown }) => void = () => {};
  h.buildContractCall.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  return (value: { xdr: string; result: unknown } = { xdr: "x", result: undefined }) =>
    resolve(value);
}

describe("useEscrow transaction state", () => {
  it("does not start the same target twice (double-submit guard)", async () => {
    const settle = deferredBuild();
    const { result } = renderHook(() => useEscrow());

    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    act(() => {
      first = result.current.releaseMilestone(1n, 0);
      second = result.current.releaseMilestone(1n, 0);
    });

    // The duplicate was ignored: only one transaction was built.
    expect(h.buildContractCall).toHaveBeenCalledTimes(1);

    let secondResult: unknown = "not-resolved";
    await act(async () => {
      settle();
      secondResult = await second;
      await first;
    });
    // The guarded call resolves to `undefined` without doing any work.
    expect(secondResult).toBeUndefined();
    expect(result.current.isPending("release", "1:0")).toBe(false);
  });

  it("scopes pending state to the affected target, not unrelated ones", async () => {
    const settle = deferredBuild();
    const { result } = renderHook(() => useEscrow());

    act(() => {
      void result.current.releaseMilestone(1n, 0);
    });

    await waitFor(() => expect(result.current.isPending("release", "1:0")).toBe(true));
    expect(result.current.isPending("release", "1:1")).toBe(false);
    expect(result.current.isPending("dispute", "1")).toBe(false);
    expect(result.current.hasPendingWrite()).toBe(true);

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(result.current.hasPendingWrite()).toBe(false));
  });

  it("submits the dispute-timelock reclaim as escrow.reclaim_after_dispute_timeout", async () => {
    const { result } = renderHook(() => useEscrow());

    await act(async () => {
      await result.current.reclaimDisputed(7n);
    });

    const [pk, contractId, method, args] = h.buildContractCall.mock.calls[0] as unknown as [
      string,
      string,
      string,
      unknown[],
    ];
    expect(pk).toBe("GCLIENT");
    expect(contractId).toBe("CESCROW");
    expect(method).toBe("reclaim_after_dispute_timeout");
    expect(args).toHaveLength(1);
    expect(scU64).toHaveBeenCalledWith(7n);
  });

  it("opens a dispute as escrow.open_dispute then dispute.raise, in that order", async () => {
    // `raise` is the call that mints the dispute the panel rules on; without it
    // the escrow is frozen with no dispute to arbitrate (#86). Its simulated
    // return value is the on-chain dispute id.
    h.buildContractCall
      .mockResolvedValueOnce({ xdr: "open-xdr", result: 0n })
      .mockResolvedValueOnce({ xdr: "raise-xdr", result: 3n });
    const { result } = renderHook(() => useEscrow());

    let opened: { hash: string; disputeId: bigint } | undefined;
    await act(async () => {
      opened = await result.current.openDispute(7n, "Milestone never delivered");
    });

    const calls = h.buildContractCall.mock.calls.map((call) => ({
      contractId: call[1],
      method: call[2],
      args: call[3],
    }));
    expect(calls.map((c) => `${c.contractId}.${c.method}`)).toEqual([
      "CESCROW.open_dispute",
      "CDISPUTE.raise",
    ]);
    expect(calls[0].args).toHaveLength(2);
    // escrow_id, the escrow *contract* (cross-called by raise), the raiser, the
    // reason — which must be a String, not a Symbol or Bytes.
    expect(calls[1].args).toHaveLength(4);
    expect(scU64).toHaveBeenCalledWith(7n);
    expect(scString).toHaveBeenCalledWith("Milestone never delivered");

    // The id comes from the simulation, since the return value does not survive
    // submission — this is what the caller records off-chain.
    expect(opened).toEqual({ hash: "HASH", disputeId: 3n });
    expect(result.current.error).toBeNull();
  });

  it("does not reach dispute.raise when open_dispute fails", async () => {
    h.buildContractCall.mockRejectedValueOnce(
      new Error("HostError: Error(Contract, #8)"),
    );
    const { result } = renderHook(() => useEscrow());

    await act(async () => {
      await result.current.openDispute(7n, "Milestone never delivered");
    });

    // A second transaction on a contract the first one never prepared would
    // fail anyway; failing fast keeps the escrow's state and the API's in step.
    expect(h.buildContractCall).toHaveBeenCalledTimes(1);
    // DisputeError #8 is `NotAParty`; the shared frontend map words it for the
    // escrow contract too, which is why it reads generically.
    expect(result.current.error).toBe(
      "The milestone list is invalid, or you're not a party to this job.",
    );
  });

  it("counts a dispute reclaim as a pending write so background polling pauses", async () => {
    const settle = deferredBuild();
    const { result } = renderHook(() => useEscrow());

    act(() => {
      void result.current.reclaimDisputed(1n);
    });

    await waitFor(() => expect(result.current.isPending("reclaim", "1")).toBe(true));
    expect(result.current.hasPendingWrite()).toBe(true);

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(result.current.hasPendingWrite()).toBe(false));
  });

  it("reads the dispute deadline through the escrow view", async () => {
    h.readContract.mockResolvedValueOnce(1_700_000_000n);
    const { result } = renderHook(() => useEscrow());

    let deadline: bigint | undefined;
    await act(async () => {
      deadline = await result.current.getDisputeDeadline(7n);
    });

    expect(deadline).toBe(1_700_000_000n);
    const [pk, contractId, method, args] = h.readContract.mock.calls[0] as unknown as [
      string,
      string,
      string,
      unknown[],
    ];
    expect(pk).toBe("GCLIENT");
    expect(contractId).toBe("CESCROW");
    expect(method).toBe("dispute_deadline");
    expect(args).toHaveLength(1);
    expect(scU64).toHaveBeenCalledWith(7n);
  });

  it("counts a rating as a pending write so background polling pauses", async () => {
    const settle = deferredBuild();
    const { result } = renderHook(() => useEscrow());

    act(() => {
      void result.current.submitRating(7n, "GRATEE", 5);
    });

    await waitFor(() => expect(result.current.isPending("rate", "7:GRATEE")).toBe(true));
    expect(result.current.hasPendingWrite()).toBe(true);

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(result.current.hasPendingWrite()).toBe(false));
  });

  it("submits a rating as reputation.submit with a u32 score", async () => {
    const { result } = renderHook(() => useEscrow());

    await act(async () => {
      await result.current.submitRating(7n, "GRATEE", 5);
    });

    const [pk, contractId, method, args] = h.buildContractCall.mock.calls[0] as unknown as [
      string,
      string,
      string,
      unknown[],
    ];
    expect(pk).toBe("GCLIENT");
    expect(contractId).toBe("CREP");
    expect(method).toBe("submit");
    expect(args).toHaveLength(4);
    expect(scU64).toHaveBeenCalledWith(7n);
    // The score must be u32; the i32 default from a bare number traps on-chain.
    expect(scU32).toHaveBeenCalledWith(5);
  });

  it("surfaces AlreadyRated through lastFailure and a friendly message", async () => {
    h.buildContractCall.mockRejectedValueOnce(new Error("HostError: Error(Contract, #5)"));
    const { result } = renderHook(() => useEscrow());

    await act(async () => {
      await result.current.submitRating(7n, "GRATEE", 5);
    });

    expect(result.current.lastFailure).toEqual({ kind: "rate", code: 5 });
    expect(result.current.error).toBe(
      "That milestone index is out of range, or you've already rated this job.",
    );
  });

  it("reports a non-contract failure without a code", async () => {
    h.buildContractCall.mockRejectedValueOnce(new Error("wallet not connected"));
    const { result } = renderHook(() => useEscrow());

    await act(async () => {
      await result.current.submitRating(7n, "GRATEE", 5);
    });

    expect(result.current.lastFailure).toEqual({ kind: "rate", code: null });
    expect(result.current.error).toBe("wallet not connected");
  });

  it("clears a previous error after a subsequent successful read", async () => {
    h.buildContractCall.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useEscrow());

    await act(async () => {
      await result.current.releaseMilestone(1n, 0);
    });
    expect(result.current.error).toBe("boom");

    h.readContract.mockResolvedValueOnce({ status: "Active" });
    await act(async () => {
      await result.current.getEscrow(1n);
    });
    expect(result.current.error).toBeNull();
  });
});
