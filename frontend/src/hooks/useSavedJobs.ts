/**
 * useSavedJobs.ts
 *
 * The connected wallet's job bookmarks (issue #71).
 *
 * Bookmarking is per user and lives in the database, so the list is
 * authenticated: this signs in once per mount when a wallet is connected. The
 * toggle updates local state from the server's answer rather than refetching,
 * so clicking save does not reorder or flash the list.
 *
 * Contributor Notes:
 * - `toggle` takes the whole job rather than an id, so unsaving needs nothing
 *   and saving can add the row optimistically without a second fetch.
 * - A failure leaves the list untouched and reports through `error`; the toggle
 *   never half-applies.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { authenticate, fetchSavedJobs, saveJob, unsaveJob, type JobApi } from "../lib/api";
import { useWallet } from "./wallet-context";

export function useSavedJobs() {
  const { publicKey, signMessage } = useWallet();
  const [savedJobs, setSavedJobs] = useState<JobApi[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The job id with a save/unsave in flight, so only that row locks. */
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setSavedJobs([]);
      setError(null);
      return;
    }
    try {
      const token = await authenticate(publicKey, signMessage);
      setSavedJobs(await fetchSavedJobs(token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [publicKey, signMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savedIds = useMemo(() => new Set(savedJobs.map((job) => job.id)), [savedJobs]);

  const toggle = useCallback(
    async (job: JobApi) => {
      if (!publicKey) return;
      const alreadySaved = savedIds.has(job.id);
      setPendingId(job.id);
      setError(null);
      try {
        const token = await authenticate(publicKey, signMessage);
        if (alreadySaved) {
          await unsaveJob(job.id, token);
          setSavedJobs((prev) => prev.filter((entry) => entry.id !== job.id));
        } else {
          await saveJob(job.id, token);
          // Newest first, matching the API's ordering.
          setSavedJobs((prev) => [job, ...prev.filter((entry) => entry.id !== job.id)]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPendingId(null);
      }
    },
    [publicKey, savedIds, signMessage],
  );

  return {
    savedJobs,
    /** Is this job bookmarked by the connected wallet? */
    isSaved: (jobId: string) => savedIds.has(jobId),
    toggle,
    pendingId,
    error,
    refresh,
  };
}
