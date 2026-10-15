import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
  authenticate: vi.fn(),
  createJob: vi.fn(),
  linkEscrowId: vi.fn(),
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
