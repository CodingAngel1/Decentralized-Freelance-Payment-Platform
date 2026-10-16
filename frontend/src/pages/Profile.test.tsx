/**
 * Profile.test.tsx
 *
 * The reputation view is read-only, but it is the page a client checks before
 * paying someone. The states that matter are: the aggregate, the job history and
 * the individual ratings behind it (issue #69), an address with nothing yet, and
 * a read that failed. The wallet, the SDK and the API client are mocked — no
 * network, no Freighter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** The route param, so a test can point the page at another address. */
  address: "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B",
  escrow: {
    getReputation: vi.fn(),
    isPending: vi.fn((kind?: string) => kind === "reputation"),
    error: null as string | null,
  },
  wallet: {
    publicKey: "GVIEWER" as string | null,
    connect: vi.fn(async () => "GVIEWER"),
  },
  api: {
    fetchUserJobs: vi.fn(),
    fetchRatingsReceived: vi.fn(),
  },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ address: h.address }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("../hooks/wallet-context", () => ({ useWallet: () => h.wallet }));
vi.mock("../hooks/useEscrow", () => ({ useEscrow: () => h.escrow }));
vi.mock("../lib/api", () => ({
  fetchUserJobs: h.api.fetchUserJobs,
  fetchRatingsReceived: h.api.fetchRatingsReceived,
}));

import Profile from "./Profile";
import type { JobApi, ReceivedRatingApi } from "../lib/api";

const ADDRESS = h.address;

/** The rendered summary line, whatever markup it is spread across. */
const summary = (text: string) =>
  screen.findByText((_content, element) => element?.textContent === text);

function job(overrides: Partial<JobApi> = {}): JobApi {
  return {
    id: "job-1",
    escrowId: 7,
    title: "Landing page redesign",
    status: "COMPLETED",
    asset: "USDC",
    totalAmountUsdc: "2.5",
    createdAt: "2026-01-02T00:00:00.000Z",
    client: { stellarAddress: ADDRESS },
    freelancer: { stellarAddress: "GFREELANCER" },
    ...overrides,
  };
}

function rating(overrides: Partial<ReceivedRatingApi> = {}): ReceivedRatingApi {
  return {
    id: "rating-1",
    score: 5,
    comment: null,
    createdAt: "2026-01-03T00:00:00.000Z",
    job: { id: "job-1", title: "Landing page redesign", escrowId: 7, status: "COMPLETED" },
    rater: { stellarAddress: "GFREELANCER" },
    ...overrides,
  };
}

beforeEach(() => {
  h.escrow.getReputation.mockReset();
  // `useEscrow.run` is async, so a real read always resolves — to `undefined`
  // when it fails (the error is surfaced on the hook, not thrown).
  h.escrow.getReputation.mockResolvedValue(undefined);
  h.escrow.isPending.mockReset();
  h.escrow.isPending.mockReturnValue(false);
  h.escrow.error = null;
  h.wallet.publicKey = "GVIEWER";
  h.api.fetchUserJobs.mockReset();
  h.api.fetchUserJobs.mockResolvedValue([]);
  h.api.fetchRatingsReceived.mockReset();
  h.api.fetchRatingsReceived.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("Profile reputation", () => {
  it("shows the weighted average for the address in the route", async () => {
    h.escrow.getReputation.mockResolvedValue({ total_score: 9n, weight: 2n, count: 2n });

    render(<Profile />);

    expect(await summary("Rating: 4.50 / 5 from 2 review(s)")).toBeTruthy();
    expect(h.escrow.getReputation).toHaveBeenCalledWith(ADDRESS);
  });

  it("falls back to the raw count for aggregates written before weighting", async () => {
    // `weight` is 0 for ratings stored before the amount-weighted aggregate
    // existed, so the plain mean is the only thing available.
    h.escrow.getReputation.mockResolvedValue({ total_score: 8n, weight: 0n, count: 2n });

    render(<Profile />);

    expect(await summary("Rating: 4.00 / 5 from 2 review(s)")).toBeTruthy();
  });

  it("says there is nothing to show yet for an unrated address", async () => {
    h.escrow.getReputation.mockResolvedValue({ total_score: 0n, weight: 0n, count: 0n });

    render(<Profile />);

    expect(await screen.findByText("No ratings yet.")).toBeTruthy();
  });

  it("shows a loading state while the read is in flight", async () => {
    h.escrow.isPending.mockReturnValue(true);
    h.escrow.getReputation.mockImplementation(() => new Promise(() => {}));

    render(<Profile />);

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("reports a failed read instead of claiming the address has no ratings", async () => {
    // The read rejects inside the hook, which sets `error` and resolves the call
    // with `undefined`; the page must not read that as "no ratings yet".
    h.escrow.error = "Could not reach the network.";

    render(<Profile />);

    expect((await screen.findByRole("alert")).textContent).toBe("Could not reach the network.");
    expect(screen.queryByText("No ratings yet.")).toBeNull();
  });

  it("offers to connect a wallet but still shows the address", async () => {
    // A profile is public: the address renders before any wallet exists (#108
    // covers reading the aggregate without connecting).
    h.wallet.publicKey = null;
    render(<Profile />);

    // The address is public: it does not take a wallet to look someone up.
    expect(screen.getByText(ADDRESS)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect Freighter" }));
    await waitFor(() => expect(h.wallet.connect).toHaveBeenCalled());
  });
});

describe("Profile job history (#69)", () => {
  it("lists past jobs with the role, the status and a link to the escrow", async () => {
    h.api.fetchUserJobs.mockResolvedValue([
      job(),
      job({
        id: "job-2",
        escrowId: null,
        title: "Draft job",
        status: "CREATED",
        client: { stellarAddress: "GSOMEONE_ELSE" },
        freelancer: { stellarAddress: ADDRESS },
      }),
    ]);

    render(<Profile />);

    // The job where the profile address is the client, and the one where it is
    // the freelancer, both belong to the history.
    expect(await screen.findByText("Landing page redesign")).toBeTruthy();
    expect(screen.getByText("Draft job")).toBeTruthy();
    expect(screen.getByText(/Client · Total: 2\.5 USDC/)).toBeTruthy();
    expect(screen.getByText(/Freelancer · Total: 2\.5 USDC/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open job #7" }).getAttribute("href")).toBe(
      "/jobs/7",
    );
    // A job with no on-chain escrow is listed but not linked.
    expect(screen.getByText("Not funded on-chain yet")).toBeTruthy();
    expect(h.api.fetchUserJobs).toHaveBeenCalledWith(ADDRESS);
  });

  it("shows an empty state when the address has no jobs", async () => {
    render(<Profile />);

    expect(await screen.findByText("No jobs yet.")).toBeTruthy();
  });

  it("reports a failed history load instead of showing an empty list", async () => {
    h.api.fetchUserJobs.mockRejectedValue(new Error("Could not load jobs (HTTP 500)"));
    h.api.fetchRatingsReceived.mockResolvedValue([]);

    render(<Profile />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not load jobs (HTTP 500)",
    );
    expect(screen.queryByText("No jobs yet.")).toBeNull();
  });
});

describe("Profile rating breakdown (#69)", () => {
  it("shows each rating's score, job and date", async () => {
    h.api.fetchRatingsReceived.mockResolvedValue([
      rating({ score: 5, createdAt: "2026-01-03T00:00:00.000Z", comment: "Great work" }),
      rating({
        id: "rating-2",
        score: 3,
        createdAt: "2026-02-04T00:00:00.000Z",
        job: { id: "job-2", title: "Logo refresh", escrowId: null, status: "COMPLETED" },
      }),
    ]);

    render(<Profile />);

    // Score and job title, so a rating is attributable rather than an anonymous
    // number, plus the date it was given.
    expect(await screen.findByText("5 / 5")).toBeTruthy();
    expect(screen.getByText("3 / 5")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Landing page redesign" }).getAttribute("href")).toBe(
      "/jobs/7",
    );
    // A rating whose job never reached the chain is still shown, unlinked.
    expect(screen.getByText("Logo refresh")).toBeTruthy();
    expect(
      screen.getByText(new Date("2026-01-03T00:00:00.000Z").toLocaleDateString()),
    ).toBeTruthy();
    expect(screen.getByText("“Great work”")).toBeTruthy();
    expect(h.api.fetchRatingsReceived).toHaveBeenCalledWith(ADDRESS);
  });

  it("shows an empty state when the address has not been rated", async () => {
    render(<Profile />);

    expect(await screen.findByText("No ratings received yet.")).toBeTruthy();
  });
});
