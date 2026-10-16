/**
 * Route-level tests for `POST /api/escrow/sync/:jobId` — issue #19.
 *
 * The database is stubbed (see the `../db` mock) and nothing here talks to
 * Stellar: the sync route only writes to Postgres, so the subject is the
 * authorization and validation it performs *before* that write — the caller
 * must be the job's client, and `escrowId` must be a positive integer.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { Keypair } from "@stellar/stellar-sdk";
import { SignJWT } from "jose";

const CLIENT = Keypair.random().publicKey();
const STRANGER = Keypair.random().publicKey();

const h = vi.hoisted(() => ({ job: { findUnique: vi.fn(), update: vi.fn() } }));

vi.mock("../db", () => ({ prisma: { job: h.job } }));

let baseUrl: string;
let server: Server;

beforeAll(async () => {
  const { escrowRouter } = await import("../routes/escrow");
  const { errorHandler } = await import("../middleware/errorHandler");
  const { jsonReplacer } = await import("../lib/json");

  const app = express();
  app.set("json replacer", jsonReplacer);
  app.use(express.json());
  app.use("/api/escrow", escrowRouter);
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
  h.job.findUnique.mockReset();
  h.job.update.mockReset();
});

/** A bearer token `requireAuth` accepts for `address`. */
async function tokenFor(address: string): Promise<string> {
  return new SignJWT({ sub: address })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

/** The job row as the route loads it, with its client attached. */
function jobRow(client = CLIENT) {
  return { id: "job_1", escrowId: null, status: "CREATED", client: { stellarAddress: client } };
}

async function sync(jobId: string, address: string, body: unknown) {
  const res = await fetch(`${baseUrl}/api/escrow/sync/${jobId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await tokenFor(address)}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/escrow/sync/:jobId", () => {
  it("lets the job's client link the on-chain escrow id", async () => {
    h.job.findUnique.mockResolvedValue(jobRow());
    h.job.update.mockResolvedValue({ ...jobRow(), escrowId: 7n, status: "FUNDED" });

    const res = await sync("job_1", CLIENT, { escrowId: 7 });

    expect(res.status).toBe(200);
    // jsonReplacer renders the BigInt column as a string.
    expect(res.body.escrowId).toBe("7");
    expect(h.job.update).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: { escrowId: 7n, status: "FUNDED" },
    });
  });

  it("refuses a caller who is not the job's client (403)", async () => {
    h.job.findUnique.mockResolvedValue(jobRow());

    const res = await sync("job_1", STRANGER, { escrowId: 7 });

    expect(res.status).toBe(403);
    expect(h.job.update).not.toHaveBeenCalled();
  });

  it("404s when the job does not exist instead of throwing inside Prisma", async () => {
    h.job.findUnique.mockResolvedValue(null);

    const res = await sync("job_missing", CLIENT, { escrowId: 7 });

    expect(res.status).toBe(404);
    expect(h.job.update).not.toHaveBeenCalled();
  });

  it("rejects zero, negative, fractional, and unsafe-integer ids with 400", async () => {
    const badIds = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2];

    for (const escrowId of badIds) {
      h.job.findUnique.mockClear();
      const res = await sync("job_1", CLIENT, { escrowId });
      expect(res.status).toBe(400);
    }

    // Rejected at the edge: the job is never loaded and nothing is written.
    expect(h.job.findUnique).not.toHaveBeenCalled();
    expect(h.job.update).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric escrowId with 400", async () => {
    const res = await sync("job_1", CLIENT, { escrowId: "7" });

    expect(res.status).toBe(400);
    expect(h.job.update).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const res = await fetch(`${baseUrl}/api/escrow/sync/job_1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ escrowId: 7 }),
    });

    expect(res.status).toBe(401);
    expect(h.job.update).not.toHaveBeenCalled();
  });
});
