import { describe, it, expect, vi } from "vitest";
import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  decodeEventData,
  decodeEventName,
  eventEscrowId,
  type ContractEventLike,
} from "../lib/events";
import {
  applyRatedEvent,
  dispatchEvent,
  processContractEvents,
  resolveStartLedger,
  type IndexerStore,
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

function makeEvent(
  name: string,
  data: Record<string, xdr.ScVal>,
  ledger = 10,
): ContractEventLike {
  return {
    id: `evt-${ledger}`,
    ledger,
    topic: [xdr.ScVal.scvSymbol(name)],
    value: mapVal(data),
  };
}

/**
 * An event shaped the way the contracts publish one for their `#[topic]` field:
 * the escrow id is `topic[1]`, not part of the data map.
 */
function makeTopicEvent(
  name: string,
  escrowId: bigint,
  data: Record<string, xdr.ScVal> = {},
  ledger = 10,
): ContractEventLike {
  return {
    id: `evt-${ledger}`,
    ledger,
    topic: [xdr.ScVal.scvSymbol(name), nativeToScVal(escrowId, { type: "u64" })],
    value: mapVal(data),
  };
}

/**
 * Arbitrary fixture id — these tests never touch a chain, so it is deliberately
 * not a deployed contract. Live testnet ids live in deployments/testnet.json;
 * do not copy one in here, or this file starts looking like configuration.
 */
const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

const ALICE = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";

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
});

describe("eventEscrowId", () => {
  it("reads the id from the data map for created/funded", () => {
    // These two have `client` as their #[topic] field, so the id is in the data.
    const event = makeEvent("funded", { escrow_id: nativeToScVal(7n, { type: "u64" }) });
    expect(eventEscrowId(event)).toBe(7n);
  });

  it("reads the id from the #[topic] field for every other event", () => {
    const event = makeTopicEvent("milestone_released", 7n, {
      index: nativeToScVal(0, { type: "u32" }),
    });

    expect(eventEscrowId(event)).toBe(7n);
  });

  it("returns null when the event carries no usable id", () => {
    expect(eventEscrowId(makeEvent("milestone_released", {}))).toBeNull();
    expect(eventEscrowId({ ledger: 1, topic: [], value: mapVal({}) })).toBeNull();
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

  /**
   * The decoded payload of a `rated` event, as RPC would return it: the escrow
   * id is the `#[topic]` field, so it is *not* in the data map.
   */
  function ratedData(overrides: Record<string, xdr.ScVal> = {}) {
    return decodeEventData(
      makeTopicEvent("rated", 7n, {
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

    const outcome = await applyRatedEvent(db, 7n, ratedData());

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

    await applyRatedEvent(db, 7n, ratedData());

    expect(db.ratings.size).toBe(1);
    // The on-chain score wins — updated in place, not inserted twice.
    expect([...db.ratings.values()][0].score).toBe(4);
  });

  it("skips a rated event for an escrow that has no job record", async () => {
    const db = new FakeRatedStore();

    const outcome = await applyRatedEvent(db, 7n, ratedData());

    expect(outcome).toEqual({ status: "skipped", reason: "unknown-job" });
    expect(db.ratings.size).toBe(0);
    expect(db.users.size).toBe(0);
  });

  it("skips a malformed rated event without throwing", async () => {
    const db = new FakeRatedStore();

    const outcome = await applyRatedEvent(db, 7n, {});

    expect(outcome).toEqual({ status: "skipped", reason: "malformed" });
    expect(db.ratings.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Applying events to the database
// ---------------------------------------------------------------------------

interface FakeMilestone {
  id: string;
  index: number;
  status: "PENDING" | "RELEASED";
  releasedAt: Date | null;
}

interface FakeDispute {
  onChainId: bigint | null;
  jobId: string;
  raisedByAddress: string;
  reason: string;
  status: "RAISED" | "RESOLVED";
  resolvedAt: Date | null;
}

interface FakeJob {
  id: string;
  escrowId: bigint;
  asset: string;
  status: string;
  totalAmountUsdc: string;
  milestones: FakeMilestone[];
  disputes: FakeDispute[];
}

function fakeJob(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    id: "job_1",
    escrowId: 7n,
    asset: "USDC",
    status: "CREATED",
    totalAmountUsdc: "1",
    milestones: [
      { id: "m0", index: 0, status: "PENDING", releasedAt: null },
      { id: "m1", index: 1, status: "PENDING", releasedAt: null },
    ],
    disputes: [],
    ...overrides,
  };
}

/** The `where` clauses the handlers actually use. */
type FakeWhere = { escrowId?: bigint | null; id?: string; job?: { escrowId: bigint | null } };

interface FakeRatingRow {
  jobId: string;
  raterId: string;
  rateeId: string;
  score: number;
}

/**
 * In-memory stand-in for the slice of Prisma the handlers write through, so a
 * test can run a real event sequence and assert the rows it produces. Only the
 * access patterns the handlers use are implemented: `id`/`escrowId` lookups, the
 * `job: { escrowId }` relation filter, the dispute upsert, and the rating
 * upsert keyed by `(rater, job)`. Rating rows land in `ratings` so a test can
 * assert them. The cast at the end hides Prisma's own promise type, which the
 * fake has no need to reproduce.
 */
function makeStore(jobs: FakeJob[], ratings: FakeRatingRow[] = []): IndexerStore {
  const byId = (id: string) => jobs.find((job) => job.id === id);
  const byEscrow = (escrowId: bigint | null) => jobs.filter((job) => job.escrowId === escrowId);
  const related = <T>(where: FakeWhere, pick: (job: FakeJob) => T[]): T[] =>
    byEscrow(where.job?.escrowId ?? null).flatMap(pick);

  return {
    job: {
      findUnique: async ({ where, include }: { where: FakeWhere; include?: { milestones?: boolean } }) => {
        const job = where.id ? byId(where.id) : byEscrow(where.escrowId ?? null)[0];
        if (!job) return null;
        return include?.milestones ? job : { ...job, milestones: undefined };
      },
      update: async ({ where, data }: { where: FakeWhere; data: Partial<FakeJob> }) => {
        const job = byId(where.id as string);
        if (!job) throw new Error(`no job ${where.id}`);
        Object.assign(job, data);
        return job;
      },
      updateMany: async ({ where, data }: { where: FakeWhere; data: Partial<FakeJob> }) => {
        const matched = byEscrow(where.escrowId ?? null);
        for (const job of matched) Object.assign(job, data);
        return { count: matched.length };
      },
    },
    milestone: {
      update: async ({ where, data }: { where: FakeWhere; data: Partial<FakeMilestone> }) => {
        const milestone = jobs
          .flatMap((job) => job.milestones)
          .find((m) => m.id === where.id);
        if (!milestone) throw new Error(`no milestone ${where.id}`);
        Object.assign(milestone, data);
        return milestone;
      },
      updateMany: async ({ where, data }: { where: FakeWhere; data: Partial<FakeMilestone> }) => {
        const matched = related(where, (job) => job.milestones);
        for (const milestone of matched) Object.assign(milestone, data);
        return { count: matched.length };
      },
    },
    dispute: {
      updateMany: async ({ where, data }: { where: FakeWhere; data: Partial<FakeDispute> }) => {
        const matched = related(where, (job) => job.disputes);
        for (const dispute of matched) Object.assign(dispute, data);
        return { count: matched.length };
      },
      upsert: async ({
        where,
        create,
      }: {
        where: { onChainId: bigint };
        create: Partial<FakeDispute> & { jobId: string };
      }) => {
        const existing = jobs
          .flatMap((job) => job.disputes)
          .find((dispute) => dispute.onChainId === where.onChainId);
        if (existing) return existing;
        const job = byId(create.jobId);
        if (!job) throw new Error(`no job ${create.jobId}`);
        const created: FakeDispute = {
          onChainId: create.onChainId ?? null,
          jobId: create.jobId,
          raisedByAddress: create.raisedByAddress ?? "",
          reason: create.reason ?? "",
          status: create.status ?? "RAISED",
          resolvedAt: create.resolvedAt ?? null,
        };
        job.disputes.push(created);
        return created;
      },
    },
    user: {
      upsert: async ({ where }: { where: { stellarAddress: string } }) => ({
        id: `user_${where.stellarAddress}`,
      }),
    },
    rating: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { raterId_jobId: { raterId: string; jobId: string } };
        create: FakeRatingRow;
        update: { rateeId: string; score: number };
      }) => {
        const existing = ratings.find(
          (row) =>
            row.raterId === where.raterId_jobId.raterId &&
            row.jobId === where.raterId_jobId.jobId,
        );
        if (existing) Object.assign(existing, update);
        else ratings.push({ ...create });
        return {};
      },
    },
  } as unknown as IndexerStore;
}

describe("dispatchEvent", () => {
  it("moves the job to ACTIVE on funded, whose id is in the data map", async () => {
    const jobs = [fakeJob()];

    await dispatchEvent(
      makeEvent("funded", { escrow_id: nativeToScVal(7n, { type: "u64" }) }),
      makeStore(jobs),
    );

    expect(jobs[0].status).toBe("ACTIVE");
  });

  it("releases a milestone whose escrow id is only in the event topic", async () => {
    const jobs = [fakeJob({ status: "ACTIVE" })];

    await dispatchEvent(
      makeTopicEvent("milestone_released", 7n, { index: nativeToScVal(0, { type: "u32" }) }),
      makeStore(jobs),
    );

    expect(jobs[0].milestones[0].status).toBe("RELEASED");
    expect(jobs[0].milestones[0].releasedAt).toBeInstanceOf(Date);
    // The other milestone is still pending, so the job is not done yet.
    expect(jobs[0].milestones[1].status).toBe("PENDING");
    expect(jobs[0].status).toBe("ACTIVE");
  });

  it("completes the job once the last milestone is released", async () => {
    const jobs = [fakeJob({ status: "ACTIVE" })];
    const store = makeStore(jobs);

    for (const index of [0, 1]) {
      await dispatchEvent(
        makeTopicEvent("milestone_released", 7n, { index: nativeToScVal(index, { type: "u32" }) }),
        store,
      );
    }

    expect(jobs[0].milestones.map((m) => m.status)).toEqual(["RELEASED", "RELEASED"]);
    expect(jobs[0].status).toBe("COMPLETED");
  });

  it("marks the job DISPUTED when a dispute is opened", async () => {
    const jobs = [fakeJob({ status: "ACTIVE" })];

    await dispatchEvent(makeTopicEvent("dispute_opened", 7n), makeStore(jobs));

    expect(jobs[0].status).toBe("DISPUTED");
  });

  it("settles the milestones too when the escrow is resolved", async () => {
    // `escrow.resolve` pays out in one transaction and emits only `resolved`,
    // so no per-milestone events follow. Left unhandled, an arbitrated job
    // would be COMPLETED while its milestones stayed PENDING forever.
    const jobs = [
      fakeJob({
        status: "DISPUTED",
        disputes: [
          {
            onChainId: 3n,
            jobId: "job_1",
            raisedByAddress: ALICE,
            reason: "",
            status: "RAISED",
            resolvedAt: null,
          },
        ],
      }),
    ];

    await dispatchEvent(
      makeTopicEvent("resolved", 7n, {
        client_share: nativeToScVal(0n, { type: "i128" }),
        freelancer_share: nativeToScVal(20_000_000n, { type: "i128" }),
      }),
      makeStore(jobs),
    );

    expect(jobs[0].status).toBe("COMPLETED");
    expect(jobs[0].disputes[0]).toMatchObject({ status: "RESOLVED" });
    expect(jobs[0].milestones.map((m) => m.status)).toEqual(["RELEASED", "RELEASED"]);
    // One transaction on-chain, so one instant off-chain.
    expect(jobs[0].milestones.map((m) => m.releasedAt)).toEqual([
      jobs[0].disputes[0].resolvedAt,
      jobs[0].disputes[0].resolvedAt,
    ]);
    expect(jobs[0].disputes[0].resolvedAt).toBeInstanceOf(Date);
  });

  it("treats dispute_resolved like resolved", async () => {
    const jobs = [fakeJob({ status: "DISPUTED" })];

    await dispatchEvent(makeTopicEvent("dispute_resolved", 7n), makeStore(jobs));

    expect(jobs[0].status).toBe("COMPLETED");
    expect(jobs[0].milestones[0].status).toBe("RELEASED");
  });

  it("refunds the job, leaving the milestones untouched", async () => {
    const jobs = [fakeJob({ status: "ACTIVE" })];

    await dispatchEvent(makeTopicEvent("refunded", 7n), makeStore(jobs));

    expect(jobs[0].status).toBe("REFUNDED");
    expect(jobs[0].milestones[0].status).toBe("PENDING");
  });

  it("reconciles the total from milestones_updated without rebuilding the rows", async () => {
    // The event carries only count/total_amount, so the per-milestone rows stay
    // as the API wrote them; the total cannot drift even if `PUT /milestones`
    // never follows.
    const jobs = [fakeJob({ asset: "XLM", totalAmountUsdc: "1" })];

    await dispatchEvent(
      makeTopicEvent("milestones_updated", 7n, {
        count: nativeToScVal(2, { type: "u32" }),
        total_amount: nativeToScVal(25_000_000n, { type: "i128" }),
      }),
      makeStore(jobs),
    );

    expect(jobs[0].totalAmountUsdc).toBe("2.5");
    expect(jobs[0].milestones.map((m) => m.id)).toEqual(["m0", "m1"]);
  });

  it("ignores a milestones_updated total of zero", async () => {
    const jobs = [fakeJob({ totalAmountUsdc: "1" })];

    await dispatchEvent(
      makeTopicEvent("milestones_updated", 7n, {
        count: nativeToScVal(0, { type: "u32" }),
        total_amount: nativeToScVal(0n, { type: "i128" }),
      }),
      makeStore(jobs),
    );

    expect(jobs[0].totalAmountUsdc).toBe("1");
  });

  it("records a raised dispute once, even when the event is replayed", async () => {
    const jobs = [fakeJob()];
    const store = makeStore(jobs);
    const event = makeTopicEvent("raised", 7n, {
      dispute_id: nativeToScVal(3n, { type: "u64" }),
      raised_by: Address.fromString(ALICE).toScVal(),
    });

    await dispatchEvent(event, store);
    await dispatchEvent(event, store);

    expect(jobs[0].disputes).toEqual([
      {
        onChainId: 3n,
        jobId: "job_1",
        raisedByAddress: ALICE,
        reason: "",
        status: "RAISED",
        resolvedAt: null,
      },
    ]);
  });

  it("writes nothing for an event it cannot attribute to an escrow", async () => {
    const jobs = [fakeJob()];
    const before = structuredClone(jobs);

    await dispatchEvent(
      makeEvent("milestone_released", { index: nativeToScVal(0, { type: "u32" }) }),
      makeStore(jobs),
    );

    expect(jobs).toEqual(before);
  });

  it("ignores an event name it does not know", async () => {
    const jobs = [fakeJob()];
    const before = structuredClone(jobs);

    await dispatchEvent(makeTopicEvent("something_new", 7n), makeStore(jobs));

    expect(jobs).toEqual(before);
  });

  it("stores a rating whose escrow id is only in the event topic", async () => {
    // `rated` carries escrow_id as its #[topic] field. Reading it from the data
    // map instead made every real rating event look malformed, so ratings made
    // with `stellar contract invoke` never reached the database.
    const rater = Keypair.random().publicKey();
    const ratee = Keypair.random().publicKey();
    const ratings: FakeRatingRow[] = [];

    await dispatchEvent(
      makeTopicEvent("rated", 7n, {
        rater: Address.fromString(rater).toScVal(),
        ratee: Address.fromString(ratee).toScVal(),
        score: nativeToScVal(4, { type: "u32" }),
      }),
      makeStore([fakeJob()], ratings),
    );

    expect(ratings).toEqual([
      {
        jobId: "job_1",
        raterId: `user_${rater}`,
        rateeId: `user_${ratee}`,
        score: 4,
      },
    ]);
  });

  it("ignores a rated event with no escrow id", async () => {
    const ratings: FakeRatingRow[] = [];

    await dispatchEvent(
      makeEvent("rated", {
        rater: Address.fromString(Keypair.random().publicKey()).toScVal(),
        ratee: Address.fromString(Keypair.random().publicKey()).toScVal(),
        score: nativeToScVal(4, { type: "u32" }),
      }),
      makeStore([fakeJob()], ratings),
    );

    expect(ratings).toEqual([]);
  });

  it("leaves an event for an unknown escrow alone", async () => {
    const jobs = [fakeJob()];
    const before = structuredClone(jobs);

    await dispatchEvent(makeTopicEvent("refunded", 999n), makeStore(jobs));

    expect(jobs).toEqual(before);
  });
});
