/**
 * api.ts
 *
 * Minimal client for the backend REST API. Only the endpoints the frontend
 * needs; `VITE_API_URL` configures the base URL (default localhost:3000).
 *
 * Contributor Notes:
 * - The backend indexer is still a stub, so jobs appear here only once created
 *   through the API — that is expected for now.
 * - `totalAmountUsdc`/`escrowId` come from Prisma and may serialize as strings.
 * - `authenticate` caches the JWT it gets back, per address: signing the
 *   challenge prompts the wallet, and the messaging view would otherwise prompt
 *   on every unread refresh. See the comment on the cache below.
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/**
 * How long a token from `authenticate` is reused.
 *
 * Deliberately under the server's 7-day JWT expiry, so a cached token is never
 * presented after the server has stopped accepting it.
 */
const TOKEN_TTL_MS = 6 * 24 * 60 * 60 * 1000;

/** Signed-in sessions, keyed by Stellar address. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
/** In-flight challenges, so two components mounting together share one prompt. */
const pendingAuth = new Map<string, Promise<string>>();

/** Drop a cached token (all addresses when called with none). */
export function clearAuthToken(address?: string): void {
  if (address === undefined) tokenCache.clear();
  else tokenCache.delete(address);
}

export interface JobListQuery {
  status?: string;
  client?: string;
  freelancer?: string;
  page?: number;
  limit?: number;
}

/** Build the `/api/jobs` query string, omitting empty filters. */
export function buildJobsQuery(query: JobListQuery = {}): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.client) params.set("client", query.client);
  if (query.freelancer) params.set("freelancer", query.freelancer);
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface JobApi {
  id: string;
  /** On-chain escrow id, present only once the job has been funded on-chain. */
  escrowId: string | number | null;
  title: string;
  status: string;
  /** Asset symbol the job pays in (see lib/assets.ts). */
  asset?: string;
  totalAmountUsdc: string | number;
  client?: { stellarAddress: string; displayName?: string | null } | null;
  freelancer?: { stellarAddress: string } | null;
}

/** Fetch a page of jobs. Throws on a non-2xx response. */
export async function fetchJobs(
  query: JobListQuery = {},
  signal?: AbortSignal,
): Promise<JobApi[]> {
  const res = await fetch(`${API_BASE_URL}/api/jobs${buildJobsQuery(query)}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Could not load jobs (HTTP ${res.status})`);
  return (await res.json()) as JobApi[];
}

// ---------------------------------------------------------------------------
// Authenticated writes
// ---------------------------------------------------------------------------

export interface CreateJobMilestoneInput {
  description?: string;
  /**
   * Whole units of the job asset. A decimal string is exact and preferred; a
   * number is accepted but is already a binary float by the time it arrives.
   */
  amountUsdc: number | string;
  deadline?: string;
}

export interface CreateJobInput {
  title: string;
  description: string;
  /** Asset symbol the job pays in; the backend stores it on the job. */
  asset: string;
  milestones: CreateJobMilestoneInput[];
  expiresAt?: string;
}

/**
 * Complete the wallet challenge-response flow and return a bearer token.
 * `signMessage` signs the challenge nonce per SEP-53 (see Freighter).
 *
 * The token is cached per address and reused for `TOKEN_TTL_MS`, because every
 * signature is a wallet prompt: without this, a page that refreshes an
 * authenticated read would ask the user to sign each time. Concurrent callers
 * that miss the cache share a single in-flight challenge for the same reason.
 * Pass `{ fresh: true }` to force a new challenge (e.g. after a 401).
 */
export async function authenticate(
  address: string,
  signMessage: (message: string) => Promise<string>,
  options: { fresh?: boolean } = {},
): Promise<string> {
  if (!options.fresh) {
    const cached = tokenCache.get(address);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const inflight = pendingAuth.get(address);
    if (inflight) return inflight;
  }

  const challenge = (async () => {
    const challengeRes = await fetch(
      `${API_BASE_URL}/api/users/challenge?address=${encodeURIComponent(address)}`,
    );
    if (!challengeRes.ok) {
      throw new Error(`Could not get an auth challenge (HTTP ${challengeRes.status})`);
    }
    const { nonce } = (await challengeRes.json()) as { nonce: string };

    const signature = await signMessage(nonce);
    const authRes = await fetch(`${API_BASE_URL}/api/users/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature, nonce }),
    });
    if (!authRes.ok) throw new Error(`Authentication failed (HTTP ${authRes.status})`);
    const { token } = (await authRes.json()) as { token: string };
    tokenCache.set(address, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
    return token;
  })();

  pendingAuth.set(address, challenge);
  try {
    return await challenge;
  } finally {
    pendingAuth.delete(address);
  }
}

/** Create the off-chain job record (requires a token from `authenticate`). */
export async function createJob(input: CreateJobInput, token: string): Promise<JobApi> {
  const res = await fetch(`${API_BASE_URL}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Could not save the job (HTTP ${res.status})`);
  return (await res.json()) as JobApi;
}

/** Attach the on-chain escrow id to an existing job record. */
export async function linkEscrowId(
  jobId: string,
  escrowId: number,
  token: string,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/escrow/sync/${jobId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ escrowId }),
  });
  if (!res.ok) throw new Error(`Could not link the escrow (HTTP ${res.status})`);
}

export interface SubmitRatingInput {
  /** Off-chain job id — the API keys the rating on this, not the escrow id. */
  jobId: string;
  rateeAddress: string;
  score: number;
  comment?: string;
}

export interface SubmittedRating {
  id: string;
  jobId: string;
  score: number;
  comment: string | null;
}

/**
 * Record a rating off-chain and receive the server-built `reputation.submit`
 * transaction.
 *
 * The server keys the row on `(rater, job)` — the same key the indexer uses for
 * the `rated` event — so the two converge instead of duplicating.
 *
 * The returned `xdr` is not used by the app: the rating is submitted through
 * `useEscrow.submitRating`, which encodes the arguments itself (`scU32` score),
 * so the on-chain call is correct regardless of the API's builder. This client
 * is for the off-chain record (the contract stores no comment) and for
 * API-first integrators.
 */
export async function submitRating(
  input: SubmitRatingInput,
  token: string,
): Promise<{ rating: SubmittedRating; xdr: string }> {
  const res = await fetch(`${API_BASE_URL}/api/reputation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Could not record the rating (HTTP ${res.status})`);
  return (await res.json()) as { rating: SubmittedRating; xdr: string };
}

export interface DisputeApi {
  id: string;
  jobId: string;
  /** Set once `dispute.raise` has confirmed (see `linkDisputeId`). */
  onChainId: string | number | null;
  status: string;
  reason: string;
}

/**
 * Record a dispute off-chain and receive the server-built `escrow.open_dispute`
 * transaction.
 *
 * The row is written before either transaction runs because the `raised` event
 * carries no reason: this row is the only place the reason the panel reads is
 * kept. Keyed on the job, so calling it twice (both parties may) returns the
 * same dispute instead of a second one.
 *
 * As with `submitRating`, the returned `xdr` is not what the app submits —
 * `useEscrow.openDispute` encodes `open_dispute` itself, so the on-chain call
 * does not depend on the API's builder. This is the off-chain record, and what
 * API-first integrators follow.
 */
export async function createDispute(
  input: { jobId: string; reason: string },
  token: string,
): Promise<{ dispute: DisputeApi; xdr: string }> {
  const res = await fetch(`${API_BASE_URL}/api/disputes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Could not record the dispute (HTTP ${res.status})`);
  return (await res.json()) as { dispute: DisputeApi; xdr: string };
}

/**
 * Attach the on-chain dispute id that `dispute.raise` returned to the row.
 *
 * Without this the id only arrives when the indexer next sees the `raised`
 * event, and `POST /api/disputes/:id/resolve` refuses until then. The indexer
 * writes the same field on the same row, so this is a head start, not a second
 * source of truth.
 */
export async function linkDisputeId(
  disputeId: string,
  onChainId: number | bigint,
  token: string,
): Promise<DisputeApi> {
  const res = await fetch(`${API_BASE_URL}/api/disputes/${disputeId}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ onChainId: Number(onChainId) }),
  });
  if (!res.ok) throw new Error(`Could not record the dispute id (HTTP ${res.status})`);
  return (await res.json()) as DisputeApi;
}

// ---------------------------------------------------------------------------
// Messaging (issue #64)
// ---------------------------------------------------------------------------

/**
 * A job-scoped message. `jobId` is the off-chain job id, not the escrow id, and
 * `sender` is included by the conversation endpoint so the view can tell the two
 * parties apart without a second lookup.
 */
export interface MessageApi {
  id: string;
  jobId: string;
  senderId: string;
  body: string;
  createdAt: string;
  /** Set once the recipient has read it; `null` means unread. */
  readAt: string | null;
  sender?: { stellarAddress: string; displayName?: string | null };
}

/** Unread counts for the authenticated user: a total, and one per job. */
export interface UnreadCounts {
  total: number;
  byJob: { jobId: string; count: number }[];
}

/**
 * Read a job's conversation. Only the job's two participants may call this; a
 * third party gets a 403 from the API.
 */
export async function fetchMessages(jobId: string, token: string): Promise<MessageApi[]> {
  const res = await fetch(`${API_BASE_URL}/api/messages/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not load the conversation (HTTP ${res.status})`);
  return (await res.json()) as MessageApi[];
}

/** Send a message to the job's other participant. */
export async function sendMessage(
  jobId: string,
  body: string,
  token: string,
): Promise<MessageApi> {
  const res = await fetch(`${API_BASE_URL}/api/messages/${encodeURIComponent(jobId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Could not send the message (HTTP ${res.status})`);
  return (await res.json()) as MessageApi;
}

/** Mark the other party's messages in this job read; returns how many changed. */
export async function markMessagesRead(jobId: string, token: string): Promise<number> {
  const res = await fetch(
    `${API_BASE_URL}/api/messages/${encodeURIComponent(jobId)}/read`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Could not update read state (HTTP ${res.status})`);
  const { markedRead } = (await res.json()) as { markedRead: number };
  return markedRead;
}

/** Total unread messages, plus one count per job, for the authenticated user. */
export async function fetchUnreadCounts(token: string): Promise<UnreadCounts> {
  const res = await fetch(`${API_BASE_URL}/api/messages/unread`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not load unread counts (HTTP ${res.status})`);
  return (await res.json()) as UnreadCounts;
}
