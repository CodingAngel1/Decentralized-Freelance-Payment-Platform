/**
 * Profile.test.tsx
 *
 * The reputation view is read-only, but it is the page a client checks before
 * paying someone, so the three states that matter are: the aggregate, an
 * address nobody has rated yet, and a read that failed. The wallet and the SDK
 * are mocked — reputation is read from the contract, not the network here.
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
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ address: h.address }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("../hooks/wallet-context", () => ({ useWallet: () => h.wallet }));
vi.mock("../hooks/useEscrow", () => ({ useEscrow: () => h.escrow }));

import Profile from "./Profile";

const ADDRESS = h.address;

/** The rendered summary line, whatever markup it is spread across. */
const summary = (text: string) =>
  screen.findByText((_content, element) => element?.textContent === text);

beforeEach(() => {
  h.escrow.getReputation.mockReset();
  // `useEscrow.run` is async, so a real read always resolves — to `undefined`
  // when it fails (the error is surfaced on the hook, not thrown).
  h.escrow.getReputation.mockResolvedValue(undefined);
  h.escrow.isPending.mockReset();
  h.escrow.isPending.mockReturnValue(false);
  h.escrow.error = null;
  h.wallet.publicKey = "GVIEWER";
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
