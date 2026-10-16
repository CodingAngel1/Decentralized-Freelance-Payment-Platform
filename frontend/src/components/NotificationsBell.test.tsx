import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import NotificationsBell from "./NotificationsBell";
import * as api from "../lib/api";

const mockWallet = {
  publicKey: "GBTESTUSER11111111111111111111111111111111111111111111111",
  signMessage: vi.fn(async () => "sig_123"),
};

vi.mock("../hooks/wallet-context", () => ({
  useWallet: () => mockWallet,
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    authenticate: vi.fn(async () => "token_abc"),
    fetchNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  };
});

describe("NotificationsBell component (#66)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockWallet.publicKey = "GBTESTUSER11111111111111111111111111111111111111111111111";
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when wallet is disconnected", () => {
    mockWallet.publicKey = null as unknown as string;
    const { container } = render(
      <BrowserRouter>
        <NotificationsBell />
      </BrowserRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders bell and displays unread count badge when there are unread notifications", async () => {
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      notifications: [
        {
          id: "notif-1",
          userId: "u1",
          jobId: "job-10",
          type: "FUNDED",
          title: "Escrow Funded",
          message: "Job escrow has been funded.",
          read: false,
          createdAt: "2026-10-16T12:00:00.000Z",
        },
      ],
      unreadCount: 1,
    });

    render(
      <BrowserRouter>
        <NotificationsBell />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("1")).toBeTruthy();
    });

    const bellBtn = screen.getByRole("button", { name: /Notifications/ });
    expect(bellBtn).toBeTruthy();
    expect(bellBtn.getAttribute("aria-label")).toContain("1 unread");
  });

  it("opens dropdown and displays notification details on click", async () => {
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      notifications: [
        {
          id: "notif-1",
          userId: "u1",
          jobId: "job-10",
          type: "FUNDED",
          title: "Escrow Funded",
          message: "Job escrow has been funded.",
          read: false,
          createdAt: "2026-10-16T12:00:00.000Z",
        },
      ],
      unreadCount: 1,
    });

    render(
      <BrowserRouter>
        <NotificationsBell />
      </BrowserRouter>,
    );

    const bellBtn = await screen.findByRole("button", { name: /Notifications/ });
    fireEvent.click(bellBtn);

    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.getByText("Escrow Funded")).toBeTruthy();
    expect(screen.getByText("Job escrow has been funded.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Job →" })).toBeTruthy();
  });

  it("marks a notification as read when clicking read button", async () => {
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      notifications: [
        {
          id: "notif-1",
          userId: "u1",
          jobId: "job-10",
          type: "RELEASED",
          title: "Milestone Released",
          message: "Milestone 1 released.",
          read: false,
          createdAt: "2026-10-16T12:00:00.000Z",
        },
      ],
      unreadCount: 1,
    });
    vi.mocked(api.markNotificationRead).mockResolvedValue({
      id: "notif-1",
      userId: "u1",
      jobId: "job-10",
      type: "RELEASED",
      title: "Milestone Released",
      message: "Milestone 1 released.",
      read: true,
      createdAt: "2026-10-16T12:00:00.000Z",
    });

    render(
      <BrowserRouter>
        <NotificationsBell />
      </BrowserRouter>,
    );

    const bellBtn = await screen.findByRole("button", { name: /Notifications/ });
    fireEvent.click(bellBtn);

    const readBtn = screen.getByRole("button", { name: "Mark as read" });
    fireEvent.click(readBtn);

    await waitFor(() => {
      expect(api.markNotificationRead).toHaveBeenCalledWith("token_abc", "notif-1");
      expect(screen.queryByText("1")).toBeNull();
    });
  });

  it("marks all notifications as read", async () => {
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      notifications: [
        {
          id: "notif-1",
          userId: "u1",
          jobId: "job-10",
          type: "DISPUTED",
          title: "Dispute Opened",
          message: "Dispute opened.",
          read: false,
          createdAt: "2026-10-16T12:00:00.000Z",
        },
      ],
      unreadCount: 1,
    });
    vi.mocked(api.markAllNotificationsRead).mockResolvedValue();

    render(
      <BrowserRouter>
        <NotificationsBell />
      </BrowserRouter>,
    );

    const bellBtn = await screen.findByRole("button", { name: /Notifications/ });
    fireEvent.click(bellBtn);

    const markAllBtn = screen.getByRole("button", { name: "Mark all as read" });
    fireEvent.click(markAllBtn);

    await waitFor(() => {
      expect(api.markAllNotificationsRead).toHaveBeenCalledWith("token_abc");
      expect(screen.queryByText("Mark all as read")).toBeNull();
    });
  });
});
