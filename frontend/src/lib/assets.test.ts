import { describe, expect, it } from "vitest";
import {
  formatAmount,
  fromBaseUnits,
  getAsset,
  toBaseUnits,
  UnknownAssetError,
} from "./assets";

describe("asset registry", () => {
  it("converts amounts using each asset's decimals", () => {
    expect(toBaseUnits("1.5", getAsset("USDC").decimals)).toBe(15_000_000n);
    expect(toBaseUnits("0.1", getAsset("XLM").decimals)).toBe(1_000_000n);
    expect(toBaseUnits(2, getAsset("USDC").decimals)).toBe(20_000_000n);
  });

  it("round-trips base units back to a display amount", () => {
    expect(fromBaseUnits(15_000_000n, 7)).toBeCloseTo(1.5);
  });

  it("looks up assets case-insensitively", () => {
    expect(getAsset("usdc").symbol).toBe("USDC");
  });

  it("rejects an unknown asset", () => {
    expect(() => getAsset("DOGE")).toThrow(UnknownAssetError);
  });
});

describe("exact money arithmetic", () => {
  const decimals = getAsset("USDC").decimals;

  it("sums in base units so the display matches the stored total", () => {
    // Three 0.1 milestones: the float sum is 0.30000000000000004, the exact sum 0.3.
    expect([0.1, 0.1, 0.1].reduce((sum, n) => sum + n, 0)).not.toBe(0.3);
    const total = ["0.1", "0.1", "0.1"].reduce(
      (sum, amount) => sum + toBaseUnits(amount, decimals),
      0n,
    );
    expect(total).toBe(3_000_000n);
    expect(formatAmount(total, decimals)).toBe("0.3");
  });

  it("formats base units without trailing zeros", () => {
    expect(formatAmount(3_000_000n, 7)).toBe("0.3");
    expect(formatAmount(20_000_000n, 7)).toBe("2");
    expect(formatAmount(0n, 7)).toBe("0");
  });
});
