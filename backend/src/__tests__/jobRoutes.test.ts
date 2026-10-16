/**
 * Route-level tests for `GET /api/jobs` — issue #20.
 *
 * The database is stubbed (see the `../db` mock), so the subject is the API's
 * own parsing of the query string, not Prisma. Each rejection asserts that
 * `findMany` was never called: a bad value is stopped at the edge instead of
 * becoming a Prisma error (an unknown status used to throw there and surface as
 * a 500; a non-numeric page/limit used to become `NaN` in `skip`/`take`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const h = vi.hoisted(() => ({ job: { findMany: vi.fn() } }));

vi.mock("../db", () => ({ prisma: { job: h.job } }));

let baseUrl: string;
let server: Server;

// The router is imported inside `beforeAll` because it pulls in `config`, which
// reads the environment at import time (see vitest.config.ts for the defaults).
beforeAll(async () => {
  const { jobsRouter } = await import("../routes/jobs");
  const { errorHandler } = await import("../middleware/errorHandler");
  const { jsonReplacer } = await import("../lib/json");

  const app = express();
  // Mirrors app.ts: Prisma ids are BigInt, which JSON.stringify throws on.
  app.set("json replacer", jsonReplacer);
  app.use(express.json());
  app.use("/api/jobs", jobsRouter);
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port assigned");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  h.job.findMany.mockReset();
  h.job.findMany.mockResolvedValue([]);
});

async function list(query = "") {
  const res = await fetch(`${baseUrl}/api/jobs${query}`);
  return { status: res.status, body: (await res.json()) as unknown };
}

/** The arguments the route handed Prisma on its one call. */
function args() {
  return h.job.findMany.mock.calls[0][0] as {
    where: Record<string, unknown>;
    skip: number;
    take: number;
  };
}

describe("GET /api/jobs: valid filters", () => {
  it("applies the default page when the query is empty", async () => {
    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(args()).toMatchObject({ where: {}, skip: 0, take: 20 });
  });

  it("passes a valid status through as the enum member, not a cast", async () => {
    const res = await list("?status=ACTIVE");

    expect(res.status).toBe(200);
    expect(args().where).toEqual({ status: "ACTIVE" });
  });

  it("accepts every known status", async () => {
    const statuses = ["CREATED", "FUNDED", "ACTIVE", "COMPLETED", "DISPUTED", "REFUNDED"];

    for (const status of statuses) {
      h.job.findMany.mockClear();
      const res = await list(`?status=${status}`);
      expect(res.status).toBe(200);
      expect(args().where).toEqual({ status });
    }
  });

  it("translates page and limit into skip and take", async () => {
    const res = await list("?page=3&limit=5");

    expect(res.status).toBe(200);
    expect(args()).toMatchObject({ skip: 10, take: 5 });
  });

  it("passes the client and freelancer filters through", async () => {
    await list("?client=GCLIENT&freelancer=GFREELANCER");

    expect(args().where).toEqual({
      client: { stellarAddress: "GCLIENT" },
      freelancer: { stellarAddress: "GFREELANCER" },
    });
  });
});

describe("GET /api/jobs: each rejection is a 400 that never reaches Prisma", () => {
  it("rejects an unknown status", async () => {
    // PENDING_REVIEW is a frontend-only escrow state, not a Prisma JobStatus.
    const res = await list("?status=PENDING_REVIEW");

    expect(res.status).toBe(400);
    expect(h.job.findMany).not.toHaveBeenCalled();
  });

  it("rejects a repeated status parameter instead of silently choosing one", async () => {
    const res = await list("?status=ACTIVE&status=COMPLETED");

    expect(res.status).toBe(400);
    expect(h.job.findMany).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric page", async () => {
    const res = await list("?page=abc");

    expect(res.status).toBe(400);
    expect(h.job.findMany).not.toHaveBeenCalled();
  });

  it("rejects a zero, negative, or fractional page", async () => {
    for (const page of ["0", "-1", "1.5"]) {
      h.job.findMany.mockClear();
      const res = await list(`?page=${page}`);
      expect(res.status).toBe(400);
      expect(h.job.findMany).not.toHaveBeenCalled();
    }
  });

  it("rejects a non-numeric limit", async () => {
    const res = await list("?limit=lots");

    expect(res.status).toBe(400);
    expect(h.job.findMany).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative limit", async () => {
    for (const limit of ["0", "-20"]) {
      h.job.findMany.mockClear();
      const res = await list(`?limit=${limit}`);
      expect(res.status).toBe(400);
      expect(h.job.findMany).not.toHaveBeenCalled();
    }
  });

  it("caps limit at 100", async () => {
    const atCap = await list("?limit=100");
    expect(atCap.status).toBe(200);
    expect(args().take).toBe(100);

    h.job.findMany.mockClear();
    const overCap = await list("?limit=101");
    expect(overCap.status).toBe(400);
    expect(h.job.findMany).not.toHaveBeenCalled();
  });
});
