/**
 * jobsRoutes.test.ts
 *
 * Issue #70: jobs carry curated skill tags, the list can be filtered by one,
 * and the taxonomy itself is served so a client does not have to hardcode it.
 *
 * `prisma` is stubbed, so these assert the queries the routes build (which
 * filter reaches the database) rather than storage behaviour.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { Keypair } from "@stellar/stellar-sdk";
import { SignJWT } from "jose";
import { SKILL_TAGS } from "../lib/tags";

const CLIENT = Keypair.random().publicKey();

const h = vi.hoisted(() => ({
  job: {
    findMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  user: { findUnique: vi.fn() },
}));

vi.mock("../db", () => ({ prisma: { job: h.job, user: h.user } }));

let baseUrl: string;
let server: Server;

beforeAll(async () => {
  const { jobsRouter } = await import("../routes/jobs");
  const { errorHandler } = await import("../middleware/errorHandler");
  const { jsonReplacer } = await import("../lib/json");

  const app = express();
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
  for (const fn of [h.job.findMany, h.job.create, h.job.findUnique, h.job.update, h.user.findUnique]) {
    fn.mockReset();
  }
  h.job.findMany.mockResolvedValue([]);
});

async function tokenFor(address: string): Promise<string> {
  return new SignJWT({ sub: address })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}/api/jobs${path}`);
  return { status: res.status, body: (await res.json()) as any };
}

async function post(body: unknown, address = CLIENT) {
  const res = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await tokenFor(address)}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const validJob = () => ({
  title: "Landing page redesign",
  description: "A longer description of the work",
  milestones: [{ amountUsdc: "1.5" }],
});

describe("GET /api/jobs/tags", () => {
  it("serves the curated taxonomy", async () => {
    const res = await get("/tags");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(SKILL_TAGS.length);
    expect(res.body[0]).toMatchObject({ slug: "web-development", category: "Development" });
    expect(res.body[0].label).toBeTruthy();
  });

  it("is not mistaken for a job id", async () => {
    await get("/tags");

    // The `/:id` handler would look a job up; the literal route must win.
    expect(h.job.findUnique).not.toHaveBeenCalled();
  });
});

describe("GET /api/jobs?tag=", () => {
  it("filters with array containment", async () => {
    await get("/?tag=smart-contracts");

    expect(h.job.findMany).toHaveBeenCalledTimes(1);
    expect(h.job.findMany.mock.calls[0][0].where).toEqual({
      tags: { has: "smart-contracts" },
    });
  });

  it("combines the tag filter with the status filter", async () => {
    await get("/?status=ACTIVE&tag=web-development");

    expect(h.job.findMany.mock.calls[0][0].where).toEqual({
      status: "ACTIVE",
      tags: { has: "web-development" },
    });
  });

  it("leaves the tag out of the query when the filter is absent", async () => {
    await get("/");

    expect(h.job.findMany.mock.calls[0][0].where).toEqual({});
  });

  it("rejects a tag outside the taxonomy with the accepted list", async () => {
    const res = await get("/?tag=not-a-real-tag");

    // A typo must not look like an empty marketplace.
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Unknown tag/);
    expect(String(res.body.error)).toContain("web-development");
    expect(h.job.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/jobs with tags", () => {
  beforeEach(() => h.user.findUnique.mockResolvedValue({ id: "user_client" }));

  it("stores the chosen tags on the job", async () => {
    h.job.create.mockResolvedValue({ id: "job_1", tags: ["ui-ux-design"] });

    const res = await post({ ...validJob(), tags: ["ui-ux-design", "brand-design"] });

    expect(res.status).toBe(201);
    expect(h.job.create.mock.calls[0][0].data.tags).toEqual(["ui-ux-design", "brand-design"]);
  });

  it("defaults to no tags when the client sends none", async () => {
    h.job.create.mockResolvedValue({ id: "job_1", tags: [] });

    const res = await post(validJob());

    expect(res.status).toBe(201);
    expect(h.job.create.mock.calls[0][0].data.tags).toEqual([]);
  });

  it("de-duplicates repeated tags", async () => {
    h.job.create.mockResolvedValue({ id: "job_1", tags: ["devops"] });

    await post({ ...validJob(), tags: ["devops", "devops"] });

    expect(h.job.create.mock.calls[0][0].data.tags).toEqual(["devops"]);
  });

  it("refuses a tag outside the taxonomy", async () => {
    const res = await post({ ...validJob(), tags: ["crypto-moon"] });

    expect(res.status).toBe(400);
    expect(h.job.create).not.toHaveBeenCalled();
  });

  it("refuses more tags than a job may carry", async () => {
    const tooMany = SKILL_TAGS.slice(0, 9).map((tag) => tag.slug);

    const res = await post({ ...validJob(), tags: tooMany });

    expect(res.status).toBe(400);
    expect(h.job.create).not.toHaveBeenCalled();
  });
});
