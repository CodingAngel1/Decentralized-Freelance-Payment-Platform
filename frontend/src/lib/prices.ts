/**
 * prices.ts
 *
 * Fiat estimates for on-screen amounts (issue #76). "1.5 XLM" means little to
 * someone deciding whether a budget is sensible, so the UI shows an
 * approximate dollar figure beside it.
 *
 * Every path here fails soft: a missing, slow, rate-limited or malformed price
 * response yields no rates, and the UI simply shows no estimate instead of an
 * error. Amounts are never blocked on a price feed — this is a hint, not a
 * quote.
 *
 * Contributor Notes:
 * - Source is CoinGecko's `simple/price`, which is keyless and CORS-enabled, so
 *   the browser can call it directly. `VITE_PRICE_API_URL` repoints at another
 *   deployment shape (a proxy, a self-hosted mirror) and `VITE_PRICE_API_KEY`
 *   is sent as `x-cg-demo-api-key` for a rate-limit-raising demo key. Both are
 *   optional; the default works with no configuration.
 * - Which feed id an asset uses lives on the asset registry (`priceId` in
 *   `lib/assets.ts`), so registering a new asset is still a one-file change.
 * - Rates are cached for `RATE_TTL_MS` and a *failure* is cached for
 *   `FAILURE_TTL_MS`: a flaky feed must not mean a request per component.
 */

import { ASSETS } from "./assets";

/** Quote currency. Everything here is a USD estimate. */
export const FIAT = "USD";

/** Asset symbol → USD per one whole unit. Empty means "no estimate available". */
export type FiatRates = Record<string, number>;

const DEFAULT_PRICE_API_URL = "https://api.coingecko.com/api/v3/simple/price";

/** Overridable so a deployment can proxy the feed (or self-host a mirror). */
export const PRICE_API_URL = import.meta.env.VITE_PRICE_API_URL || DEFAULT_PRICE_API_URL;

const PRICE_API_KEY = import.meta.env.VITE_PRICE_API_KEY;

/** How long a good rate is reused. Prices do not move faster than this matters. */
export const RATE_TTL_MS = 5 * 60 * 1000;

/** How long a failed lookup is remembered before trying again. */
export const FAILURE_TTL_MS = 30 * 1000;

/** A price feed hanging must not leave a request open for the session. */
const TIMEOUT_MS = 5 * 1000;

/** Feed ids for the registered assets, de-duplicated and sorted. */
function priceIds(): string[] {
  const ids = new Set<string>();
  for (const asset of ASSETS) if (asset.priceId) ids.add(asset.priceId);
  return [...ids].sort();
}

/** The URL for one lookup, covering every registered asset. */
export function buildPriceUrl(): string {
  const params = new URLSearchParams({
    ids: priceIds().join(","),
    vs_currencies: FIAT.toLowerCase(),
  });
  return `${PRICE_API_URL}?${params.toString()}`;
}

/**
 * Turn a `simple/price` body into per-symbol rates.
 *
 * Defensive on purpose: this parses a third party's document, so anything
 * unexpected is skipped rather than trusted. A missing, non-numeric, zero or
 * negative price means that asset gets no estimate.
 */
export function parsePriceResponse(payload: unknown): FiatRates {
  if (typeof payload !== "object" || payload === null) return {};
  const body = payload as Record<string, unknown>;
  const rates: FiatRates = {};

  for (const asset of ASSETS) {
    if (!asset.priceId) continue;
    const entry = body[asset.priceId];
    if (typeof entry !== "object" || entry === null) continue;
    // Some feeds quote numbers as strings; accept both, reject everything else.
    const raw = (entry as Record<string, unknown>)[FIAT.toLowerCase()];
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    rates[asset.symbol] = value;
  }

  return rates;
}

/**
 * Fiat value of `amount` of `symbol`, or `null` when there is no rate for it.
 *
 * The return value is an estimate and stays a float: it is a comparison aid,
 * not a settlement amount (see `lib/assets.ts` for exact money maths).
 */
export function estimateFiat(
  amount: number | string,
  symbol: string,
  rates: FiatRates,
): number | null {
  const rate = rates[(symbol ?? "").trim().toUpperCase()];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  // A half-typed amount ("" while a field is being cleared) is not a zero, so
  // it gets no estimate rather than a misleading `$0.00`.
  if (typeof amount === "string" && amount.trim() === "") return null;
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return null;
  return value * rate;
}

/** Render an estimate for display: two decimals, never a misleading `$0.00`. */
export function formatFiat(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

interface CacheEntry {
  rates: FiatRates;
  at: number;
  ttl: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<FiatRates> | null = null;

/** The last rates, if they are still fresh. Used to render without a flash. */
export function cachedFiatRates(now: number = Date.now()): FiatRates {
  return cache && now - cache.at < cache.ttl ? cache.rates : {};
}

/**
 * Fetch rates, reusing a cached or in-flight result.
 *
 * `now` is injectable so the cache's expiry can be exercised without waiting.
 */
export async function getFiatRates(now: number = Date.now()): Promise<FiatRates> {
  if (cache && now - cache.at < cache.ttl) return cache.rates;
  // Two components mounting together must not mean two requests.
  if (inflight) return inflight;

  inflight = loadRates(now);
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** One lookup. Any failure resolves to no rates and is cached briefly. */
async function loadRates(now: number): Promise<FiatRates> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (PRICE_API_KEY) headers["x-cg-demo-api-key"] = PRICE_API_KEY;

    const res = await fetch(buildPriceUrl(), { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`Price feed responded HTTP ${res.status}`);

    const rates = parsePriceResponse(await res.json());
    if (Object.keys(rates).length === 0) throw new Error("Price feed returned no usable rates");

    cache = { rates, at: now, ttl: RATE_TTL_MS };
    return rates;
  } catch {
    // Deliberately swallowed: an unavailable rate is a missing estimate, not
    // an error the user can act on, and it must never break the page.
    cache = { rates: {}, at: now, ttl: FAILURE_TTL_MS };
    return {};
  } finally {
    clearTimeout(timer);
  }
}
