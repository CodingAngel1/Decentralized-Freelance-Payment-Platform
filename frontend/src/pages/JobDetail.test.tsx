import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Hoisted so the vi.mock factories below can reference them.
const h = vi.hoisted(() => ({
  escrow: {
    getEscrow: vi.fn(),
    releaseMilestone: vi.fn(),
    openDispute: vi.fn(),
    reclaimDisputed: vi.fn(),
    submitRating: vi.fn(),
    getDisputeDeadline: vi.fn(),
    isPending: vi.fn(() => false),
    hasPendingWrite: vi.fn(() => false),
    error: null as string | null,
    lastFailure: null as { kind: string; code: number | null } | null,
  },
  wallet: {
    publicKey: "GCLIENT" as string | null,
    connect: vi.fn(async () => "GCLIENT"),
    signMessage: vi.fn(async () => "sig"),
  },
  authenticate: vi.fn(async () => "jwt-1"),
  fetchJobs: vi.fn(async () => [] as unknown[]),
  recordRating: vi.fn(async () => ({ rating: {}, xdr: "x" })),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "7" }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("../hooks/wallet-context", () => ({ useWallet: () => h.wallet }));
vi.mock("../hooks/useEscrow", () => ({ useEscrow: () => h.escrow }));
vi.mock("../lib/stellar", () => ({
  explorerTxUrl: (hash: string) => `https://stellar.expert/tx/${hash}`,
}));
vi.mock("../lib/api", () => ({
  authenticate: h.authenticate,
  fetchJobs: h.fetchJobs,
  submitRating: h.recordRating,
}));

import JobDetail from "./JobDetail";

const CLIENT = "GCLIENT";
const FREELANCER = "GFREELANCER";

const COMPLETED = {
  client: CLIENT,
  freelancer: FREELANCER,
  token: "CTOKEN",
  total_amount: 20_000_000n,
  milestones: [
    { amount: 20_000_000n, released: true, released_amount: 20_000_000n, deadline: 0n },
  ],
  status: "Completed",
  created_at: 0n,
  expiry: 0n,
};

/** A disputed escrow with one milestone still unreleased. */
const DISPUTED = {
  ...COMPLETED,
  status: "Disputed",
  milestones: [
    { amount: 20_000_000n, released: false, released_amount: 0n, deadline: 0n },
  ],
};

/** Current unix seconds — the contract compares against its own ledger clock. */
const nowSeconds = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  h.wallet.publicKey = CLIENT;
  h.escrow.getEscrow.mockReset();
  h.escrow.getEscrow.mockResolvedValue(COMPLETED);
  h.escrow.submitRating.mockReset();
  h.escrow.submitRating.mockResolvedValue({ hash: "HASH", result: undefined });
  h.escrow.reclaimDisputed.mockReset();
  h.escrow.reclaimDisputed.mockResolvedValue({ hash: "RECLAIMHASH", result: undefined });
  h.escrow.getDisputeDeadline.mockReset();
  h.escrow.getDisputeDeadline.mockResolvedValue(BigInt(nowSeconds() + 3 * 86_400));
  h.escrow.isPending.mockReset();
  h.escrow.isPending.mockReturnValue(false);
  h.escrow.hasPendingWrite.mockReset();
  h.escrow.hasPendingWrite.mockReturnValue(false);
  h.escrow.error = null;
  h.escrow.lastFailure = null;
  h.fetchJobs.mockReset();
  h.fetchJobs.mockResolvedValue([]);
  h.authenticate.mockClear();
  h.recordRating.mockClear();
});

afterEach(() => cleanup());

/** Render the page and wait for the rating form to appear. */
async function renderCompleted(): Promise<void> {
  render(<JobDetail />);
  await screen.findByRole("heading", { name: "Rate your counterparty" });
}

function submitRatingForm(): void {
  const form = screen
    .getByRole("button", { name: "Submit rating" })
    .closest("form");
  if (!form) throw new Error("rating form not found");
  fireEvent.submit(form);
}

describe("JobDetail rating", () => {
  it("offers the participant a rating form on a completed job", async () => {
    await renderCompleted();

    expect(screen.getAllByRole("radio")).toHaveLength(5);
    // No score chosen yet, so the form cannot be submitted.
    const submit = screen.getByRole("button", { name: "Submit rating" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("submits the rating on-chain and links the hash and the counterparty profile", async () => {
    await renderCompleted();

    fireEvent.click(screen.getByRole("radio", { name: /4/ }));
    submitRatingForm();

    await waitFor(() =>
      expect(h.escrow.submitRating).toHaveBeenCalledWith(7n, FREELANCER, 4),
    );
    await screen.findByText(/your rating was submitted/i);
    // The form is gone once the wallet has rated.
    expect(screen.queryByRole("button", { name: "Submit rating" })).toBeNull();

    const profile = screen.getByRole("link", { name: /View reputation/ });
    expect(profile.getAttribute("href")).toBe(`/profile/${FREELANCER}`);
    const tx = screen.getByRole("link", { name: /HASH/ });
    expect(tx.getAttribute("href")).toBe("https://stellar.expert/tx/HASH");
  });

  it("lets the freelancer rate the client", async () => {
    h.wallet.publicKey = FREELANCER;
    await renderCompleted();

    fireEvent.click(screen.getByRole("radio", { name: /5/ }));
    submitRatingForm();

    await waitFor(() => expect(h.escrow.submitRating).toHaveBeenCalledWith(7n, CLIENT, 5));
  });

  it("persists the optional comment off-chain after the rating lands", async () => {
    h.fetchJobs.mockResolvedValue([
      { id: "job-1", escrowId: 7, title: "t", status: "COMPLETED", totalAmountUsdc: 1 },
    ]);
    await renderCompleted();

    fireEvent.click(screen.getByRole("radio", { name: /5/ }));
    fireEvent.change(screen.getByLabelText(/Comment/), {
      target: { value: "great work" },
    });
    submitRatingForm();

    await waitFor(() =>
      expect(h.recordRating).toHaveBeenCalledWith(
        { jobId: "job-1", rateeAddress: FREELANCER, score: 5, comment: "great work" },
        "jwt-1",
      ),
    );
  });

  it("hides the form and explains when this wallet has already rated", async () => {
    h.escrow.lastFailure = { kind: "rate", code: 5 };
    render(<JobDetail />);

    await screen.findByText(/already rated this job/i);
    expect(screen.queryByRole("button", { name: "Submit rating" })).toBeNull();
  });

  it("does not offer a rating before the job completes", async () => {
    h.escrow.getEscrow.mockResolvedValue({ ...COMPLETED, status: "Active" });
    render(<JobDetail />);

    await screen.findByText("Milestones");
    expect(screen.queryByRole("button", { name: "Submit rating" })).toBeNull();
  });

  it("does not offer a rating to a wallet that is not a participant", async () => {
    h.wallet.publicKey = "GSTRANGER";
    render(<JobDetail />);

    await screen.findByText("Milestones");
    expect(screen.queryByRole("button", { name: "Submit rating" })).toBeNull();
  });
});

describe("JobDetail dispute timelock", () => {
  it("disables the reclaim before the deadline and shows the time remaining", async () => {
    h.escrow.getEscrow.mockResolvedValue(DISPUTED);
    h.escrow.getDisputeDeadline.mockResolvedValue(BigInt(nowSeconds() + 3 * 86_400));

    render(<JobDetail />);

    const button = await screen.findByRole("button", { name: "Reclaim after timeout" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Reclaimable only after/i)).toBeTruthy();
    expect(screen.getByText(/left\)/i)).toBeTruthy();
    expect(h.escrow.reclaimDisputed).not.toHaveBeenCalled();
  });

  it("enables the reclaim for the client once the deadline passes and submits it", async () => {
    h.escrow.getEscrow.mockResolvedValue(DISPUTED);
    h.escrow.getDisputeDeadline.mockResolvedValue(BigInt(nowSeconds() - 10));

    render(<JobDetail />);

    const button = await screen.findByRole("button", { name: "Reclaim after timeout" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/timelock has passed/i)).toBeTruthy();

    fireEvent.click(button);

    await waitFor(() => expect(h.escrow.reclaimDisputed).toHaveBeenCalledWith(7n));
    // The transaction is linked on the explorer like every other write.
    const tx = await screen.findByRole("link", { name: /RECLAIM/ });
    expect(tx.getAttribute("href")).toBe("https://stellar.expert/tx/RECLAIMHASH");
  });

  it("shows the frozen notice but no reclaim action to a non-client", async () => {
    h.wallet.publicKey = FREELANCER;
    h.escrow.getEscrow.mockResolvedValue(DISPUTED);
    h.escrow.getDisputeDeadline.mockResolvedValue(BigInt(nowSeconds() - 10));

    render(<JobDetail />);

    await screen.findByText(/frozen pending arbitration/i);
    expect(screen.queryByRole("button", { name: "Reclaim after timeout" })).toBeNull();
  });
});
