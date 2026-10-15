import { describe, it, expect, vi } from "vitest";
import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  decodeEventData,
  decodeEventName,
  type ContractEventLike,
} from "../lib/events";
import {
  applyRatedEvent,
  processContractEvents,
  resolveStartLedger,
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
