/**
 * Route tests for the reputation read endpoints — the part of issue #69 that
 * lets the Profile page show the ratings behind an aggregate rather than only a
 * single number.
 *
 * The database is stubbed (see the `../db` mock), so nothing here needs
 * PostgreSQL: the subject is the shape of the response and that the detail route
 * is reachable alongside the aggregate route (`/:address/ratings` must not be
 * swallowed by `/:address`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const h = vi.hoisted(() => ({
  rating: {
    findMany: vi.fn(),
    aggregate: vi.fn(),
  },
}));

vi.mock("../db", () => ({ prisma: { rating: h.rating } }));

let baseUrl: string;
let server: Server;

beforeAll(async () => {
  const { reputationRouter } = await import("../routes/reputation");
  const { errorHandler } = await import("../middleware/errorHandler");
  const { jsonReplacer } = await import("../lib/json");

  const app = express();
  // Mirrors app.ts: Prisma ids are BigInt, which JSON.stringify throws on.
  app.set("json replacer", jsonReplacer);
  app.use(express.json());
  app.use("/api/reputation", reputationRouter);
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
  h.rating.findMany.mockReset();
  h.rating.aggregate.mockReset();
});

const RATEE = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";

async function get(path: string) {
  const res = await fetch(`${baseUrl}/api/reputation${path}`);
  return { status: res.status, body: (await res.json()) as unknown };
}

describe("GET /api/reputation/:address/ratings", () => {
  it("returns the individual ratings received, newest first, with their job", async () => {
    h.rating.findMany.mockResolvedValue([
      {
        id: "rating-2",
        score: 3,
        comment: null,
        createdAt: new Date("2026-02-04T00:00:00.000Z"),
        job: { id: "job-2", title: "Logo refresh", escrowId: 9n, status: "COMPLETED" },
        rater: { stellarAddress: "GRATER" },
      },
    ]);

    const res = await get(`/${RATEE}/ratings`);

    expect(res.status).toBe(200);
    expect(h.rating.findMany).toHaveBeenCalledWith({
      where: { ratee: { stellarAddress: RATEE } },
      include: {
        job: { select: { id: true, title: true, escrowId: true, status: true } },
        rater: { select: { stellarAddress: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    expect(res.body).toEqual([
      {
        id: "rating-2",
        score: 3,
        comment: null,
        createdAt: "2026-02-04T00:00:00.000Z",
        // A BigInt column would throw in JSON.stringify without the replacer.
        job: { id: "job-2", title: "Logo refresh", escrowId: "9", status: "COMPLETED" },
        rater: { stellarAddress: "GRATER" },
      },
    ]);
  });

  it("is not swallowed by the aggregate route", async () => {
    h.rating.aggregate.mockResolvedValue({ _avg: { score: 4.5 }, _count: { score: 2 } });

    const res = await get(`/${RATEE}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      address: RATEE,
      averageScore: 4.5,
      totalRatings: 2,
    });
    expect(h.rating.aggregate).toHaveBeenCalled();
    expect(h.rating.findMany).not.toHaveBeenCalled();
  });

  it("returns an empty list for an address nobody has rated", async () => {
    h.rating.findMany.mockResolvedValue([]);

    const res = await get(`/${RATEE}/ratings`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
