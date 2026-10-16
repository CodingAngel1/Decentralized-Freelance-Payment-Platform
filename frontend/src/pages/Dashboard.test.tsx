/**
 * Dashboard.test.tsx
 *
 * The landing page is the one route every visitor loads, and it holds the two
 * pieces of state most likely to regress silently: the job list (filter +
 * pagination + aborts) and the "open a job by id" form. The wallet and the API
 * client are mocked — no network, no Freighter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Hoisted so the vi.mock factories below can reference them.
const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  wallet: {
    publicKey: null as string | null,
    connecting: false,
    error: null as string | null,
    connect: vi.fn(async () => "GCLIENT"),
    disconnect: vi.fn(),
  },
  fetchJobs: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => h.navigate,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("../hooks/wallet-context", () => ({ useWallet: () => h.wallet }));
vi.mock("../lib/api", () => ({ fetchJobs: h.fetchJobs }));

import Dashboard from "./Dashboard";
import type { JobApi } from "../lib/api";
import { SKILL_TAGS } from "../lib/tags";

const CLIENT = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";

function job(overrides: Partial<JobApi> = {}): JobApi {
  return {
    id: "job-1",
    escrowId: 7,
    title: "Landing page redesign",
    status: "ACTIVE",
    asset: "XLM",
    totalAmountUsdc: 1.5,
    client: { stellarAddress: CLIENT },
    ...overrides,
  };
}

/** The query the component last asked the API for. */
function lastQuery(): unknown {
  const calls = h.fetchJobs.mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  h.navigate.mockClear();
  h.fetchJobs.mockReset();
  h.fetchJobs.mockResolvedValue([]);
  h.wallet.publicKey = null;
  h.wallet.connecting = false;
  h.wallet.error = null;
  h.wallet.connect.mockClear();
});

afterEach(() => cleanup());

describe("Dashboard wallet state", () => {
  it("asks an unconnected visitor to connect", async () => {
    render(<Dashboard />);

    fireEvent.click(screen.getByRole("button", { name: "Connect your Freighter wallet" }));

    await waitFor(() => expect(h.wallet.connect).toHaveBeenCalled());
  });

  it("replaces the prompt with a link to the connected wallet's reputation", () => {
    h.wallet.publicKey = CLIENT;
    render(<Dashboard />);

    expect(screen.queryByRole("button", { name: /Connect your Freighter wallet/ })).toBeNull();
    expect(screen.getByRole("link", { name: "View reputation" }).getAttribute("href")).toBe(
      `/profile/${CLIENT}`,
    );
  });

  it("surfaces a wallet error", () => {
    h.wallet.error = "Freighter wallet not found. Install it from freighter.app";
    render(<Dashboard />);

    expect(screen.getByRole("alert").textContent).toBe(
      "Freighter wallet not found. Install it from freighter.app",
    );
  });
});

describe("Dashboard job list", () => {
  it("shows a loading state until the first page arrives", async () => {
    let settle: (jobs: JobApi[]) => void = () => {};
    h.fetchJobs.mockImplementation(
      () =>
        new Promise<JobApi[]>((resolve) => {
          settle = resolve;
        }),
    );

    render(<Dashboard />);

    expect(screen.getByText("Loading jobs…")).toBeTruthy();

    await act(async () => settle([job()]));

    expect(await screen.findByText("Landing page redesign")).toBeTruthy();
    expect(screen.queryByText("Loading jobs…")).toBeNull();
  });

  it("lists each job with its status and, once funded, a link to the escrow", async () => {
    h.fetchJobs.mockResolvedValue([
      job(),
      job({ id: "job-2", escrowId: null, title: "Draft job", status: "CREATED" }),
    ]);

    render(<Dashboard />);

    expect(await screen.findByText("Landing page redesign")).toBeTruthy();
    // Scoped to the badge: the filter dropdown also contains the word ACTIVE.
    expect(screen.getByText("ACTIVE", { selector: "span.badge" }).className).toBe(
      "badge badge-active",
    );
    expect(screen.getByRole("link", { name: "Open job #7" }).getAttribute("href")).toBe("/jobs/7");
    // A job with no on-chain escrow yet is listed but not linked.
    expect(screen.getByText("Not funded on-chain yet")).toBeTruthy();
  });

  it("shows each job's skill tags by their display label", async () => {
    h.fetchJobs.mockResolvedValue([job({ tags: ["web-development", "devops"] })]);

    render(<Dashboard />);

    await screen.findByText("Landing page redesign");
    // Labels, not the stored slugs. Scoped to the row badge: the same label is
    // also an option in the skill filter.
    expect(screen.getByText("Web development", { selector: "span.tag" })).toBeTruthy();
    expect(screen.getByText("DevOps & infrastructure", { selector: "span.tag" })).toBeTruthy();
  });

  it("tolerates a job with no tags at all", async () => {
    h.fetchJobs.mockResolvedValue([job({ tags: undefined })]);

    render(<Dashboard />);

    expect(await screen.findByText("Landing page redesign")).toBeTruthy();
  });

  it("shows an empty state rather than a blank list", async () => {
    render(<Dashboard />);

    expect(await screen.findByText("No jobs found.")).toBeTruthy();
  });

  it("reports a failed load instead of pretending the list is empty", async () => {
    h.fetchJobs.mockRejectedValue(new Error("Could not load jobs (HTTP 500)"));

    render(<Dashboard />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not load jobs (HTTP 500)",
    );
    expect(screen.queryByText("No jobs found.")).toBeNull();
  });

  it("re-fetches from page 1 when the status filter changes", async () => {
    h.fetchJobs.mockResolvedValue([job()]);
    render(<Dashboard />);
    await screen.findByText("Landing page redesign");

    expect(lastQuery()).toEqual({ status: undefined, page: 1, limit: 10 });

    fireEvent.change(screen.getByLabelText(/Filter by status/), {
      target: { value: "COMPLETED" },
    });

    // Back to page 1: page 3 of the previous filter is meaningless under a new one.
    await waitFor(() => expect(lastQuery()).toEqual({ status: "COMPLETED", page: 1, limit: 10 }));
  });

  it("filters by skill tag and re-fetches from page 1", async () => {
    h.fetchJobs.mockResolvedValue([job()]);
    render(<Dashboard />);
    await screen.findByText("Landing page redesign");

    fireEvent.change(screen.getByLabelText(/Filter by skill/), {
      target: { value: "smart-contracts" },
    });

    // The tag is applied by the API, so pagination stays correct.
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        status: undefined,
        tag: "smart-contracts",
        page: 1,
        limit: 10,
      }),
    );
  });

  it("offers every curated skill in the filter", async () => {
    render(<Dashboard />);
    await screen.findByText("No jobs found.");

    const select = screen.getByLabelText(/Filter by skill/) as HTMLSelectElement;
    // "All skills" plus one option per curated tag.
    expect(select.querySelectorAll("option")).toHaveLength(SKILL_TAGS.length + 1);
  });

  it("appends the next page when asked for more", async () => {
    const firstPage = Array.from({ length: 10 }, (_, i) =>
      job({ id: `job-${i}`, escrowId: i, title: `Job ${i}` }),
    );
    h.fetchJobs
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([job({ id: "job-10", escrowId: 10, title: "Job 10" })]);

    render(<Dashboard />);
    await screen.findByText("Job 0");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Job 10")).toBeTruthy();
    expect(lastQuery()).toEqual({ status: undefined, page: 2, limit: 10 });
    // The already-loaded page stays on screen.
    expect(screen.getByText("Job 0")).toBeTruthy();
    // A short page means there is nothing after it.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
  });

  it("offers no further pages when the first one is short", async () => {
    h.fetchJobs.mockResolvedValue([job()]);

    render(<Dashboard />);
    await screen.findByText("Landing page redesign");

    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("aborts the in-flight request when the page unmounts", async () => {
    h.fetchJobs.mockImplementation(() => new Promise<JobApi[]>(() => {}));

    const { unmount } = render(<Dashboard />);
    const signal = h.fetchJobs.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    unmount();

    // Otherwise the response settles into a component that is gone.
    expect(signal.aborted).toBe(true);
  });

  it("does not report a superseded request as an error", async () => {
    h.fetchJobs.mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    render(<Dashboard />);

    await waitFor(() => expect(h.fetchJobs).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Dashboard open-by-id form", () => {
  it("navigates to the job with the typed id, trimmed", async () => {
    render(<Dashboard />);

    fireEvent.change(screen.getByLabelText(/Open a job by on-chain id/), {
      target: { value: " 12 " },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Open" }).closest("form") as HTMLFormElement);

    expect(h.navigate).toHaveBeenCalledWith("/jobs/12");
  });

  it("stays put for a blank id", () => {
    render(<Dashboard />);

    fireEvent.submit(screen.getByRole("button", { name: "Open" }).closest("form") as HTMLFormElement);

    expect(h.navigate).not.toHaveBeenCalled();
    // No validation beyond "not blank" — see #106 for the non-numeric input that
    // this form hands straight to JobDetail.
  });
});
