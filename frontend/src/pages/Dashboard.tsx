/**
 * Dashboard.tsx
 *
 * Landing page: connect the wallet, browse the job list, and open a job by
 * its on-chain id. The list comes from `GET /api/jobs`.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import AddressField from "../components/AddressField";
import JobListSkeleton from "../components/JobListSkeleton";
import { fetchJobs, type JobApi } from "../lib/api";
import { useWallet } from "../hooks/wallet-context";

const PAGE_SIZE = 10;
const STATUSES = ["CREATED", "FUNDED", "ACTIVE", "COMPLETED", "DISPUTED", "REFUNDED"];

export default function Dashboard() {
  const { publicKey, connecting, connect, error: walletError } = useWallet();
  const [jobId, setJobId] = useState("");
  const navigate = useNavigate();

  const [status, setStatus] = useState("");
  const [jobs, setJobs] = useState<JobApi[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const load = useCallback(
    async (pageToLoad: number, append: boolean, signal?: AbortSignal) => {
      setJobsLoading(true);
      setJobsError(null);
      try {
        const data = await fetchJobs(
          { status: status || undefined, page: pageToLoad, limit: PAGE_SIZE },
          signal,
        );
        setJobs((prev) => (append ? [...prev, ...data] : data));
        setHasMore(data.length === PAGE_SIZE);
        setPage(pageToLoad);
      } catch (e) {
        // Ignore aborts from a superseded request (e.g. fast filter changes).
        if (e instanceof DOMException && e.name === "AbortError") return;
        setJobsError(e instanceof Error ? e.message : String(e));
      } finally {
        setJobsLoading(false);
      }
    },
    [status],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(1, false, controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <Layout>
      <h1>My Jobs</h1>

      {!publicKey ? (
        <p>
          <button onClick={() => void connect()} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect your Freighter wallet"}
          </button>{" "}
          to post or manage jobs.
        </p>
      ) : (
        <p>
          Connected as{" "}
          <AddressField address={publicKey} label="your wallet address" truncate qr />.{" "}
          <Link to={`/profile/${publicKey}`}>View reputation</Link>
        </p>
      )}

      {walletError && (
        <p role="alert" aria-live="assertive" className="alert alert-error">
          {walletError}
        </p>
      )}

      <form
        className="open-job-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (jobId.trim()) navigate(`/jobs/${jobId.trim()}`);
        }}
      >
        <label htmlFor="open-job-input">
          Open a job by on-chain id{" "}
          <input
            id="open-job-input"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            placeholder="0"
          />
        </label>{" "}
        <button type="submit">Open</button>
      </form>

      <h2>All jobs</h2>

      <label htmlFor="filter-status-select">
        Filter by status{" "}
        <select
          id="filter-status-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {jobsError && (
        <div className="error-state">
          <p role="alert" aria-live="assertive" className="alert alert-error">
            {jobsError}
          </p>
          <button
            type="button"
            className="btn-retry"
            onClick={() => void load(page, false)}
          >
            Retry
          </button>
        </div>
      )}

      {jobsLoading && jobs.length === 0 && <JobListSkeleton />}

      {!jobsLoading && !jobsError && jobs.length === 0 && (
        <div className="empty-state card" role="status" aria-live="polite">
          <div className="empty-state-icon" aria-hidden="true">
            📋
          </div>
          <h3>No jobs found.</h3>
          <p className="muted">
            {status
              ? `No jobs match the "${status}" status filter.`
              : "No jobs have been posted yet. Create a new job to get started."}
          </p>
          {status ? (
            <button type="button" onClick={() => setStatus("")}>
              Clear filter
            </button>
          ) : (
            <Link to="/post" className="btn-primary">
              Post a job →
            </Link>
          )}
        </div>
      )}

      {jobs.length > 0 && (
        <ul className="job-list">
          {jobs.map((job) => (
            <li key={job.id}>
              <strong>{job.title}</strong> <StatusBadge status={job.status} />
              <br />
              <span className="muted">
                Client:{" "}
                {job.client?.stellarAddress ? (
                  <AddressField
                    address={job.client.stellarAddress}
                    label="Client address"
                    truncate
                  />
                ) : (
                  "—"
                )}{" "}
                · Total: {String(job.totalAmountUsdc)} {job.asset ?? ""}
              </span>
              <br />
              {job.escrowId !== null && job.escrowId !== undefined ? (
                <Link to={`/jobs/${job.escrowId}`}>Open job #{String(job.escrowId)}</Link>
              ) : (
                <span className="muted">Not funded on-chain yet</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <button
          disabled={jobsLoading}
          onClick={() => void load(page + 1, true)}
        >
          {jobsLoading ? "Loading…" : "Load more"}
        </button>
      )}

      <p>
        <Link to="/post">Post a new job →</Link>
      </p>
    </Layout>
  );
}
