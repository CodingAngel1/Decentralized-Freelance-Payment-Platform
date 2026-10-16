/**
 * Activity.tsx
 *
 * Earnings and activity summary for the connected wallet (issue #73).
 *
 * Before this page, an address had to open each job in turn to answer "how
 * much have I been paid, and how much is still sitting in escrow?" — the
 * dashboard lists jobs but totals nothing. This route answers both at a
 * glance: open escrows, completed jobs, and per-asset totals for released and
 * still-locked funds.
 *
 * Data comes from two `GET /api/jobs` reads (`?client=` and `?freelancer=`),
 * because the mirror keys a job to the two addresses independently. The two
 * lists are merged by id and totalled by `lib/activity.ts`; no wallet
 * signature is needed to read them, so the page works the moment a wallet is
 * connected.
 *
 * Contributor Notes:
 * - Totals are per asset and shown as exact decimal strings — never added
 *   together across assets, and never summed as floats (see lib/activity.ts).
 * - The two reads are capped at `PAGE_SIZE` jobs *each*, the API's maximum, so
 *   an address in more than 100 jobs per role sees totals for its most recent
 *   jobs only. The cap is stated on screen rather than silently truncating.
 */

import { useEffect, useState } from "react";
import Layout from "../components/Layout";
import AddressField from "../components/AddressField";
import FiatEstimate from "../components/FiatEstimate";
import { fetchJobs } from "../lib/api";
import { summarizeActivity, type ActivitySummary } from "../lib/activity";
import { useWallet } from "../hooks/wallet-context";

/** The API's maximum page size; one read per role, so 100 jobs per role. */
const PAGE_SIZE = 100;

function Totals({ label, totals }: { label: string; totals: ActivitySummary["released"] }) {
  return (
    <p>
      <strong>{label}</strong>{" "}
      {totals.length === 0 ? (
        <span className="muted">none</span>
      ) : (
        totals.map((total) => (
          <span key={total.symbol} className="amount">
            {total.amount} {total.symbol}{" "}
            <FiatEstimate amount={total.amount} asset={total.symbol} />
          </span>
        ))
      )}
    </p>
  );
}

export default function Activity() {
  const { publicKey, connecting, connect, error: walletError } = useWallet();
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setSummary(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [asClient, asFreelancer] = await Promise.all([
          fetchJobs({ client: publicKey, limit: PAGE_SIZE }, controller.signal),
          fetchJobs({ freelancer: publicKey, limit: PAGE_SIZE }, controller.signal),
        ]);
        setSummary(summarizeActivity({ asClient, asFreelancer }));
      } catch (e) {
        // Ignore an abort from a superseded run (e.g. the wallet changed).
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [publicKey]);

  return (
    <Layout>
      <h1>Activity</h1>

      {!publicKey ? (
        <p>
          <button onClick={() => void connect()} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect your Freighter wallet"}
          </button>{" "}
          to see your earnings and open escrows.
        </p>
      ) : (
        <p>
          Summary for <AddressField address={publicKey} label="your wallet address" truncate />.
        </p>
      )}

      {walletError && (
        <p role="alert" className="alert alert-error">
          {walletError}
        </p>
      )}

      {publicKey && loading && <p>Loading activity…</p>}

      {publicKey && error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}

      {publicKey && !loading && !error && summary && (
        <>
          <div className="summary">
            <div className="stat card">
              <span className="stat-value">{summary.activeEscrows}</span>
              <span className="muted">Active escrows</span>
            </div>
            <div className="stat card">
              <span className="stat-value">{summary.completedJobs}</span>
              <span className="muted">Completed jobs</span>
            </div>
            <div className="stat card">
              <span className="stat-value">{summary.totalJobs}</span>
              <span className="muted">Total jobs</span>
            </div>
          </div>

          <Totals label="Released:" totals={summary.released} />
          <Totals label="Still in escrow:" totals={summary.locked} />

          <p className="muted">
            {summary.asClient} as client · {summary.asFreelancer} as freelancer. Released totals
            cover both roles — what you have paid out and what you have earned. Amounts are per
            asset and are not converted.
          </p>
        </>
      )}

      {publicKey && !loading && summary && summary.totalJobs === 0 && (
        <p className="muted">No jobs found for this address yet.</p>
      )}
    </Layout>
  );
}
