/**
 * useUnread.test.tsx
 *
 * The unread counts that the nav badge and the dashboard list read (issue #64).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  wallet: {
    publicKey: "GCLIENT" as string | null,
    signMessage: vi.fn(async () => "sig"),
  },
  authenticate: vi.fn(async () => "jwt-1"),
  fetchUnreadCounts: vi.fn(),
}));

vi.mock("./wallet-context", () => ({ useWallet: () => h.wallet }));
vi.mock("../lib/api", () => ({
  authenticate: h.authenticate,
  fetchUnreadCounts: h.fetchUnreadCounts,
}));

import { useUnread } from "./useUnread";

beforeEach(() => {
  h.wallet.publicKey = "GCLIENT";
  h.authenticate.mockClear();
  h.fetchUnreadCounts.mockReset();
  h.fetchUnreadCounts.mockResolvedValue({ total: 0, byJob: [] });
});

afterEach(() => cleanup());

describe("useUnread", () => {
  it("loads the total and the per-job counts for the connected wallet", async () => {
    h.fetchUnreadCounts.mockResolvedValue({
      total: 3,
      byJob: [
        { jobId: "job-1", count: 2 },
        { jobId: "job-2", count: 1 },
      ],
    });

    const { result } = renderHook(() => useUnread());

    await waitFor(() => expect(result.current.total).toBe(3));
    expect(result.current.byJob).toEqual([
      { jobId: "job-1", count: 2 },
      { jobId: "job-2", count: 1 },
    ]);
    expect(result.current.error).toBeNull();
    expect(h.authenticate).toHaveBeenCalledWith("GCLIENT", h.wallet.signMessage);
  });

  it("stays silent and asks for nothing while no wallet is connected", async () => {
    h.wallet.publicKey = null;

    const { result } = renderHook(() => useUnread());

    expect(result.current.total).toBe(0);
    expect(result.current.byJob).toEqual([]);
    expect(h.fetchUnreadCounts).not.toHaveBeenCalled();
  });

  it("reports a failed fetch without throwing", async () => {
    h.fetchUnreadCounts.mockRejectedValue(new Error("Could not load unread counts (HTTP 500)"));

    const { result } = renderHook(() => useUnread());

    await waitFor(() => expect(result.current.error).toMatch(/HTTP 500/));
    expect(result.current.total).toBe(0);
  });
});
