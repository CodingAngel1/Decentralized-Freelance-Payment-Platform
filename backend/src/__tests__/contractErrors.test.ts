import { describe, it, expect } from "vitest";
import {
  ESCROW_ERROR_MESSAGES,
  friendlyContractError,
  parseContractErrorCode,
} from "../lib/contractErrors";

describe("parseContractErrorCode", () => {
  it("extracts the discriminant from a Soroban host error", () => {
    expect(parseContractErrorCode("HostError: Error(Contract, #2)")).toBe(2);
    expect(parseContractErrorCode("Error(Contract, #16)")).toBe(16);
    // The spacing an RPC response may use.
    expect(parseContractErrorCode("Error(Contract,  #5)")).toBe(5);
  });

  it("returns null for anything that is not a contract error", () => {
    expect(parseContractErrorCode("Simulation failed: network timeout")).toBeNull();
    expect(parseContractErrorCode("")).toBeNull();
  });
});

describe("friendlyContractError", () => {
  it("names the escrow error the contract returned", () => {
    // InvalidStatus is the one the milestone-edit route relies on: the chain is
    // the authority on whether an escrow can still be edited.
    expect(friendlyContractError("HostError: Error(Contract, #2)")).toBe(
      ESCROW_ERROR_MESSAGES[2],
    );
    expect(friendlyContractError("HostError: Error(Contract, #1)")).toMatch(/escrow/i);
  });

  it("keeps the original text for a failure it cannot map", () => {
    const host = "Simulation failed: Connection refused";
    expect(friendlyContractError(host)).toBe(host);
    // A code outside the escrow enum is left alone rather than mislabeled.
    const unknown = "HostError: Error(Contract, #99)";
    expect(friendlyContractError(unknown)).toBe(unknown);
  });

  it("covers every EscrowError discriminant", () => {
    // contracts/interface/src/lib.rs declares 1..=16; a gap would leave an
    // avoidable raw host error in a 400 body.
    for (let code = 1; code <= 16; code++) {
      expect(ESCROW_ERROR_MESSAGES[code]).toBeTruthy();
      expect(parseContractErrorCode(`Error(Contract, #${code})`)).toBe(code);
    }
  });
});
