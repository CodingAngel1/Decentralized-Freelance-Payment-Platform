/**
 * prices.test.ts
 *
 * The fiat estimate (issue #76) is built on a third party's response, so the
 * cases that matter are the unhappy ones: a feed that is down, rate-limited,
 * slow, or answering with something unexpected must produce *no estimate*
 * rather than an error or a wrong number.
 *
 * `fetch` is stubbed throughout — these tests never touch the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PricesModule = typeof import("./prices");

let prices: PricesModule;
let fetchMock: ReturnType<typeof vi.fn>;

/** The module caches rates, so each test gets a fresh copy of it. */
beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  prices = await import("./prices");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A CoinGecko `simple/price` body for both registered assets. */
const LIVE_BODY = { stellar: { usd: 0.1838 }, "usd-coin": { usd: 0.9998 } };

function ok(body: unknown = LIVE_BODY) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function httpError(status = 500) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

describe("buildPriceUrl", () => {
  it("asks for every asset that has a feed id, in USD", () => {
    const url = new URL(prices.buildPriceUrl());

    expect(url.searchParams.get("vs_currencies")).toBe("usd");
    expect(url.searchParams.get("ids")?.split(",").sort()).toEqual(["stellar", "usd-coin"]);
  });
});

describe("parsePriceResponse", () => {
  it("maps feed ids back to asset symbols", () => {
    expect(prices.parsePriceResponse(LIVE_BODY)).toEqual({ XLM: 0.1838, USDC: 0.9998 });
  });

  it("skips an asset the feed did not quote", () => {
    expect(prices.parsePriceResponse({ stellar: { usd: 0.18 } })).toEqual({ XLM: 0.18 });
  });

  it("skips unknown ids rather than inventing a symbol", () => {
    expect(prices.parsePriceResponse({ bitcoin: { usd: 90_000 } })).toEqual({});
  });

  it("skips a non-numeric, zero or negative price", () => {
    expect(
      prices.parsePriceResponse({
        stellar: { usd: "not a number" },
        "usd-coin": { usd: 0 },
      }),
    ).toEqual({});
    expect(prices.parsePriceResponse({ stellar: { usd: -1 } })).toEqual({});
  });

  it("accepts a price quoted as a string", () => {
    expect(prices.parsePriceResponse({ stellar: { usd: "0.1838" } })).toEqual({ XLM: 0.1838 });
  });

  it("ignores a different quote currency", () => {
    expect(prices.parsePriceResponse({ stellar: { eur: 0.17 } })).toEqual({});
  });

  it.each([null, undefined, "error", 42, []])("returns no rates for %p", (body) => {
    expect(prices.parsePriceResponse(body)).toEqual({});
  });
});

describe("getFiatRates", () => {
  it("returns per-symbol rates from the feed", async () => {
    fetchMock.mockResolvedValue(ok());

    await expect(prices.getFiatRates()).resolves.toEqual({ XLM: 0.1838, USDC: 0.9998 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a rate for the whole TTL", async () => {
    fetchMock.mockResolvedValue(ok());

    const first = await prices.getFiatRates(0);
    const second = await prices.getFiatRates(prices.RATE_TTL_MS - 1);

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes once the TTL has passed", async () => {
    fetchMock.mockResolvedValue(ok());

    await prices.getFiatRates(0);
    await prices.getFiatRates(prices.RATE_TTL_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    fetchMock.mockResolvedValue(ok());

    const [a, b] = await Promise.all([prices.getFiatRates(0), prices.getFiatRates(0)]);

    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves to no rates instead of throwing when the feed fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(prices.getFiatRates()).resolves.toEqual({});
  });

  it("treats a non-2xx response as no rates", async () => {
    fetchMock.mockResolvedValue(httpError(429));

    await expect(prices.getFiatRates()).resolves.toEqual({});
  });

  it("treats a body with nothing usable as no rates", async () => {
    fetchMock.mockResolvedValue(ok({ bitcoin: { usd: 90_000 } }));

    await expect(prices.getFiatRates()).resolves.toEqual({});
  });

  it("survives a body that is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response);

    await expect(prices.getFiatRates()).resolves.toEqual({});
  });

  it("survives a request that is aborted mid-flight", async () => {
    fetchMock.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await expect(prices.getFiatRates()).resolves.toEqual({});
  });

  it("remembers a failure briefly instead of retrying per component", async () => {
    fetchMock.mockResolvedValue(httpError());

    await prices.getFiatRates(0);
    await prices.getFiatRates(prices.FAILURE_TTL_MS - 1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries again after the failure TTL, and recovers when the feed is back", async () => {
    fetchMock.mockResolvedValueOnce(httpError()).mockResolvedValueOnce(ok());

    await expect(prices.getFiatRates(0)).resolves.toEqual({});
    await expect(prices.getFiatRates(prices.FAILURE_TTL_MS)).resolves.toEqual({
      XLM: 0.1838,
      USDC: 0.9998,
    });
  });

  it("sends a demo key when one is configured", async () => {
    fetchMock.mockResolvedValue(ok());

    await prices.getFiatRates();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // No key in the default build; the header is simply absent.
    expect((init.headers as Record<string, string>)["x-cg-demo-api-key"]).toBeUndefined();
  });
});

describe("cachedFiatRates", () => {
  it("is empty before anything has been fetched", () => {
    expect(prices.cachedFiatRates()).toEqual({});
  });

  it("exposes a fresh rate synchronously, and drops it once stale", async () => {
    fetchMock.mockResolvedValue(ok());
    await prices.getFiatRates(0);

    expect(prices.cachedFiatRates(prices.RATE_TTL_MS - 1)).toEqual({
      XLM: 0.1838,
      USDC: 0.9998,
    });
    expect(prices.cachedFiatRates(prices.RATE_TTL_MS)).toEqual({});
  });
});

describe("estimateFiat", () => {
  const rates = { XLM: 0.5 };

  it("multiplies the amount by the asset's rate", () => {
    expect(prices.estimateFiat(3, "XLM", rates)).toBe(1.5);
    expect(prices.estimateFiat("2.5", "XLM", rates)).toBe(1.25);
  });

  it("matches the symbol case- and whitespace-insensitively", () => {
    expect(prices.estimateFiat(2, " xlm ", rates)).toBe(1);
  });

  it("returns null for an asset with no rate", () => {
    expect(prices.estimateFiat(2, "AQUA", rates)).toBeNull();
    expect(prices.estimateFiat(2, "XLM", {})).toBeNull();
  });

  it("returns null for an amount that is not a number", () => {
    expect(prices.estimateFiat("", "XLM", rates)).toBeNull();
    expect(prices.estimateFiat("abc", "XLM", rates)).toBeNull();
  });
});

describe("formatFiat", () => {
  it("shows cents", () => {
    expect(prices.formatFiat(1.5)).toBe("$1.50");
    expect(prices.formatFiat(0.1838)).toBe("$0.18");
  });

  it("never rounds a non-zero estimate down to zero", () => {
    expect(prices.formatFiat(0.001)).toBe("<$0.01");
  });

  it("shows a true zero as zero", () => {
    expect(prices.formatFiat(0)).toBe("$0.00");
  });

  it("returns nothing for a value that is not finite", () => {
    expect(prices.formatFiat(Number.POSITIVE_INFINITY)).toBe("");
    expect(prices.formatFiat(Number.NaN)).toBe("");
  });
});
