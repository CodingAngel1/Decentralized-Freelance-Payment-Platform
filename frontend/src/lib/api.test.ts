import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticate,
  buildJobsQuery,
  createDispute,
  createJob,
  fetchSavedJobs,
  linkDisputeId,
  saveJob,
  submitRating,
  unsaveJob,
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
      tag: "web-development",
      page: 2,
      limit: 10,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("status")).toBe("COMPLETED");
    expect(params.get("client")).toBe("GABCD");
    expect(params.get("freelancer")).toBe("GEFGH");
    expect(params.get("tag")).toBe("web-development");
    expect(params.get("page")).toBe("2");
    expect(params.get("limit")).toBe("10");
    expect(qs.startsWith("?")).toBe(true);
  });

  it("omits the skill-tag filter when it is empty", () => {
    expect(buildJobsQuery({ tag: "" })).toBe("");
    expect(buildJobsQuery({ tag: "devops" })).toBe("?tag=devops");
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

describe("bookmarks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the saved jobs with a bearer token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: "job-1", title: "Bookmarked" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await fetchSavedJobs("jwt-1");

    expect(jobs[0].id).toBe("job-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/jobs/saved");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
  });

  it("POSTs a bookmark", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveJob("job-1", "jwt-1");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/jobs/job-1/save");
    expect(init.method).toBe("POST");
  });

  it("DELETEs a bookmark", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await unsaveJob("job-1", "jwt-1");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/jobs/job-1/save");
    expect(init.method).toBe("DELETE");
  });

  it("throws with the status when a bookmark is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 401 })),
    );

    await expect(saveJob("job-1", "stale")).rejects.toThrow(/HTTP 401/);
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
