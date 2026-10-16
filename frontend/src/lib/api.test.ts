import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticate,
  buildJobsQuery,
  clearAuthToken,
  createDispute,
  createJob,
  fetchMessages,
  fetchUnreadCounts,
  linkDisputeId,
  markMessagesRead,
  sendMessage,
  submitRating,
} from "./api";

describe("buildJobsQuery", () => {
  it("omits empty filters", () => {
    expect(buildJobsQuery()).toBe("");
    expect(buildJobsQuery({ status: "", client: "", freelancer: "" })).toBe("");
  });

  it("encodes the status filter", () => {
    expect(buildJobsQuery({ status: "ACTIVE" })).toBe("?status=ACTIVE");
  });

  it("encodes pagination and all filters together", () => {
    const qs = buildJobsQuery({
      status: "COMPLETED",
      client: "GABCD",
      freelancer: "GEFGH",
      page: 2,
      limit: 10,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("status")).toBe("COMPLETED");
    expect(params.get("client")).toBe("GABCD");
    expect(params.get("freelancer")).toBe("GEFGH");
    expect(params.get("page")).toBe("2");
    expect(params.get("limit")).toBe("10");
    expect(qs.startsWith("?")).toBe(true);
  });
});

describe("authenticate", () => {
  beforeEach(() => {
    // The token cache is module state; each test starts signed out.
    clearAuthToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs the challenge nonce and returns the token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "nonce-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "jwt-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const signMessage = vi.fn(async () => "sig-base64");

    const token = await authenticate("GCLIENT", signMessage);

    expect(token).toBe("jwt-1");
    expect(signMessage).toHaveBeenCalledWith("nonce-1");
    expect(fetchMock.mock.calls[0][0]).toContain("/api/users/challenge?address=GCLIENT");
    const authBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(authBody).toEqual({
      address: "GCLIENT",
      signature: "sig-base64",
      nonce: "nonce-1",
    });
  });

  it("reuses the token so a page does not prompt the wallet on every read", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "nonce-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "jwt-1" }), { status: 200 }))
      // This second challenge must never be reached.
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "nonce-2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "jwt-2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const signMessage = vi.fn(async () => "sig-base64");

    expect(await authenticate("GCLIENT", signMessage)).toBe("jwt-1");
    expect(await authenticate("GCLIENT", signMessage)).toBe("jwt-1");

    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one challenge between concurrent callers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "nonce-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "jwt-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const signMessage = vi.fn(async () => "sig-base64");

    const [a, b] = await Promise.all([
      authenticate("GCLIENT", signMessage),
      authenticate("GCLIENT", signMessage),
    ]);

    expect([a, b]).toEqual(["jwt-1", "jwt-1"]);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("re-challenges when asked for a fresh token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ nonce: "n", token: "jwt" }), { status: 200 }),
    );
    // The challenge and auth responses differ; give each call its own pair.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "n1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "jwt-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "n2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "jwt-2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const signMessage = vi.fn(async () => "sig");

    expect(await authenticate("GCLIENT", signMessage)).toBe("jwt-1");
    expect(await authenticate("GCLIENT", signMessage, { fresh: true })).toBe("jwt-2");
    expect(signMessage).toHaveBeenCalledTimes(2);
  });
});

describe("messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs a job's conversation with a bearer token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: "m1", jobId: "job-1", body: "hi" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const messages = await fetchMessages("job-1", "jwt-1");

    expect(messages[0].body).toBe("hi");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/messages/job-1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
  });

  it("throws with the status when the conversation is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 403 })),
    );

    await expect(fetchMessages("job-1", "jwt-1")).rejects.toThrow(/HTTP 403/);
  });

  it("POSTs a message body", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "m2", jobId: "job-1", body: "hello" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendMessage("job-1", "hello", "jwt-1");

    expect(sent.id).toBe("m2");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/messages/job-1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ body: "hello" });
  });

  it("POSTs a read receipt and returns how many messages changed", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ markedRead: 2 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await markMessagesRead("job-1", "jwt-1")).toBe(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/messages/job-1/read");
    expect(init.method).toBe("POST");
  });

  it("GETs the unread counts", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ total: 3, byJob: [{ jobId: "job-1", count: 3 }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const counts = await fetchUnreadCounts("jwt-1");

    expect(counts.total).toBe(3);
    expect(counts.byJob[0]).toEqual({ jobId: "job-1", count: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/messages/unread");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
  });
});

describe("createJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the job with the chosen asset and a bearer token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "job-1" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const job = await createJob(
      {
        title: "Redesign",
        description: "A longer description",
        asset: "XLM",
        milestones: [{ amountUsdc: 1.5 }],
      },
      "jwt-1",
    );

    expect(job.id).toBe("job-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/jobs");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
    expect(JSON.parse(init.body as string).asset).toBe("XLM");
  });
});

describe("submitRating", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the rating with a bearer token and returns the row + xdr", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          rating: { id: "rating-1", jobId: "job-1", score: 5, comment: "great work" },
          xdr: "AAAA",
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await submitRating(
      { jobId: "job-1", rateeAddress: "GRATEE", score: 5, comment: "great work" },
      "jwt-1",
    );

    expect(res.rating.id).toBe("rating-1");
    expect(res.xdr).toBe("AAAA");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/reputation");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
    expect(JSON.parse(init.body as string)).toEqual({
      jobId: "job-1",
      rateeAddress: "GRATEE",
      score: 5,
      comment: "great work",
    });
  });

  it("throws with the status when the API rejects the rating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 400 })),
    );

    await expect(
      submitRating({ jobId: "job-1", rateeAddress: "GRATEE", score: 5 }, "jwt-1"),
    ).rejects.toThrow(/HTTP 400/);
  });
});

describe("createDispute", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the job id and the reason with a bearer token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          dispute: { id: "dispute-1", jobId: "job-1", onChainId: null, status: "RAISED", reason: "late" },
          xdr: "AAAA",
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await createDispute({ jobId: "job-1", reason: "late" }, "jwt-1");

    // The row exists before the chain knows about the dispute, so its id is what
    // `linkDisputeId` has to carry forward.
    expect(res.dispute.id).toBe("dispute-1");
    expect(res.dispute.onChainId).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/disputes");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
    expect(JSON.parse(init.body as string)).toEqual({ jobId: "job-1", reason: "late" });
  });

  it("throws with the status when the API refuses to record it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 403 })),
    );

    await expect(createDispute({ jobId: "job-1", reason: "late" }, "jwt-1")).rejects.toThrow(
      /HTTP 403/,
    );
  });
});

describe("linkDisputeId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the on-chain id returned by dispute.raise as a number", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ id: "dispute-1", jobId: "job-1", onChainId: "3", status: "RAISED", reason: "late" }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    // The contract returns a bigint; the route validates an integer, and the
    // column is a BigInt, so it must not be sent as a string.
    const updated = await linkDisputeId("dispute-1", 3n, "jwt-1");

    expect(updated.onChainId).toBe("3");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/disputes/dispute-1/sync");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ onChainId: 3 });
  });

  it("throws with the status when the id cannot be recorded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 403 })),
    );

    await expect(linkDisputeId("dispute-1", 3n, "jwt-1")).rejects.toThrow(/HTTP 403/);
  });
});
