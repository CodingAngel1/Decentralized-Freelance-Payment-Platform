import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Hoisted so the vi.mock factories below can reference them.
const h = vi.hoisted(() => ({
  escrow: {
    createAndFund: vi.fn(),
    isPending: vi.fn(() => false),
    error: null as string | null,
  },
  wallet: {
    publicKey: "GCLIENT" as string | null,
    connect: vi.fn(async () => "GCLIENT"),
    connecting: false,
    signMessage: vi.fn(async () => "sig"),
  },
  api: {
    authenticate: vi.fn(),
    createJob: vi.fn(),
    linkEscrowId: vi.fn(),
  },
}));

vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("../hooks/wallet-context", () => ({ useWallet: () => h.wallet }));
vi.mock("../hooks/useEscrow", () => ({ useEscrow: () => h.escrow }));
// Only the addresses/explorer helpers are used here; skip loading the SDK.
vi.mock("../lib/stellar", () => ({
  CONTRACT_ADDRESSES: { escrow: "CESCROW", dispute: "", reputation: "", usdc: "" },
  explorerTxUrl: (hash: string) => `https://stellar.expert/tx/${hash}`,
}));
vi.mock("../lib/api", () => ({
  authenticate: h.api.authenticate,
  createJob: h.api.createJob,
  linkEscrowId: h.api.linkEscrowId,
}));

type Page = React.ComponentType;
let PostJob: Page;

/** Re-import the page so `import.meta.env.VITE_*` stubs take effect. */
async function renderWithEnv(env: Record<string, string>): Promise<void> {
  vi.resetModules();
  vi.stubEnv("VITE_USDC_CONTRACT_ID", "");
  vi.stubEnv("VITE_XLM_CONTRACT_ID", "");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  PostJob = (await import("./PostJob")).default;
  render(<PostJob />);
}

beforeEach(() => {
  h.wallet.publicKey = "GCLIENT";
  h.escrow.isPending.mockReturnValue(false);
  h.escrow.error = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("PostJob asset picker", () => {
  it("disables an asset with no configured SAC and defaults to one that has one", async () => {
    await renderWithEnv({ VITE_XLM_CONTRACT_ID: "CXLM" });

    const select = screen.getByRole("combobox", { name: /Payment asset/i });
    // XLM is configured on this build, so it becomes the default…
    expect((select as HTMLSelectElement).value).toBe("XLM");

    const options = Array.from(select.querySelectorAll("option"));
    const bySymbol = (s: string) =>
      options.find((o) => o.textContent?.startsWith(s)) as HTMLOptionElement;
    // …and USDC is visible but cannot be picked-then-error: it is disabled.
    expect(bySymbol("XLM").disabled).toBe(false);
    expect(bySymbol("USDC").disabled).toBe(true);
    expect(bySymbol("USDC").textContent).toContain("not configured");

    // The configured token is shown and no misconfiguration alert is raised.
    expect(screen.getByText("CXLM")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still blocks and explains when no asset is configured at all", async () => {
    await renderWithEnv({});

    const select = screen.getByRole("combobox", { name: /Payment asset/i }) as HTMLSelectElement;
    expect(select.value).toBe("USDC");
    expect(
      screen.getByText(/No contract configured for USDC/),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Create & Fund Escrow/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

const FREELANCER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Fill in the minimum a client has to provide for the form to submit. */
function fillForm(amount = "2.5"): void {
  fireEvent.change(screen.getByLabelText(/^Title/), {
    target: { value: "Landing page redesign" },
  });
  fireEvent.change(screen.getByLabelText(/Description/), {
    target: { value: "What needs to be delivered by Friday" },
  });
  fireEvent.change(screen.getByLabelText(/Freelancer Stellar address/), {
    target: { value: FREELANCER },
  });
  fireEvent.change(screen.getByLabelText(/Amount #1/), { target: { value: amount } });
}

/** Submit through the form, whatever the button is labelled. */
function submitForm(): void {
  const button = screen.getByRole("button", { name: /Create & Fund Escrow|Connect & Continue/ });
  fireEvent.submit(button.closest("form") as HTMLFormElement);
}

describe("PostJob submission", () => {
  beforeEach(() => {
    h.wallet.publicKey = "GCLIENT";
    h.escrow.createAndFund.mockReset();
    h.escrow.createAndFund.mockResolvedValue({ id: 7n, hash: "CREATEFUNDHASH" });
    h.api.authenticate.mockReset();
    h.api.authenticate.mockResolvedValue("jwt-1");
    h.api.createJob.mockReset();
    h.api.createJob.mockResolvedValue({ id: "job-1" });
    h.api.linkEscrowId.mockReset();
    h.api.linkEscrowId.mockResolvedValue(undefined);
    h.wallet.connect.mockClear();
  });

  it("connects the wallet instead of spending anything when none is connected", async () => {
    h.wallet.publicKey = null;
    await renderWithEnv({ VITE_XLM_CONTRACT_ID: "CXLM" });
    fillForm();

    submitForm();

    await waitFor(() => expect(h.wallet.connect).toHaveBeenCalled());
    // Nothing is built before a wallet exists: the client's funds are at stake.
    expect(h.escrow.createAndFund).not.toHaveBeenCalled();
  });

  it("refuses to create an escrow while a milestone amount is not positive", async () => {
    await renderWithEnv({ VITE_XLM_CONTRACT_ID: "CXLM" });
    fillForm("0");

    submitForm();

    expect(h.escrow.createAndFund).not.toHaveBeenCalled();
  });

  it("creates and funds the escrow, records the job and links the escrow id", async () => {
    await renderWithEnv({ VITE_XLM_CONTRACT_ID: "CXLM" });
    fillForm();

    submitForm();

    await screen.findByText(/Escrow #7 created and funded/);

    // On-chain: the client's address, the chosen SAC, the amounts in base units.
    expect(h.escrow.createAndFund).toHaveBeenCalledWith(
      FREELANCER,
      "CXLM",
      [{ amount: 25_000_000n, deadline: 0n }],
      expect.any(BigInt),
    );

    // Off-chain: the job record carries the asset the job pays in, then the
    // escrow id is linked so the job becomes reachable from the dashboard.
    expect(h.api.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Landing page redesign",
        asset: "XLM",
        milestones: [expect.objectContaining({ amountUsdc: 2.5 })],
      }),
      "jwt-1",
    );
    expect(h.api.linkEscrowId).toHaveBeenCalledWith("job-1", 7, "jwt-1");

    // The transaction and the new escrow are both reachable from the page.
    expect(
      screen.getByRole("link", { name: /CREATEFUND/ }).getAttribute("href"),
    ).toBe("https://stellar.expert/tx/CREATEFUNDHASH");
    expect(screen.getByRole("link", { name: /Open job/ }).getAttribute("href")).toBe("/jobs/7");
  });

  it("says the escrow exists on-chain but was not recorded, and keeps the id", async () => {
    // The dangerous half-failure: the funds are committed but the dashboard has
    // no record, so the user has to be told to keep the escrow id.
    h.api.createJob.mockRejectedValue(new Error("Could not save the job (HTTP 500)"));
    await renderWithEnv({ VITE_XLM_CONTRACT_ID: "CXLM" });
    fillForm();

    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/on-chain escrow created, but the job record was not saved/i);
    expect(alert.textContent).toContain("HTTP 500");
    expect(screen.getByText(/Escrow #7 created and funded/)).toBeTruthy();
    // No escrow id is invented when the record never came back.
    expect(h.api.linkEscrowId).not.toHaveBeenCalled();
  });
});
