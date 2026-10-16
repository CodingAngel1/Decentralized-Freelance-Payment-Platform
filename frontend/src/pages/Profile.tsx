/**
 * Profile.tsx
 *
 * Displays a user's on-chain reputation aggregate (total score + count).
 * When viewing their own profile, users can configure email notification
 * preferences for disputes, milestone releases, and refunds (issue #67).
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Layout from "../components/Layout";
import AddressField from "../components/AddressField";
import { useEscrow, type ReputationView } from "../hooks/useEscrow";
import { useWallet } from "../hooks/wallet-context";
import {
  authenticate,
  fetchUserProfile,
  updateUserProfile,
  type UserProfileApi,
} from "../lib/api";

export default function Profile() {
  const { address } = useParams<{ address: string }>();
  const { getReputation, isPending, error } = useEscrow();
  const { publicKey, connect, signMessage } = useWallet();
  const [reputation, setReputation] = useState<ReputationView | null>(null);

  // Notification preferences state
  const isOwner = Boolean(publicKey && address && publicKey === address);
  const [email, setEmail] = useState("");
  const [notifyOnDispute, setNotifyOnDispute] = useState(true);
  const [notifyOnRelease, setNotifyOnRelease] = useState(true);
  const [notifyOnRefund, setNotifyOnRefund] = useState(true);
  const [prefStatus, setPrefStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">(
    "idle",
  );
  const [prefMessage, setPrefMessage] = useState<string | null>(null);

  useEffect(() => {
    if (address) void getReputation(address).then((r) => r && setReputation(r));
  }, [address, getReputation]);

  useEffect(() => {
    if (!isOwner || !address) return;
    let active = true;
    setPrefStatus("loading");
    void fetchUserProfile(address)
      .then((profile: UserProfileApi | null) => {
        if (!active) return;
        if (profile) {
          setEmail(profile.email ?? "");
          setNotifyOnDispute(profile.notifyOnDispute ?? true);
          setNotifyOnRelease(profile.notifyOnRelease ?? true);
          setNotifyOnRefund(profile.notifyOnRefund ?? true);
        }
        setPrefStatus("idle");
      })
      .catch((err) => {
        if (!active) return;
        setPrefStatus("idle");
        console.warn("Could not load off-chain user profile:", err);
      });
    return () => {
      active = false;
    };
  }, [isOwner, address]);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !signMessage) return;
    setPrefStatus("saving");
    setPrefMessage(null);
    try {
      const token = await authenticate(publicKey, signMessage);
      await updateUserProfile(
        {
          email: email.trim() || null,
          notifyOnDispute,
          notifyOnRelease,
          notifyOnRefund,
        },
        token,
      );
      setPrefStatus("saved");
      setPrefMessage("Notification preferences saved successfully.");
    } catch (err) {
      setPrefStatus("error");
      setPrefMessage(err instanceof Error ? err.message : "Failed to save preferences.");
    }
  };

  // Weighted average = total_score / weight; fall back to the raw count for
  // aggregates written before weighting existed.
  const average = !reputation
    ? null
    : reputation.weight > 0n
      ? Number(reputation.total_score) / Number(reputation.weight)
      : reputation.count > 0n
        ? Number(reputation.total_score) / Number(reputation.count)
        : null;

  return (
    <Layout>
      <h1>Profile</h1>
      {address && (
        <p>
          Address: <AddressField address={address} label="profile address" qr />
        </p>
      )}

      {!publicKey && (
        <p>
          <button onClick={() => void connect()}>Connect Freighter</button> to load
          reputation.
        </p>
      )}

      {isPending("reputation") && <p>Loading…</p>}
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}

      {reputation && (
        <p>
          {average === null ? (
            <>No ratings yet.</>
          ) : (
            <>
              Rating: <strong>{average.toFixed(2)} / 5</strong> from{" "}
              {reputation.count.toString()} review(s)
            </>
          )}
        </p>
      )}

      {isOwner && (
        <section
          style={{
            marginTop: "2rem",
            padding: "1.5rem",
            border: "1px solid #334155",
            borderRadius: "8px",
            background: "#0f172a",
          }}
          aria-label="Notification Preferences"
        >
          <h2>Email Notifications</h2>
          <p style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
            Opt-in to receive email notifications for critical escrow events.
          </p>

          <form onSubmit={(e) => void handleSavePreferences(e)}>
            <div style={{ marginBottom: "1rem" }}>
              <label
                htmlFor="user-email"
                style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}
              >
                Email Address
              </label>
              <input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="freelancer@example.com"
                style={{
                  width: "100%",
                  maxWidth: "400px",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid #475569",
                  background: "#1e293b",
                  color: "#f8fafc",
                }}
              />
            </div>

            <fieldset
              style={{
                border: "none",
                padding: 0,
                margin: "1rem 0",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <legend style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                Notify me when:
              </legend>

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  id="notify-dispute"
                  type="checkbox"
                  checked={notifyOnDispute}
                  onChange={(e) => setNotifyOnDispute(e.target.checked)}
                />
                A dispute is opened on one of my jobs
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  id="notify-release"
                  type="checkbox"
                  checked={notifyOnRelease}
                  onChange={(e) => setNotifyOnRelease(e.target.checked)}
                />
                A milestone is released
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  id="notify-refund"
                  type="checkbox"
                  checked={notifyOnRefund}
                  onChange={(e) => setNotifyOnRefund(e.target.checked)}
                />
                An escrow is refunded
              </label>
            </fieldset>

            {prefMessage && (
              <p
                role={prefStatus === "error" ? "alert" : "status"}
                style={{
                  color: prefStatus === "error" ? "#f87171" : "#4ade80",
                  marginBottom: "1rem",
                }}
              >
                {prefMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={prefStatus === "saving"}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: "none",
                background: "#3b82f6",
                color: "#ffffff",
                fontWeight: 600,
                cursor: prefStatus === "saving" ? "not-allowed" : "pointer",
              }}
            >
              {prefStatus === "saving" ? "Saving Preferences…" : "Save Preferences"}
            </button>
          </form>
        </section>
      )}
    </Layout>
  );
}

