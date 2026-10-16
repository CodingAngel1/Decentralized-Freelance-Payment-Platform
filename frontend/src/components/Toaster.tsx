/**
 * Toaster.tsx
 *
 * Renders the active transaction toasts. Mounted once in `App.tsx`, inside the
 * `ToastProvider`, so every page's transactions report through one place.
 *
 * Contributor Notes:
 * - A failed toast is `role="alert"` and the rest are `role="status"`: a screen
 *   reader interrupts for the failure and merely announces the progress update.
 * - Only a confirmed toast has a hash, so only it gets the stellar.expert link.
 */

import { explorerTxUrl } from "../lib/stellar";
import { useToasts } from "../hooks/toast-context";

export default function Toaster() {
  const { toasts, dismiss } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <section className="toaster" aria-label="Transaction notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.status === "failed" ? "alert" : "status"}
          className={`toast toast-${toast.status}`}
        >
          <span className="toast-message">{toast.message}</span>
          {toast.status === "confirmed" && toast.hash && (
            <>
              {" "}
              <a href={explorerTxUrl(toast.hash)} target="_blank" rel="noreferrer" title={toast.hash}>
                View on stellar.expert
              </a>
            </>
          )}
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => dismiss(toast.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </section>
  );
}
