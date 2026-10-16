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
import {
  authenticate,
  fetchJobs,
  fetchProposals,
  submitProposal,
  assignFreelancer,
  type JobApi,
  type ProposalApi,
} from "../lib/api";
import { useWallet } from "../hooks/wallet-context";

const PAGE_SIZE = 10;
const STATUSES = ["CREATED", "FUNDED", "ACTIVE", "COMPLETED", "DISPUTED", "REFUNDED"];

export default function Dashboard() {
  const { publicKey, connecting, connect, signMessage, error: walletError } = useWallet();
  const [jobId, setJobId] = useState("");
  const navigate = useNavigate();

  const [status, setStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState("");
  const [jobs, setJobs] = useState<JobApi[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  // Proposal application state
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [proposedRate, setProposedRate] = useState("");
  const [proposalSubmitting, setProposalSubmitting] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [proposalSuccess, setProposalSuccess] = useState<string | null>(null);

  // Client applicant review state
  const [viewingApplicantsJobId, setViewingApplicantsJobId] = useState<string | null>(null);
  const [applicants, setApplicants] = useState<Record<string, ProposalApi[]>>({});
  const [loadingApplicants, setLoadingApplicants] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(
    async (pageToLoad: number, append: boolean, signal?: AbortSignal) => {
      setJobsLoading(true);
      setJobsError(null);
      try {
        const data = await fetchJobs(
          {
            status: status || undefined,
            page: pageToLoad,
            limit: PAGE_SIZE,
            ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}),
            ...(sort ? { sort } : {}),
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
    [status, searchQuery, sort],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(1, false, controller.signal);
    return () => controller.abort();
  }, [load]);

  async function handleToggleApplicants(targetJobId: string) {
    if (viewingApplicantsJobId === targetJobId) {
      setViewingApplicantsJobId(null);
      return;
    }
    setViewingApplicantsJobId(targetJobId);
    setActionMessage(null);
    if (!applicants[targetJobId]) {
      setLoadingApplicants(true);
      try {
        const list = await fetchProposals(targetJobId);
        setApplicants((prev) => ({ ...prev, [targetJobId]: list }));
      } catch (err) {
        setActionMessage(err instanceof Error ? err.message : "Failed to load proposals");
      } finally {
        setLoadingApplicants(false);
      }
    }
  }

  async function handleApply(e: React.FormEvent, targetJobId: string) {
    e.preventDefault();
    if (!publicKey) {
      await connect();
      return;
    }
    setProposalSubmitting(true);
    setProposalError(null);
    setProposalSuccess(null);
    try {
      const token = await authenticate(publicKey, signMessage);
      await submitProposal(
        targetJobId,
        {
          coverLetter: coverLetter.trim() || undefined,
          proposedRate: proposedRate.trim() ? proposedRate.trim() : undefined,
        },
        token,
      );
      setProposalSuccess("Application submitted successfully!");
      setCoverLetter("");
      setProposedRate("");
      setTimeout(() => {
        setApplyingJobId(null);
        setProposalSuccess(null);
      }, 2000);
    } catch (err) {
      setProposalError(err instanceof Error ? err.message : "Failed to submit proposal");
    } finally {
      setProposalSubmitting(false);
    }
  }

  async function handleAssign(targetJobId: string, freelancerAddress: string) {
    if (!publicKey) return;
    setAssigning(true);
    setActionMessage(null);
    try {
      const token = await authenticate(publicKey, signMessage);
      await assignFreelancer(targetJobId, freelancerAddress, token);
      setActionMessage(`Freelancer assigned successfully!`);
      // Refresh proposals and job list
      const updatedList = await fetchProposals(targetJobId);
      setApplicants((prev) => ({ ...prev, [targetJobId]: updatedList }));
      void load(1, false);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Failed to assign freelancer");
    } finally {
      setAssigning(false);
    }
  }

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

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center", margin: "1rem 0" }}>
        <label>
          Search jobs{" "}
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search keyword…"
          />
        </label>

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

        <label>
          Sort by{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="">Newest first (default)</option>
            <option value="oldest">Oldest first</option>
            <option value="amount_desc">Highest amount</option>
            <option value="amount_asc">Lowest amount</option>
          </select>
        </label>
      </div>

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
          {jobs.map((job) => {
            const isClient = !!publicKey && job.client?.stellarAddress === publicKey;
            const isOpen = job.status === "CREATED" && !job.freelancer;

            return (
              <li key={job.id} style={{ marginBottom: "1rem" }}>
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
                {job.escrowId === null || job.escrowId === undefined ? (
                  <> · <Link to={`/jobs/${job.id}`}>View job details</Link></>
                ) : null}

                {/* Apply action on open jobs for freelancers */}
                {isOpen && !isClient && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <button
                      className="btn-primary"
                      onClick={() => {
                        setApplyingJobId(applyingJobId === job.id ? null : job.id);
                        setProposalError(null);
                        setProposalSuccess(null);
                      }}
                    >
                      {applyingJobId === job.id ? "Cancel Application" : "Apply"}
                    </button>

                    {applyingJobId === job.id && (
                      <form
                        onSubmit={(e) => void handleApply(e, job.id)}
                        style={{
                          marginTop: "0.5rem",
                          padding: "0.75rem",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                        }}
                      >
                        <h4>Apply for {job.title}</h4>
                        <p>
                          <label>
                            Cover Letter
                            <br />
                            <textarea
                              value={coverLetter}
                              onChange={(e) => setCoverLetter(e.target.value)}
                              placeholder="Describe your qualifications and experience…"
                              minLength={5}
                              rows={3}
                              style={{ width: "100%" }}
                              required
                            />
                          </label>
                        </p>
                        <p>
                          <label>
                            Proposed Rate ({job.asset ?? "USDC"}) (optional)
                            <br />
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={proposedRate}
                              onChange={(e) => setProposedRate(e.target.value)}
                              placeholder={String(job.totalAmountUsdc)}
                            />
                          </label>
                        </p>
                        {proposalError && (
                          <p role="alert" className="alert alert-error" style={{ marginBottom: "0.5rem" }}>
                            {proposalError}
                          </p>
                        )}
                        {proposalSuccess && (
                          <p className="alert" style={{ marginBottom: "0.5rem" }}>
                            {proposalSuccess}
                          </p>
                        )}
                        <button type="submit" disabled={proposalSubmitting} className="btn-primary">
                          {proposalSubmitting ? "Submitting…" : "Submit Application"}
                        </button>
                      </form>
                    )}
                  </div>
                )}

                {/* View applicants and assign action on open jobs for clients */}
                {isOpen && isClient && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <button onClick={() => void handleToggleApplicants(job.id)}>
                      {viewingApplicantsJobId === job.id ? "Hide Applicants" : "View Applicants"}
                    </button>

                    {viewingApplicantsJobId === job.id && (
                      <div
                        style={{
                          marginTop: "0.5rem",
                          padding: "0.75rem",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius)",
                        }}
                      >
                        <h4>Applicants</h4>
                        {actionMessage && <p className="alert">{actionMessage}</p>}
                        {loadingApplicants && <p>Loading applicants…</p>}
                        {!loadingApplicants &&
                          (!applicants[job.id] || applicants[job.id].length === 0) && (
                            <p className="muted">No proposals submitted yet.</p>
                          )}
                        {!loadingApplicants &&
                          applicants[job.id]?.map((p) => (
                            <div
                              key={p.id}
                              style={{
                                borderBottom: "1px solid var(--border)",
                                padding: "0.5rem 0",
                              }}
                            >
                              <p>
                                <strong>Freelancer:</strong>{" "}
                                {p.freelancer?.stellarAddress ? (
                                  <AddressField
                                    address={p.freelancer.stellarAddress}
                                    label="Freelancer address"
                                    truncate
                                  />
                                ) : (
                                  "—"
                                )}
                              </p>
                              {p.proposedRate && (
                                <p>
                                  <strong>Proposed Rate:</strong> {String(p.proposedRate)}{" "}
                                  {job.asset ?? "USDC"}
                                </p>
                              )}
                              {p.coverLetter && (
                                <p>
                                  <strong>Cover Letter:</strong> {p.coverLetter}
                                </p>
                              )}
                              <p>
                                <strong>Status:</strong>{" "}
                                <span className={`badge badge-${p.status.toLowerCase()}`}>
                                  {p.status}
                                </span>
                              </p>
                              {p.status === "PENDING" && p.freelancer?.stellarAddress && (
                                <button
                                  className="btn-primary"
                                  disabled={assigning}
                                  onClick={() =>
                                    void handleAssign(job.id, p.freelancer!.stellarAddress)
                                  }
                                >
                                  {assigning ? "Assigning…" : "Assign"}
                                </button>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
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
