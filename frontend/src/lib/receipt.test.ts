import { describe, expect, it } from "vitest";
import { buildReceiptHtml, escapeHtml } from "./receipt";
import type { EscrowReceiptApi } from "./api";

function receipt(overrides: Partial<EscrowReceiptApi> = {}): EscrowReceiptApi {
  return {
    escrowId: "7",
    generatedAt: "2026-03-01T09:00:00.000Z",
    job: {
      id: "job-1",
      title: "Landing page redesign",
      description: "A new marketing site",
      status: "ACTIVE",
      asset: "USDC",
      totalAmount: "2.5",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
      client: { stellarAddress: "GCLIENT", displayName: "Ada" },
      freelancer: { stellarAddress: "GFREELANCER", displayName: null },
    },
    milestones: [
      {
        index: 0,
        description: "Design",
        amount: "1.5",
        status: "RELEASED",
        deadline: null,
        releasedAt: "2026-02-02T12:00:00.000Z",
      },
    ],
    events: [
      {
        id: "evt-1",
        action: "milestone_released",
        amount: "1.5",
        txHash: "hash-release-0123456789",
        ledger: 20,
        createdAt: "2026-02-02T12:00:00.000Z",
      },
    ],
    totals: { released: "1.5", outstanding: "1" },
    ...overrides,
  };
}

describe("escapeHtml", () => {
  it("neutralises the characters that would break out of markup", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });
});

describe("buildReceiptHtml", () => {
  it("is a standalone document with the escrow, the totals and the milestones", () => {
    const html = buildReceiptHtml(receipt());

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Escrow receipt #7</title>");
    expect(html).toContain("Landing page redesign");
    expect(html).toContain("GCLIENT");
    expect(html).toContain("GFREELANCER");
    // Totals, in whole units of the job's asset.
    expect(html).toContain("2.5 USDC");
    expect(html).toContain("1.5 USDC");
    // The release, with the date it happened.
    expect(html).toMatch(/Design[\s\S]*RELEASED/);
  });

  it("links every indexed action to its transaction", () => {
    const html = buildReceiptHtml(receipt());

    // The raw event name is not what a client reads.
    expect(html).toContain("Milestone released");
    expect(html).toContain("/tx/hash-release-0123456789");
    expect(html).toContain("hash-release-012…");
  });

  it("shows a dash for an event that moved nothing", () => {
    const html = buildReceiptHtml(
      receipt({
        events: [
          {
            id: "evt-0",
            action: "created",
            amount: null,
            txHash: "hash-create",
            ledger: 5,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(html).toContain("Escrow created");
    // The amount cell is empty rather than a fabricated "0 USDC".
    expect(html).not.toContain("0 USDC</td>");
  });

  it("escapes user-supplied text instead of embedding it raw", () => {
    // A job title is user input; a receipt is a document the browser renders.
    const html = buildReceiptHtml(
      receipt({
        job: {
          ...receipt().job,
          title: "<img src=x onerror=alert(1)>",
        },
      }),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
