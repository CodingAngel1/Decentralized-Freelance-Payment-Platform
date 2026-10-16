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
    signMessage: vi.fn(async () => "mock-signature"),
  },
  api: {
    fetchUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    authenticate: vi.fn(async (..._args: unknown[]) => "test-jwt-token"),
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
  fetchUserProfile: (address: string) => h.api.fetchUserProfile(address),
  updateUserProfile: (input: unknown, token: string) => h.api.updateUserProfile(input, token),
  authenticate: (address: string, signMessage: unknown) =>
    h.api.authenticate(address, signMessage),
}));

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
  h.api.fetchUserProfile.mockReset();
  h.api.fetchUserProfile.mockResolvedValue(null);
  h.api.updateUserProfile.mockReset();
  h.api.updateUserProfile.mockResolvedValue({});
  h.api.authenticate.mockReset();
  h.api.authenticate.mockResolvedValue("test-jwt-token");
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

  it("does not render notification preferences if the connected wallet is not the profile owner", () => {
    h.wallet.publicKey = "GDIFFERENT";
    render(<Profile />);
    expect(screen.queryByLabelText("Notification Preferences")).toBeNull();
    expect(screen.queryByText("Email Notifications")).toBeNull();
  });

  it("renders notification preferences and saves updated preferences for the profile owner", async () => {
    h.wallet.publicKey = ADDRESS;
    h.api.fetchUserProfile.mockResolvedValue({
      id: "u-1",
      stellarAddress: ADDRESS,
      email: "existing@example.com",
      notifyOnDispute: true,
      notifyOnRelease: false,
      notifyOnRefund: true,
    });
    h.api.updateUserProfile.mockResolvedValue({
      id: "u-1",
      stellarAddress: ADDRESS,
      email: "newemail@example.com",
      notifyOnDispute: true,
      notifyOnRelease: true,
      notifyOnRefund: false,
    });

    render(<Profile />);

    // Waits for the form to populate
    const emailInput = await screen.findByLabelText("Email Address");
    expect((emailInput as HTMLInputElement).value).toBe("existing@example.com");

    const disputeCheckbox = screen.getByLabelText(
      "A dispute is opened on one of my jobs",
    ) as HTMLInputElement;
    const releaseCheckbox = screen.getByLabelText("A milestone is released") as HTMLInputElement;
    const refundCheckbox = screen.getByLabelText("An escrow is refunded") as HTMLInputElement;

    expect(disputeCheckbox.checked).toBe(true);
    expect(releaseCheckbox.checked).toBe(false);
    expect(refundCheckbox.checked).toBe(true);

    // Modify form values
    fireEvent.change(emailInput, { target: { value: "newemail@example.com" } });
    fireEvent.click(releaseCheckbox);
    fireEvent.click(refundCheckbox);

    expect(releaseCheckbox.checked).toBe(true);
    expect(refundCheckbox.checked).toBe(false);

    // Submit form
    fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));

    await waitFor(() => {
      expect(h.api.authenticate).toHaveBeenCalledWith(ADDRESS, h.wallet.signMessage);
      expect(h.api.updateUserProfile).toHaveBeenCalledWith(
        {
          email: "newemail@example.com",
          notifyOnDispute: true,
          notifyOnRelease: true,
          notifyOnRefund: false,
        },
        "test-jwt-token",
      );
    });

    expect(
      await screen.findByText("Notification preferences saved successfully."),
    ).toBeTruthy();
  });
});

