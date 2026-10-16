/**
 * Dashboard.tsx
 *
 * Landing page: connect the wallet, browse the job list, and open a job by
 * its on-chain id. The list comes from `GET /api/jobs`.
 *
 * The list can be narrowed by status and by skill tag (issue #70); the tag is
 * sent as `?tag=<slug>` and both filters are applied by the API, so pagination
 * stays correct instead of filtering a page client-side.
 *
 * A connected wallet can also bookmark a job (issue #71). "Saved only" swaps
 * the rendered list for the bookmark list, which is already complete, so the
 * pagination control is hidden while it is on.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import AddressField from "../components/AddressField";
import FiatEstimate from "../components/FiatEstimate";
import { fetchJobs, type JobApi } from "../lib/api";
import { SKILL_TAGS, tagLabel } from "../lib/tags";
import { useSavedJobs } from "../hooks/useSavedJobs";
import { useWallet } from "../hooks/wallet-context";
import { parseEscrowId } from "../lib/escrowId";

const PAGE_SIZE = 10;
const STATUSES = ["CREATED", "FUNDED", "ACTIVE", "COMPLETED", "DISPUTED", "REFUNDED"];

export default function Dashboard() {
  const { publicKey, connecting, connect, error: walletError } = useWallet();
  // Per-job unread counts, so a job with a new message is visible from the list
  // without opening it (issue #64).
  const { byJob } = useUnread();
  const [jobId, setJobId] = useState("");
  const [jobIdError, setJobIdError] = useState<string | null>(null);
  const navigate = useNavigate();

  const unreadFor = (id: string) => byJob.find((entry) => entry.jobId === id)?.count ?? 0;

  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const { savedJobs, isSaved, toggle, pendingId, error: savedError } = useSavedJobs();
  const [jobs, setJobs] = useState<JobApi[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  // What actually renders: the bookmark list when "Saved only" is on (it is
  // returned complete), otherwise the paginated API list.
  const visibleJobs = savedOnly ? savedJobs : jobs;

  const load = useCallback(
    async (pageToLoad: number, append: boolean, signal?: AbortSignal) => {
      setJobsLoading(true);
      setJobsError(null);
      try {
        const data = await fetchJobs(
          {
            status: status || undefined,
            tag: tag || undefined,
            page: pageToLoad,
            limit: PAGE_SIZE,
          },
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
    [status, tag],
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
        <p role="alert" aria-live="assertive" className="alert alert-error">
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
        className="open-job-form"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = jobId.trim();
          if (!trimmed) return;
          const parsed = parseEscrowId(trimmed);
          if (parsed === null) {
            setJobIdError(`"${trimmed}" is not a valid escrow id. Enter a non-negative integer.`);
            return;
          }
          setJobIdError(null);
          navigate(`/jobs/${trimmed}`);
        }}
      >
        <label htmlFor="open-job-input">
          Open a job by on-chain id{" "}
          <input
            id="open-job-input"
            value={jobId}
            onChange={(e) => {
              setJobId(e.target.value);
              setJobIdError(null);
            }}
            placeholder="0"
          />
        </label>{" "}
        <button type="submit">Open</button>
        {jobIdError && (
          <p role="alert" className="alert alert-error">
            {jobIdError}
          </p>
        )}
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
      </label>{" "}
      <label>
        Filter by skill{" "}
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All skills</option>
          {SKILL_TAGS.map((skill) => (
            <option key={skill.slug} value={skill.slug}>
              {skill.label}
            </option>
          ))}
        </select>
      </label>{" "}
      {publicKey && (
        <label>
          <input
            type="checkbox"
            checked={savedOnly}
            onChange={(e) => setSavedOnly(e.target.checked)}
          />{" "}
          Saved only ({savedJobs.length})
        </label>
      )}

      {(jobsError || savedError) && (
        <p role="alert" className="alert alert-error">
          {jobsError ?? savedError}
        </p>
      )}

      {jobsLoading && visibleJobs.length === 0 && <p>Loading jobs…</p>}

      {!jobsLoading && !jobsError && visibleJobs.length === 0 && (
        <p className="muted">
          {savedOnly ? "No saved jobs yet." : "No jobs found."}
        </p>
      )}

      {visibleJobs.length > 0 && (
        <ul className="job-list">
          {visibleJobs.map((job) => (
            <li key={job.id}>
              <strong>{job.title}</strong> <StatusBadge status={job.status} />
              {job.tags && job.tags.length > 0 && (
                <>
                  {" "}
                  {job.tags.map((slug) => (
                    <span key={slug} className="tag">
                      {tagLabel(slug)}
                    </span>
                  ))}
                </>
              )}
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
                · Total: {String(job.totalAmountUsdc)} {job.asset ?? ""}{" "}
                <FiatEstimate amount={String(job.totalAmountUsdc)} asset={job.asset ?? ""} />
              </span>
              <br />
              {job.escrowId !== null && job.escrowId !== undefined ? (
                <Link to={`/jobs/${job.escrowId}`}>Open job #{String(job.escrowId)}</Link>
              ) : (
                <span className="muted">Not funded on-chain yet</span>
              )}
              {publicKey && (
                <>
                  {" "}
                  <button
                    type="button"
                    className={isSaved(job.id) ? "btn-saved" : "btn-save"}
                    aria-pressed={isSaved(job.id)}
                    disabled={pendingId === job.id}
                    onClick={() => void toggle(job)}
                  >
                    {isSaved(job.id) ? "Saved" : "Save"}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && !savedOnly && (
        <button
          disabled={jobsLoading}
          onClick={() => void load(page + 1, true)}
        >
          {jobsLoading ? "Loading…" : "Load more"}
        </button>
      )}

      <p>
        <Link to="/post">Post a new job →</Link> ·{" "}
        <Link to="/freelancers">Browse freelancers directory →</Link>
      </p>
    </Layout>
  );
}
