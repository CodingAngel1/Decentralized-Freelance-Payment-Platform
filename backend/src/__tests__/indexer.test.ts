import { describe, it, expect, vi } from "vitest";
import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { DisputeStatus, JobStatus } from "@prisma/client";
import {
  decodeEventData,
  decodeEventFields,
  decodeEventName,
  type ContractEventLike,
} from "../lib/events";
import {
  EVENT_TOPIC_FIELDS,
  applyRatedEvent,
  handleDisputeOpened,
  handleRaised,
  handleRefunded,
  processContractEvents,
  resolveStartLedger,
  type DisputeLifecycleStores,
  type RatedStores,
} from "../indexer";

/** Build an ScMap the way `#[contractevent]` data is encoded. */
function mapVal(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries).map(
      ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
    ),
  );
}

/**
 * Build an event the way the contracts do: the name in `topic[0]`, the struct's
 * `#[topic]` field(s) next, and everything else in the value map.
 */
function makeEvent(
  name: string,
  data: Record<string, xdr.ScVal>,
  ledger = 10,
  topics: xdr.ScVal[] = [],
): ContractEventLike {
  return {
    id: `evt-${ledger}`,
    ledger,
    topic: [xdr.ScVal.scvSymbol(name), ...topics],
    value: mapVal(data),
  };
}

/** Decode an event's fields the way `dispatchEvent` does, topic fields included. */
function eventFields(event: ContractEventLike): Record<string, unknown> {
  const name = decodeEventName(event) ?? "";
  return decodeEventFields(event, EVENT_TOPIC_FIELDS[name] ?? []);
}

/**
 * Arbitrary fixture id — these tests never touch a chain, so it is deliberately
 * not a deployed contract. Live testnet ids live in deployments/testnet.json;
 * do not copy one in here, or this file starts looking like configuration.
 */
const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

describe("event decoding", () => {
  it("decodes a captured milestone_released event", () => {
    const event = makeEvent("milestone_released", {
      escrow_id: nativeToScVal(7n, { type: "u64" }),
      index: nativeToScVal(0, { type: "u32" }),
      amount: nativeToScVal(300n, { type: "i128" }),
    });

    expect(decodeEventName(event)).toBe("milestone_released");
    expect(decodeEventData(event)).toMatchObject({
      escrow_id: 7n,
      index: 0,
      amount: 300n,
    });
  });

  it("decodes a captured rated event", () => {
    const ratee = Keypair.random().publicKey();
    const event = makeEvent("rated", {
      escrow_id: nativeToScVal(7n, { type: "u64" }),
      rater: Address.fromString(Keypair.random().publicKey()).toScVal(),
      ratee: Address.fromString(ratee).toScVal(),
      score: nativeToScVal(5, { type: "u32" }),
      count: nativeToScVal(1n, { type: "u64" }),
      total_score: nativeToScVal(5n, { type: "u64" }),
    });

    expect(decodeEventName(event)).toBe("rated");
    const data = decodeEventData(event);
    expect(data.ratee).toBe(ratee);
    expect(data.score).toBe(5);
    expect(data.count).toBe(1n);
    expect(data.total_score).toBe(5n);
  });

  it("returns null/empty for a malformed event instead of throwing", () => {
    const event = makeEvent("rated", {});
    expect(decodeEventName({ topic: [] })).toBeNull();
    expect(decodeEventData(event)).toEqual({});
  });

  it("reads a #[topic] field out of topic[1] on a captured testnet event", () => {
    // Captured from Soroban RPC testnet (tx 25bd0fb5b…): the dispute contract's
    // `Raised` marks escrow_id as #[topic], so it is in topic1 and the value map
    // holds only dispute_id and raised_by. Reading the value map alone — which
    // is what the indexer used to do — yields no escrow_id, so the handler
    // looked up nothing and the row's onChainId stayed null forever.
    const event = {
      ledger: 5_215_991,
      topic: [
        xdr.ScVal.fromXDR("AAAADwAAAAZyYWlzZWQAAA==", "base64"),
        xdr.ScVal.fromXDR("AAAABQAAAAAAAAAK", "base64"),
      ],
      value: xdr.ScVal.fromXDR(
        "AAAAEQAAAAEAAAACAAAADwAAAApkaXNwdXRlX2lkAAAAAAAFAAAAAAAAAAAAAAAPAAAACXJhaXNlZF9ieQAAAAAAABIAAAAAAAAAANGUF9btHFYS065a5qcfCrce1Lej1XjYw3pe/XrWguqR",
        "base64",
      ),
    };

    expect(decodeEventName(event)).toBe("raised");
    expect(decodeEventData(event).escrow_id).toBeUndefined();

    const fields = eventFields(event);
    expect(fields.escrow_id).toBe(10n);
    expect(fields.dispute_id).toBe(0n);
    expect(fields.raised_by).toBe("GDIZIF6W5UOFMEWTVZNONJY7BK3R5VFXUPKXRWGDPJPP26WWQLVJCRJG");
  });

  it("leaves an event whose escrow_id is a data field alone", () => {
    // escrow's `created`/`funded` put the client in topic1 and escrow_id in the
    // data, so the merge must not blank it.
    const event = makeEvent(
      "funded",
      { escrow_id: nativeToScVal(7n, { type: "u64" }), amount: nativeToScVal(3n, { type: "i128" }) },
      10,
      [Address.fromString(Keypair.random().publicKey()).toScVal()],
    );

    expect(EVENT_TOPIC_FIELDS.funded).toBeUndefined();
    expect(eventFields(event).escrow_id).toBe(7n);
  });
});

describe("processContractEvents", () => {
  it("advances the cursor only after every event has been processed", async () => {
    const order: string[] = [];
    const events = [
      makeEvent("funded", { escrow_id: nativeToScVal(7n, { type: "u64" }) }, 10),
      makeEvent(
        "milestone_released",
        { escrow_id: nativeToScVal(7n, { type: "u64" }), index: nativeToScVal(0, { type: "u32" }) },
        11,
      ),
    ];
    const source = {
      getEvents: vi.fn(async () => {
        order.push("getEvents");
        return { events, latestLedger: 12 };
      }),
    };

    let cursorValue = 5;
    const cursor = {
      get: async () => cursorValue,
      set: async (ledger: number) => {
        order.push(`set:${ledger}`);
        cursorValue = ledger;
      },
    };
    const dispatch = vi.fn(async () => {
      order.push("dispatch");
    });

    const next = await processContractEvents(source, cursor, [CONTRACT], dispatch);

    expect(source.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 6 }),
    );
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(next).toBe(12);
    expect(cursorValue).toBe(12);
    // Fetch first, dispatch in between, persist the cursor last.
    expect(order[0]).toBe("getEvents");
    expect(order[order.length - 1]).toBe("set:12");
  });

  it("starts a fresh indexer inside the RPC's ledger window", async () => {
    // Ledger 1 is far outside what Soroban RPC retains, so a fresh cursor has to
    // start near the tip or every poll fails with `startLedger must be within
    // the ledger range`.
    const TIP = 5_090_272;
    const source = { getEvents: vi.fn(), getLatestLedger: async () => TIP };

    const start = await resolveStartLedger(source, 0);

    expect(start).toBe(TIP - 100);
    expect(start).toBeGreaterThan(TIP - 120_960);
  });

  it("resumes from the cursor when one exists", async () => {
    const source = { getEvents: vi.fn(), getLatestLedger: async () => 5_000_000 };

    expect(await resolveStartLedger(source, 4_999_990)).toBe(4_999_991);
  });

  it("clamps a cursor older than the RPC window instead of failing every poll", async () => {
    const TIP = 5_000_000;
    const source = { getEvents: vi.fn(), getLatestLedger: async () => TIP };
    const stale = TIP - 200_000;

    const start = await resolveStartLedger(source, stale);

    expect(start).toBe(TIP - 120_960 + 1);
    expect(start).toBeGreaterThan(stale + 1);
  });

  it("trusts the cursor when the source cannot report a chain tip", async () => {
    const source = { getEvents: vi.fn() };

    expect(await resolveStartLedger(source, 0)).toBe(1);
    expect(await resolveStartLedger(source, 42)).toBe(43);
  });

  it("still polls when reading the chain tip fails", async () => {
    const source = {
      getEvents: vi.fn(),
      getLatestLedger: async () => {
        throw new Error("rpc down");
      },
    };

    expect(await resolveStartLedger(source, 7)).toBe(8);
  });

  it("does not call getEvents when no contracts are configured", async () => {
    const source = { getEvents: vi.fn() };
    let cursorValue = 5;
    const cursor = {
      get: async () => cursorValue,
      set: async (ledger: number) => {
        cursorValue = ledger;
      },
    };

    const next = await processContractEvents(source, cursor, [], vi.fn());

    expect(next).toBe(5);
    expect(source.getEvents).not.toHaveBeenCalled();
  });

  it("dead-letters a failing event and keeps going", async () => {
    const events = [
      makeEvent("funded", { escrow_id: nativeToScVal(1n, { type: "u64" }) }, 10),
      makeEvent("refunded", { escrow_id: nativeToScVal(1n, { type: "u64" }) }, 11),
    ];
    const source = { getEvents: vi.fn(async () => ({ events, latestLedger: 11 })) };
    let cursorValue = 9;
    const cursor = {
      get: async () => cursorValue,
      set: async (ledger: number) => {
        cursorValue = ledger;
      },
    };
    const failure = new Error("boom");
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn(async () => undefined);

    await processContractEvents(source, cursor, [CONTRACT], dispatch, onError);

    // Only the failing event is dead-lettered, and it carries the cause.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(events[0], failure);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("still advances the cursor when the dead-letter store itself fails", async () => {
    const events = [makeEvent("funded", { escrow_id: nativeToScVal(1n, { type: "u64" }) }, 10)];
    const source = { getEvents: vi.fn(async () => ({ events, latestLedger: 10 })) };
    let cursorValue = 9;
    const cursor = {
      get: async () => cursorValue,
      set: async (ledger: number) => {
        cursorValue = ledger;
      },
    };
    const onError = vi.fn(async () => {
      throw new Error("database is down");
    });

    const next = await processContractEvents(
      source,
      cursor,
      [CONTRACT],
      vi.fn(async () => {
        throw new Error("boom");
      }),
      onError,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(next).toBe(10);
    expect(cursorValue).toBe(10);
  });

  it("keeps going when one event fails", async () => {
    const events = [
      makeEvent("funded", { escrow_id: nativeToScVal(1n, { type: "u64" }) }, 10),
      makeEvent("refunded", { escrow_id: nativeToScVal(1n, { type: "u64" }) }, 11),
    ];
    const source = { getEvents: vi.fn(async () => ({ events, latestLedger: 11 })) };
    let cursorValue = 9;
    const cursor = {
      get: async () => cursorValue,
      set: async (ledger: number) => {
        cursorValue = ledger;
      },
    };
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    // Stub the dead-letter store: this test is about dispatch, not persistence,
    // and the real store would need a database.
    const onError = vi.fn(async () => undefined);

    const next = await processContractEvents(source, cursor, [CONTRACT], dispatch, onError);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(next).toBe(11);
  });
});

/**
 * In-memory stand-in for the store `applyRatedEvent` writes through, so the
 * "one row, no duplicate" property can be asserted without a database.
 */
class FakeRatedStore implements RatedStores {
  readonly jobs: Array<{ id: string; escrowId: bigint }> = [];
  readonly users = new Map<string, { id: string }>();
  readonly ratings = new Map<
    string,
    { jobId: string; raterId: string; rateeId: string; score: number }
  >();
  private seq = 0;

  private userId(address: string): { id: string } {
    let user = this.users.get(address);
    if (!user) {
      user = { id: `user-${++this.seq}` };
      this.users.set(address, user);
    }
    return user;
  }

  /** Pre-seed a user, as `POST /api/reputation` would have via `authenticate`. */
  seedUser(address: string): { id: string } {
    return this.userId(address);
  }

  /** Pre-seed the row `POST /api/reputation` writes before the tx lands. */
  seedRating(row: {
    jobId: string;
    raterId: string;
    rateeId: string;
    score: number;
  }): void {
    this.ratings.set(`${row.raterId}:${row.jobId}`, { ...row });
  }

  job = {
    findUnique: async ({ where }: { where: { escrowId: bigint } }) =>
      this.jobs.find((job) => job.escrowId === where.escrowId) ?? null,
  };

  user = {
    upsert: async ({ where }: { where: { stellarAddress: string } }) =>
      this.userId(where.stellarAddress),
  };

  rating = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { raterId_jobId: { raterId: string; jobId: string } };
      create: { jobId: string; raterId: string; rateeId: string; score: number };
      update: { rateeId: string; score: number };
    }) => {
      const key = `${where.raterId_jobId.raterId}:${where.raterId_jobId.jobId}`;
      const existing = this.ratings.get(key);
      const next = existing ? { ...existing, ...update } : { ...create };
      this.ratings.set(key, next);
      return next;
    },
  };
}

describe("rated events", () => {
  const RATER = Keypair.random().publicKey();
  const RATEE = Keypair.random().publicKey();

  /** The decoded payload of a `rated` event, as RPC would return it. */
  function ratedData(overrides: Record<string, xdr.ScVal> = {}) {
    return decodeEventData(
      makeEvent("rated", {
        escrow_id: nativeToScVal(7n, { type: "u64" }),
        rater: Address.fromString(RATER).toScVal(),
        ratee: Address.fromString(RATEE).toScVal(),
        score: nativeToScVal(4, { type: "u32" }),
        count: nativeToScVal(1n, { type: "u64" }),
        total_score: nativeToScVal(4n, { type: "u64" }),
        ...overrides,
      }),
    );
  }

  it("creates exactly one Rating row from a rated event", async () => {
    const db = new FakeRatedStore();
    db.jobs.push({ id: "job-1", escrowId: 7n });

    const outcome = await applyRatedEvent(db, ratedData());

    expect(outcome).toEqual({ status: "applied", jobId: "job-1", score: 4 });
    expect(db.ratings.size).toBe(1);
    const [row] = [...db.ratings.values()];
    expect(row).toMatchObject({ jobId: "job-1", score: 4 });
    // Both participants were materialised, so the ratee resolves to a real row.
    expect(row.rateeId).toBe(db.seedUser(RATEE).id);
  });

  it("converges with a row POST /api/reputation already created instead of duplicating", async () => {
    const db = new FakeRatedStore();
    db.jobs.push({ id: "job-1", escrowId: 7n });
    const rater = db.seedUser(RATER);
    const ratee = db.seedUser(RATEE);
    // The API wrote the row (with a placeholder score) before the tx landed.
    db.seedRating({ jobId: "job-1", raterId: rater.id, rateeId: ratee.id, score: 1 });

    await applyRatedEvent(db, ratedData());

    expect(db.ratings.size).toBe(1);
    // The on-chain score wins — updated in place, not inserted twice.
    expect([...db.ratings.values()][0].score).toBe(4);
  });

  it("skips a rated event for an escrow that has no job record", async () => {
    const db = new FakeRatedStore();

    const outcome = await applyRatedEvent(db, ratedData());

    expect(outcome).toEqual({ status: "skipped", reason: "unknown-job" });
    expect(db.ratings.size).toBe(0);
    expect(db.users.size).toBe(0);
  });

  it("skips a malformed rated event without throwing", async () => {
    const db = new FakeRatedStore();

    const outcome = await applyRatedEvent(db, { escrow_id: "not-a-number" });

    expect(outcome).toEqual({ status: "skipped", reason: "malformed" });
    expect(db.ratings.size).toBe(0);
  });
});

/**
 * In-memory stand-in for the store the dispute-lifecycle handlers write through,
 * so `dispute_opened → raised → refunded` can be driven end to end without a
 * database (the same approach as `FakeRatedStore`).
 */
class FakeDisputeStore implements DisputeLifecycleStores {
  private readonly jobs = new Map<bigint, { id: string; status: JobStatus }>();
  // Keyed on the job, mirroring the unique constraint the real table has.
  private readonly disputes = new Map<
    string,
    {
      onChainId: bigint | null;
      jobId: string;
      raisedByAddress: string;
      reason: string;
      status: DisputeStatus;
      resolvedAt: Date | null;
    }
  >();
  private seq = 0;

  /** Seed the mirrored job for an escrow and return its id. */
  seedJob(escrowId: bigint): string {
    const id = `job-${++this.seq}`;
    this.jobs.set(escrowId, { id, status: "CREATED" });
    return id;
  }

  jobStatus(escrowId: bigint): JobStatus | undefined {
    return this.jobs.get(escrowId)?.status;
  }

  disputeRows(): Array<{
    onChainId: bigint | null;
    jobId: string;
    raisedByAddress: string;
    reason: string;
    status: DisputeStatus;
    resolvedAt: Date | null;
  }> {
    return [...this.disputes.values()];
  }

  /** Pre-seed a dispute row, e.g. one an arbitrator had already picked up. */
  seedDispute(escrowId: bigint, status: DisputeStatus): void {
    const job = this.jobs.get(escrowId);
    if (!job) throw new Error("seed the job first");
    this.disputes.set(job.id, {
      onChainId: BigInt(++this.seq),
      jobId: job.id,
      raisedByAddress: "GRAISER",
      reason: "",
      status,
      resolvedAt: status === "RESOLVED" ? new Date() : null,
    });
  }

  /**
   * Pre-seed the row `POST /api/disputes` writes: the reason is known, the
   * on-chain id is not (the contract has not minted one yet).
   */
  seedIntentRow(escrowId: bigint, reason: string): void {
    const job = this.jobs.get(escrowId);
    if (!job) throw new Error("seed the job first");
    this.disputes.set(job.id, {
      onChainId: null,
      jobId: job.id,
      // Whoever called the API — which is not necessarily whoever raised it.
      raisedByAddress: "GWHO_RECORDED_IT",
      reason,
      status: "RAISED",
      resolvedAt: null,
    });
  }

  job = {
    findUnique: async ({ where }: { where: { escrowId: bigint } }) => {
      const job = this.jobs.get(where.escrowId);
      return job ? { id: job.id } : null;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { escrowId: bigint };
      data: { status: JobStatus };
    }) => {
      const job = this.jobs.get(where.escrowId);
      if (job) job.status = data.status;
      return { count: job ? 1 : 0 };
    },
  };

  dispute = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { jobId: string };
      create: {
        onChainId: bigint;
        jobId: string;
        raisedByAddress: string;
        reason: string;
      };
      update: { onChainId: bigint };
    }) => {
      const existing = this.disputes.get(where.jobId);
      // Updating the row the API already created, rather than inserting a second
      // one, is the whole point of keying on the job.
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { ...create, status: "RAISED" as DisputeStatus, resolvedAt: null };
      this.disputes.set(where.jobId, row);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { job: { escrowId: bigint }; status: { in: DisputeStatus[] } };
      data: { status: DisputeStatus; resolvedAt: Date };
    }) => {
      const job = this.jobs.get(where.job.escrowId);
      if (!job) return { count: 0 };
      let count = 0;
      for (const row of this.disputes.values()) {
        if (row.jobId === job.id && where.status.in.includes(row.status)) {
          row.status = data.status;
          row.resolvedAt = data.resolvedAt;
          count++;
        }
      }
      return { count };
    },
  };
}

describe("dispute lifecycle events", () => {
  const CLIENT = Keypair.random().publicKey();

  /**
   * Decode a real event payload, so the handlers see what the chain emits —
   * including the `escrow_id` that these events carry in topic1.
   */
  function eventData(
    name: string,
    fields: Record<string, xdr.ScVal>,
    escrowId = 7n,
  ): Record<string, unknown> {
    return eventFields(
      makeEvent(name, fields, 10, [nativeToScVal(escrowId, { type: "u64" })]),
    );
  }

  const disputeOpened = () =>
    eventData("dispute_opened", { initiator: Address.fromString(CLIENT).toScVal() });

  const raised = () =>
    eventData("raised", {
      dispute_id: nativeToScVal(3n, { type: "u64" }),
      raised_by: Address.fromString(CLIENT).toScVal(),
    });

  const refunded = (escrowId = 7n) =>
    eventData(
      "refunded",
      {
        client: Address.fromString(CLIENT).toScVal(),
        amount: nativeToScVal(20_000_000n, { type: "i128" }),
      },
      escrowId,
    );

  it("drives dispute_opened → raised → refunded and leaves no open dispute", async () => {
    const db = new FakeDisputeStore();
    const jobId = db.seedJob(7n);

    // 1. open_dispute freezes the job. The dispute row does not exist yet: the
    //    on-chain dispute has no id until `raise` (documented in indexer.ts).
    await handleDisputeOpened(db, disputeOpened());
    expect(db.jobStatus(7n)).toBe("DISPUTED");
    expect(db.disputeRows()).toHaveLength(0);

    // 2. dispute.raise records the on-chain dispute against the job.
    await handleRaised(db, raised());
    expect(db.disputeRows()).toHaveLength(1);
    expect(db.disputeRows()[0]).toMatchObject({
      onChainId: 3n,
      jobId,
      status: "RAISED",
      resolvedAt: null,
    });

    // 3. reclaim_after_dispute_timeout refunds the escrow and closes the dispute.
    await handleRefunded(db, refunded());

    expect(db.jobStatus(7n)).toBe("REFUNDED");
    const rows = db.disputeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("REFUNDED");
    expect(rows[0].resolvedAt).toBeInstanceOf(Date);
    // No dispute for the escrow is left open.
    expect(rows.filter((row) => row.status === "RAISED" || row.status === "UNDER_REVIEW"))
      .toHaveLength(0);
  });

  it("converges the API's off-chain row with the raised event instead of duplicating it", async () => {
    const db = new FakeDisputeStore();
    const jobId = db.seedJob(7n);
    // `POST /api/disputes` recorded the reason before dispute.raise ran.
    db.seedIntentRow(7n, "Milestone never delivered");

    await handleDisputeOpened(db, disputeOpened());
    await handleRaised(db, raised());

    // One row, holding both the reason and the id. Keying the upsert on
    // `onChainId` (as this handler used to) inserted a second row here, and the
    // resolve route then failed forever on the row whose id stayed null.
    const rows = db.disputeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId,
      onChainId: 3n,
      reason: "Milestone never delivered",
      status: "RAISED",
      // The event's raiser is authoritative: the contract checked that
      // `raised_by` is a party, while the row only knows who called the API.
      raisedByAddress: CLIENT,
    });
  });

  it("stays one row when the same raised event is indexed twice", async () => {
    const db = new FakeDisputeStore();
    db.seedJob(7n);
    db.seedIntentRow(7n, "Milestone never delivered");

    // A cursor rewind replays the event; the row must not multiply, and
    // re-writing the same values must not disturb the stored reason.
    await handleRaised(db, raised());
    await handleRaised(db, raised());

    expect(db.disputeRows()).toHaveLength(1);
    expect(db.disputeRows()[0]).toMatchObject({
      onChainId: 3n,
      reason: "Milestone never delivered",
    });
  });

  it("closes an UNDER_REVIEW dispute too (an arbitrator had started)", async () => {
    const db = new FakeDisputeStore();
    db.seedJob(7n);
    db.seedDispute(7n, "UNDER_REVIEW");

    await handleRefunded(db, refunded());

    expect(db.jobStatus(7n)).toBe("REFUNDED");
    expect(db.disputeRows()[0].status).toBe("REFUNDED");
    expect(db.disputeRows()[0].resolvedAt).toBeInstanceOf(Date);
  });

  it("leaves a dispute the panel already resolved untouched", async () => {
    const db = new FakeDisputeStore();
    db.seedJob(7n);
    db.seedDispute(7n, "RESOLVED");

    await handleRefunded(db, refunded());

    expect(db.jobStatus(7n)).toBe("REFUNDED");
    expect(db.disputeRows()[0].status).toBe("RESOLVED");
  });

  it("refunds an escrow that was never disputed without inventing a dispute", async () => {
    const db = new FakeDisputeStore();
    db.seedJob(9n);

    // reclaim_expired runs from Active, so there is no dispute to close.
    await handleRefunded(db, refunded(9n));

    expect(db.jobStatus(9n)).toBe("REFUNDED");
    expect(db.disputeRows()).toHaveLength(0);
  });
});
