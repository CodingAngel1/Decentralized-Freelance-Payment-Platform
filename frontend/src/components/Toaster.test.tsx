/**
 * Toaster.test.tsx
 *
 * The rendering half of issue #60: a transaction toast must be visible, must
 * advance through its stages in place, must link a confirmed transaction to
 * stellar.expert, and must surface a failure as an alert.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ToastProvider } from "../hooks/ToastProvider";
import { useToasts, type ToastContextValue } from "../hooks/toast-context";
import Toaster from "./Toaster";

// The real module pulls in the Stellar SDK for network config; only the URL
// helper is used here.
vi.mock("../lib/stellar", () => ({
  explorerTxUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
}));

/**
 * Captures the context API so a test can drive the lifecycle the way a page
 * does, without depending on any particular page.
 */
let api: ToastContextValue | null = null;

function Capture() {
  api = useToasts();
  return null;
}

function renderToaster() {
  return render(
    <ToastProvider>
      <Capture />
      <Toaster />
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  api = null;
});

describe("Toaster", () => {
  it("renders nothing until a transaction starts", () => {
    renderToaster();
    expect(screen.queryByLabelText("Transaction notifications")).toBeNull();
  });

  it("advances one toast through building → signing → confirmed", () => {
    renderToaster();

    let id = "";
    act(() => {
      id = api!.start("Building release milestone transaction…");
    });
    expect(screen.getByText("Building release milestone transaction…")).toBeTruthy();

    act(() => {
      api!.update(id, "signing", "Awaiting signature for release milestone…");
    });
    // The same toast advanced rather than a second one appearing.
    expect(screen.getByText("Awaiting signature for release milestone…")).toBeTruthy();
    expect(screen.queryByText("Building release milestone transaction…")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);

    act(() => {
      api!.update(id, "confirmed", "release milestone confirmed", "abc123");
    });
    expect(screen.getByText("release milestone confirmed")).toBeTruthy();
  });

  it("links a confirmed transaction to stellar.expert", () => {
    renderToaster();

    act(() => {
      const id = api!.start("Building release milestone transaction…");
      api!.update(id, "confirmed", "release milestone confirmed", "abc123");
    });

    const link = screen.getByRole("link", { name: /stellar\.expert/i }) as HTMLAnchorElement;
    expect(link.href).toBe("https://stellar.expert/explorer/testnet/tx/abc123");
  });

  it("shows a failure as an alert carrying the mapped message", () => {
    renderToaster();

    act(() => {
      const id = api!.start("Building release milestone transaction…");
      api!.update(id, "failed", "You're not authorized to perform this action.");
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("You're not authorized to perform this action.");
    // A failed transaction has no hash to link.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("dismisses a toast when the user closes it", () => {
    renderToaster();

    act(() => {
      api!.start("Building release milestone transaction…");
    });

    act(() => {
      screen.getByRole("button", { name: "Dismiss notification" }).click();
    });

    expect(screen.queryByText("Building release milestone transaction…")).toBeNull();
  });
});
