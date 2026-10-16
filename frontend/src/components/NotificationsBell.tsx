import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../hooks/wallet-context";
import {
  authenticate,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationApi,
} from "../lib/api";

const TOKEN_KEY_PREFIX = "auth_token_";

function getCachedToken(address: string): string | null {
  try {
    return sessionStorage.getItem(`${TOKEN_KEY_PREFIX}${address}`);
  } catch {
    return null;
  }
}

function setCachedToken(address: string, token: string): void {
  try {
    sessionStorage.setItem(`${TOKEN_KEY_PREFIX}${address}`, token);
  } catch {
    // Ignore storage quota or access errors
  }
}

export default function NotificationsBell() {
  const { publicKey, signMessage } = useWallet();
  const [notifications, setNotifications] = useState<NotificationApi[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getValidToken = useCallback(async (): Promise<string | null> => {
    if (!publicKey) return null;
    let token = getCachedToken(publicKey);
    if (!token) {
      try {
        token = await authenticate(publicKey, signMessage);
        setCachedToken(publicKey, token);
      } catch (err) {
        console.warn("Notification auth failed:", err);
        return null;
      }
    }
    return token;
  }, [publicKey, signMessage]);

  const loadNotifications = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getValidToken();
      if (!token) {
        setLoading(false);
        return;
      }
      const data = await fetchNotifications(token);
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [publicKey, getValidToken]);

  useEffect(() => {
    if (publicKey) {
      void loadNotifications();
      // Poll every 15 seconds while connected
      const interval = setInterval(() => {
        void loadNotifications();
      }, 15000);
      return () => clearInterval(interval);
    } else {
      setNotifications([]);
      setUnreadCount(0);
      setIsOpen(false);
    }
  }, [publicKey, loadNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const token = await getValidToken();
    if (!token) return;
    try {
      await markNotificationRead(token, id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.warn("Failed to mark notification read:", err);
    }
  };

  const handleMarkAllRead = async () => {
    const token = await getValidToken();
    if (!token) return;
    try {
      await markAllNotificationsRead(token);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.warn("Failed to mark all notifications read:", err);
    }
  };

  if (!publicKey) return null;

  return (
    <div className="notifications-bell-container" ref={dropdownRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="notifications-bell-btn"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          background: "none",
          border: "1px solid #ccc",
          borderRadius: "4px",
          padding: "4px 8px",
          cursor: "pointer",
          position: "relative",
          marginRight: "8px",
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            className="notifications-badge"
            style={{
              position: "absolute",
              top: "-6px",
              right: "-6px",
              background: "#e53e3e",
              color: "#fff",
              borderRadius: "50%",
              padding: "2px 6px",
              fontSize: "11px",
              fontWeight: "bold",
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="notifications-dropdown"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: "320px",
            maxHeight: "420px",
            overflowY: "auto",
            backgroundColor: "#fff",
            color: "#1a202c",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 1000,
            padding: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: "8px",
              marginBottom: "8px",
            }}
          >
            <strong style={{ fontSize: "14px" }}>Notifications</strong>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                style={{
                  background: "none",
                  border: "none",
                  color: "#3182ce",
                  fontSize: "12px",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Mark all as read
              </button>
            )}
          </div>

          {loading && notifications.length === 0 && (
            <p style={{ margin: "16px 0", textAlign: "center", color: "#718096" }}>
              Loading notifications…
            </p>
          )}

          {error && (
            <p style={{ margin: "8px 0", color: "#e53e3e", fontSize: "12px" }}>{error}</p>
          )}

          {!loading && notifications.length === 0 && (
            <p style={{ margin: "16px 0", textAlign: "center", color: "#718096", fontSize: "13px" }}>
              No notifications yet.
            </p>
          )}

          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {notifications.map((n) => (
              <li
                key={n.id}
                style={{
                  padding: "8px",
                  borderRadius: "6px",
                  marginBottom: "6px",
                  backgroundColor: n.read ? "#f7fafc" : "#ebf8ff",
                  borderLeft: n.read ? "3px solid #cbd5e0" : "3px solid #3182ce",
                  fontSize: "13px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontWeight: n.read ? "normal" : "bold", color: "#2d3748" }}>
                    {n.title}
                  </span>
                  {!n.read && (
                    <button
                      type="button"
                      aria-label="Mark as read"
                      onClick={(e) => void handleMarkAsRead(n.id, e)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#3182ce",
                        fontSize: "11px",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      ✓ Read
                    </button>
                  )}
                </div>
                <p style={{ margin: "4px 0", color: "#4a5568", fontSize: "12px" }}>{n.message}</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <small style={{ color: "#a0aec0", fontSize: "10px" }}>
                    {new Date(n.createdAt).toLocaleDateString()}{" "}
                    {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </small>
                  {n.jobId && (
                    <Link
                      to={`/jobs/${n.jobId}`}
                      onClick={() => setIsOpen(false)}
                      style={{ color: "#3182ce", fontSize: "11px", textDecoration: "none" }}
                    >
                      View Job →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
