import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticate,
  buildJobsQuery,
  createDispute,
  createJob,
  fetchRatingsReceived,
  fetchUserJobs,
  linkDisputeId,
  submitRating,
} from "./api";
import type { JobApi } from "./api";

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

function jobRow(id: string, overrides: Partial<JobApi> = {}): JobApi {
  return {
    id,
    escrowId: null,
    title: `Job ${id}`,
    status: "ACTIVE",
    totalAmountUsdc: "1",
    client: { stellarAddress: "GCLIENT" },
    ...overrides,
  };
}

describe("fetchUserJobs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for both roles and merges them without duplicating a job", async () => {
    // A job where the same address is the client comes back from both filters in
    // the worst case; the history must list it once.
    const both = jobRow("job-1", { freelancer: { stellarAddress: "GADDR" } });
    const fetchMock = vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("freelancer=") ? [jobRow("job-2"), both] : [both, jobRow("job-1")],
        ),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await fetchUserJobs("GADDR");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("client=GADDR");
    expect(fetchMock.mock.calls[1][0]).toContain("freelancer=GADDR");
    expect(jobs.map((j) => j.id).sort()).toEqual(["job-1", "job-2"]);
  });

  it("orders the merged history by createdAt, newest first", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("client=")
            ? [jobRow("old", { createdAt: "2026-01-01T00:00:00.000Z" })]
            : [jobRow("new", { createdAt: "2026-05-01T00:00:00.000Z" })],
        ),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await fetchUserJobs("GADDR");

    expect(jobs.map((j) => j.id)).toEqual(["new", "old"]);
  });
});

describe("fetchRatingsReceived", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the per-address ratings endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "rating-1",
            score: 5,
            comment: null,
            createdAt: "2026-01-03T00:00:00.000Z",
            job: { id: "job-1", title: "Redesign", escrowId: "7", status: "COMPLETED" },
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ratings = await fetchRatingsReceived("GADDR");

    expect(ratings[0].score).toBe(5);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/reputation/GADDR/ratings");
  });

  it("throws with the status when the API rejects the read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 })),
    );

    await expect(fetchRatingsReceived("GADDR")).rejects.toThrow(/HTTP 500/);
  });
});

describe("authenticate", () => {
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
