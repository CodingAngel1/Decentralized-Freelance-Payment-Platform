/**
 * useUnread.ts
 *
 * Unread message counts for the connected wallet: a total, and one count per
 * job. The nav badge reads the total and the dashboard reads `byJob`.
 *
 * The counts are authenticated (only the two participants of a job may learn
 * anything about its messages), so this uses the same challenge-response login
 * as the write paths — `authenticate` caches the token, so mounting the badge
 * and the list together prompts the wallet at most once.
 */

import { useCallback, useEffect, useState } from "react";
import { authenticate, fetchUnreadCounts, type UnreadCounts } from "../lib/api";
import { useWallet } from "./wallet-context";

const EMPTY: UnreadCounts = { total: 0, byJob: [] };

/** Unread message count for the connected address. */
export function useUnread() {
  const { publicKey, signMessage } = useWallet();
  const [counts, setCounts] = useState<UnreadCounts>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setCounts(EMPTY);
      return;
    }
    try {
      const token = await authenticate(publicKey, signMessage);
      setCounts(await fetchUnreadCounts(token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [publicKey, signMessage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { total: counts.total, byJob: counts.byJob, error, refresh };
}
