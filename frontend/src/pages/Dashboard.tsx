/**
 * Dashboard.tsx
 *
 * Landing page: connect the wallet, browse the job list, and open a job by
 * its on-chain id. The list comes from `GET /api/jobs`, and the connected
 * wallet's milestone reminders from `GET /api/users/:address/reminders`.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import AddressField from "../components/AddressField";
import { fetchJobs, fetchReminders, type JobApi, type ReminderApi } from "../lib/api";
import { useWallet } from "../hooks/wallet-context";
import { formatDate, formatRemaining } from "../lib/time";

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

  // Milestone due-date reminders for the connected wallet (issue #74). The
  // server decides what is due; this only presents it.
  const [reminders, setReminders] = useState<ReminderApi[]>([]);

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

  useEffect(() => {
    if (!publicKey) {
      setReminders([]);
      return;
    }
    const controller = new AbortController();
    // A failed reminder read must not replace the job list's error state with
    // its own; reminders are a convenience, and the list already reports.
    void fetchReminders(publicKey, controller.signal)
      .then(setReminders)
      .catch(() => {
        if (!controller.signal.aborted) setReminders([]);
      });
    return () => controller.abort();
  }, [publicKey]);

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
        <p role="alert" className="alert alert-error">
          {walletError}
        </p>
      )}

      {publicKey && reminders.length > 0 && (
        <section className="reminders">
          <h2>Milestone reminders</h2>
          <ul>
            {reminders.map((reminder) => (
              <li key={`${reminder.jobId}:${reminder.milestoneIndex}`}>
                <span
                  className={
                    reminder.kind === "overdue"
                      ? "badge badge-overdue"
                      : "badge badge-due-soon"
                  }
                >
                  {reminder.kind === "overdue" ? "Overdue" : "Due soon"}
                </span>{" "}
                {reminder.escrowId ? (
                  <Link to={`/jobs/${reminder.escrowId}`}>{reminder.title}</Link>
                ) : (
                  <strong>{reminder.title}</strong>
                )}{" "}
                — milestone {reminder.milestoneIndex + 1}
                {reminder.description ? ` (${reminder.description})` : ""} due{" "}
                <time dateTime={reminder.deadline}>{formatDate(reminder.deadline)}</time>
                {reminder.kind === "overdue"
                  ? " — overdue"
                  : ` — in ${formatRemaining(
                      Math.max(
                        0,
                        Math.floor(
                          (new Date(reminder.deadline).getTime() - Date.now()) / 1000,
                        ),
                      ),
                    )}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (jobId.trim()) navigate(`/jobs/${jobId.trim()}`);
        }}
      >
        <label>
          Open a job by on-chain id{" "}
          <input
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            placeholder="0"
          />
        </label>{" "}
        <button type="submit">Open</button>
      </form>

      <h2>All jobs</h2>

      <label>
        Filter by status{" "}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {jobsError && (
        <p role="alert" className="alert alert-error">
          {jobsError}
        </p>
      )}

      {jobsLoading && jobs.length === 0 && <p>Loading jobs…</p>}

      {!jobsLoading && !jobsError && jobs.length === 0 && (
        <p className="muted">No jobs found.</p>
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
