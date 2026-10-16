/**
 * Dashboard.tsx
 *
 * Landing page: connect the wallet, browse the job list, and open a job by
 * its on-chain id. The list comes from `GET /api/jobs`.
 *
 * The list can be narrowed by status and by skill tag (issue #70); the tag is
 * sent as `?tag=<slug>` and both filters are applied by the API, so pagination
 * stays correct instead of filtering a page client-side.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import AddressField from "../components/AddressField";
import { fetchJobs, type JobApi } from "../lib/api";
import { SKILL_TAGS, tagLabel } from "../lib/tags";
import { useWallet } from "../hooks/wallet-context";

const PAGE_SIZE = 10;
const STATUSES = ["CREATED", "FUNDED", "ACTIVE", "COMPLETED", "DISPUTED", "REFUNDED"];

export default function Dashboard() {
  const { publicKey, connecting, connect, error: walletError } = useWallet();
  const [jobId, setJobId] = useState("");
  const navigate = useNavigate();

  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
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
