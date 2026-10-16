import { describe, expect, it } from "vitest";
import { parseEscrowId } from "./escrowId";

describe("parseEscrowId", () => {
  it("parses zero and small positive integers", () => {
    expect(parseEscrowId("0")).toBe(0n);
    expect(parseEscrowId("1")).toBe(1n);
    expect(parseEscrowId("42")).toBe(42n);
    expect(parseEscrowId("100")).toBe(100n);
  });

  it("parses the maximum u64 value", () => {
    expect(parseEscrowId("18446744073709551615")).toBe(18_446_744_073_709_551_615n);
  });

  it("rejects values greater than u64 max", () => {
    expect(parseEscrowId("18446744073709551616")).toBeNull();
    expect(parseEscrowId("99999999999999999999")).toBeNull();
  });

  it("rejects non-numeric strings", () => {
    expect(parseEscrowId("abc")).toBeNull();
    expect(parseEscrowId("abc123")).toBeNull();
    expect(parseEscrowId("not-a-number")).toBeNull();
  });

  it("rejects floating-point notation", () => {
    expect(parseEscrowId("1.5")).toBeNull();
    expect(parseEscrowId("0.0")).toBeNull();
    expect(parseEscrowId("1e5")).toBeNull();
  });

  it("rejects negative numbers", () => {
    expect(parseEscrowId("-1")).toBeNull();
    expect(parseEscrowId("-100")).toBeNull();
  });

  it("rejects the empty string", () => {
    expect(parseEscrowId("")).toBeNull();
  });

  it("rejects strings with leading/trailing whitespace", () => {
    // The caller should trim; the parser does not silently accept padded input.
    expect(parseEscrowId(" 1")).toBeNull();
    expect(parseEscrowId("1 ")).toBeNull();
    expect(parseEscrowId(" 1 ")).toBeNull();
  });
});
