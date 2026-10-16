import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

interface FakeUser {
  id: string;
  stellarAddress: string;
  displayName: string | null;
  bio: string | null;
  createdAt: Date;
  ratingsReceived: { score: number }[];
  jobsAsFreelancer: { id: string; status: string }[];
}

let fakeUsers: FakeUser[] = [];

vi.mock("../db", () => {
  return {
    prisma: {
      user: {
        findMany: vi.fn(async (args?: { where?: { OR?: Array<{ stellarAddress?: { contains: string }; displayName?: { contains: string }; bio?: { contains: string } }> } }) => {
          let list = [...fakeUsers];
          if (args?.where?.OR) {
            const searchOr = args.where.OR;
            list = list.filter((user) => {
              return searchOr.some((clause) => {
                if (clause.stellarAddress?.contains) {
                  return user.stellarAddress.toLowerCase().includes(clause.stellarAddress.contains.toLowerCase());
                }
                if (clause.displayName?.contains) {
                  return Boolean(user.displayName?.toLowerCase().includes(clause.displayName.contains.toLowerCase()));
                }
                if (clause.bio?.contains) {
                  return Boolean(user.bio?.toLowerCase().includes(clause.bio.contains.toLowerCase()));
                }
                return false;
              });
            });
          }
          return list;
        }),
        findUnique: vi.fn(async ({ where }: { where: { stellarAddress: string } }) => {
          const user = fakeUsers.find((u) => u.stellarAddress === where.stellarAddress);
          if (!user) return null;
          return {
            ...user,
            _count: {
              jobsAsFreelancer: user.jobsAsFreelancer.length,
              jobsAsClient: 0,
            },
          };
        }),
      },
      authNonce: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      },
    },
  };
});

describe("GET /api/users/freelancers (#68)", () => {
  let baseUrl: string;
  let server: Server;

  beforeAll(async () => {
    const { usersRouter } = await import("../routes/users");
    const { errorHandler } = await import("../middleware/errorHandler");

    const app = express();
    app.use(express.json());
    app.use("/api/users", usersRouter);
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
    fakeUsers = [
      {
        id: "user-1",
        stellarAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        displayName: "Alice Developer",
        bio: "Fullstack web3 and Soroban developer",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        ratingsReceived: [{ score: 5 }, { score: 4 }], // avg: 4.5
        jobsAsFreelancer: [{ id: "job-1", status: "COMPLETED" }, { id: "job-2", status: "ACTIVE" }],
      },
      {
        id: "user-2",
        stellarAddress: "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B",
        displayName: "Bob Designer",
        bio: "UI/UX designer with Stellar experience",
        createdAt: new Date("2026-02-01T00:00:00Z"),
        ratingsReceived: [{ score: 5 }, { score: 5 }, { score: 5 }], // avg: 5.0
        jobsAsFreelancer: [
          { id: "job-3", status: "COMPLETED" },
          { id: "job-4", status: "COMPLETED" },
          { id: "job-5", status: "COMPLETED" },
        ],
      },
      {
        id: "user-3",
        stellarAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        displayName: "Charlie Junior",
        bio: "Junior Rust programmer",
        createdAt: new Date("2026-03-01T00:00:00Z"),
        ratingsReceived: [], // avg: 0
        jobsAsFreelancer: [],
      },
    ];
  });

interface FreelancerDirectoryResponse {
  freelancers: Array<{
    id: string;
    stellarAddress: string;
    displayName: string | null;
    bio: string | null;
    createdAt: string;
    averageScore: number;
    totalRatings: number;
    completedJobsCount: number;
    totalJobsCount: number;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

  it("lists all freelancers with their reputation score and completed jobs", async () => {
    const res = await fetch(`${baseUrl}/api/users/freelancers`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as FreelancerDirectoryResponse;
    expect(data.total).toBe(3);
    expect(data.freelancers).toHaveLength(3);

    // Default sorting is by reputation desc: Bob (5.0) then Alice (4.5) then Charlie (0)
    expect(data.freelancers[0].displayName).toBe("Bob Designer");
    expect(data.freelancers[0].averageScore).toBe(5);
    expect(data.freelancers[0].totalRatings).toBe(3);
    expect(data.freelancers[0].completedJobsCount).toBe(3);

    expect(data.freelancers[1].displayName).toBe("Alice Developer");
    expect(data.freelancers[1].averageScore).toBe(4.5);
    expect(data.freelancers[1].totalRatings).toBe(2);
    expect(data.freelancers[1].completedJobsCount).toBe(1);

    expect(data.freelancers[2].displayName).toBe("Charlie Junior");
    expect(data.freelancers[2].averageScore).toBe(0);
    expect(data.freelancers[2].totalRatings).toBe(0);
    expect(data.freelancers[2].completedJobsCount).toBe(0);
  });

  it("supports sorting by reputation ascending", async () => {
    const res = await fetch(`${baseUrl}/api/users/freelancers?sortBy=reputation&sortOrder=asc`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as FreelancerDirectoryResponse;
    expect(data.freelancers[0].displayName).toBe("Charlie Junior");
    expect(data.freelancers[2].displayName).toBe("Bob Designer");
  });

  it("supports sorting by completed jobs count", async () => {
    const res = await fetch(`${baseUrl}/api/users/freelancers?sortBy=jobs&sortOrder=desc`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as FreelancerDirectoryResponse;
    expect(data.freelancers[0].displayName).toBe("Bob Designer"); // 3 completed
    expect(data.freelancers[1].displayName).toBe("Alice Developer"); // 1 completed
    expect(data.freelancers[2].displayName).toBe("Charlie Junior"); // 0 completed
  });

  it("filters freelancers by search term (name, bio, or address)", async () => {
    const res = await fetch(`${baseUrl}/api/users/freelancers?search=soroban`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as FreelancerDirectoryResponse;
    expect(data.total).toBe(1);
    expect(data.freelancers[0].displayName).toBe("Alice Developer");
  });

  it("supports pagination with page and limit", async () => {
    const res = await fetch(`${baseUrl}/api/users/freelancers?page=1&limit=2`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as FreelancerDirectoryResponse;
    expect(data.freelancers).toHaveLength(2);
    expect(data.total).toBe(3);
    expect(data.totalPages).toBe(2);
    expect(data.page).toBe(1);

    const resPage2 = await fetch(`${baseUrl}/api/users/freelancers?page=2&limit=2`);
    expect(resPage2.status).toBe(200);
    const dataPage2 = (await resPage2.json()) as FreelancerDirectoryResponse;
    expect(dataPage2.freelancers).toHaveLength(1);
    expect(dataPage2.freelancers[0].displayName).toBe("Charlie Junior");
  });

  it("supports GET /api/users as an alias", async () => {
    const res = await fetch(`${baseUrl}/api/users`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as FreelancerDirectoryResponse;
    expect(data.total).toBe(3);
  });

  it("does not conflict with GET /api/users/:address", async () => {
    const res = await fetch(`${baseUrl}/api/users/GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { displayName: string };
    expect(data.displayName).toBe("Alice Developer");
  });
});
