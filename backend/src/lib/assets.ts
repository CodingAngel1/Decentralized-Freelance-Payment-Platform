/**
 * assets.ts
 *
 * Data-driven registry of the Stellar Asset Contracts (SACs) a job can be paid
 * in. Mirrors `frontend/src/lib/assets.ts`; the contract id is read from config
 * via `configKey`, so adding a new asset is a config entry plus a line here.
 *
 * Kept free of any `config` import so the conversion/registry logic is unit
 * testable without environment variables.
 */

export interface AssetInfo {
  symbol: string;
  /** Number of decimal places the asset uses (USDC and XLM both use 7). */
  decimals: number;
  /** Config key holding the SAC contract id. */
  configKey: "USDC_CONTRACT_ID" | "XLM_CONTRACT_ID";
}

export const ASSETS: Record<string, AssetInfo> = {
  USDC: { symbol: "USDC", decimals: 7, configKey: "USDC_CONTRACT_ID" },
  XLM: { symbol: "XLM", decimals: 7, configKey: "XLM_CONTRACT_ID" },
};

export class UnknownAssetError extends Error {
  constructor(symbol: string) {
    super(`Unknown asset: ${symbol}`);
    this.name = "UnknownAssetError";
  }
}

/** Look up an asset by symbol (case-insensitive). Throws if unknown. */
export function getAsset(symbol: string): AssetInfo {
  const key = symbol.trim().toUpperCase();
  const asset = ASSETS[key];
  if (!asset) throw new UnknownAssetError(symbol);
  return asset;
}

/** Convert a decimal amount (e.g. from Prisma) into integer base units. */
export function toBaseUnits(amount: number | string, decimals: number): bigint {
  const value = typeof amount === "number" ? amount.toFixed(decimals) : amount;
  const negative = value.trim().startsWith("-");
  const [whole = "0", frac = ""] = value.trim().replace("-", "").split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const raw = BigInt(`${whole || "0"}${padded}`);
  return negative ? -raw : raw;
}

/**
 * The inverse of `toBaseUnits`, as a string for `Decimal` columns (Prisma
 * accepts a numeric string for a `Decimal` field, and a string cannot lose
 * precision the way a JS number can). Trailing zeros are trimmed, so
 * `10_000_000n` at 7 decimals is `"1"`, not `"1.0000000"`.
 */
export function fromBaseUnits(base: bigint, decimals: number): string {
  const negative = base < 0n;
  const digits = (negative ? -base : base).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals) || "0";
  const fraction =
    decimals > 0 ? digits.slice(digits.length - decimals).replace(/0+$/, "") : "";
  const value = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${value}` : value;
}
