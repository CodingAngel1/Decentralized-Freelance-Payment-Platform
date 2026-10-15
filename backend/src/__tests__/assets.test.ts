import { describe, it, expect } from "vitest";
import { fromBaseUnits, getAsset, toBaseUnits, UnknownAssetError } from "../lib/assets";

describe("asset registry", () => {
  it("converts amounts using each asset's decimals", () => {
    expect(toBaseUnits("1.5", getAsset("USDC").decimals)).toBe(15_000_000n);
    expect(toBaseUnits("0.1", getAsset("XLM").decimals)).toBe(1_000_000n);
    // Trailing precision is padded to the asset's scale.
    expect(toBaseUnits(2, getAsset("USDC").decimals)).toBe(20_000_000n);
  });

  it("looks up assets case-insensitively", () => {
    expect(getAsset("usdc").symbol).toBe("USDC");
    expect(getAsset(" Xlm ").symbol).toBe("XLM");
  });

  it("rejects an unknown asset", () => {
    expect(() => getAsset("DOGE")).toThrow(UnknownAssetError);
  });
});

describe("fromBaseUnits", () => {
  const decimals = getAsset("USDC").decimals;

  it("renders base units as a decimal string", () => {
    expect(fromBaseUnits(10_000_000n, decimals)).toBe("1");
    expect(fromBaseUnits(15_000_000n, decimals)).toBe("1.5");
    expect(fromBaseUnits(25_000_000n, decimals)).toBe("2.5");
    // Below one whole unit, and a single base unit.
    expect(fromBaseUnits(1n, decimals)).toBe("0.0000001");
    expect(fromBaseUnits(0n, decimals)).toBe("0");
  });

  it("round-trips through toBaseUnits", () => {
    for (const amount of ["1", "2.5", "0.1", "1234.5678901", "0.0000001"]) {
      expect(fromBaseUnits(toBaseUnits(amount, decimals), decimals)).toBe(amount);
    }
  });

  it("handles an asset with no fractional part", () => {
    expect(fromBaseUnits(1_000n, 0)).toBe("1000");
  });
});
