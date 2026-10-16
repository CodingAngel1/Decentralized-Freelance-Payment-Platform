/**
 * JobDetailSkeleton.tsx
 *
 * Skeleton placeholder for JobDetail during escrow data fetch.
 */

export default function JobDetailSkeleton() {
  return (
    <div
      className="skeleton-container job-detail-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="sr-only">Loading job details…</p>
      <div className="skeleton-detail-content" aria-hidden="true">
        <div className="skeleton-row">
          <span className="skeleton-label">Status:</span>{" "}
          <span className="skeleton skeleton-badge" />
        </div>
        <div className="skeleton-row">
          <div className="skeleton skeleton-text" style={{ width: "80%", height: "1rem" }} />
          <div className="skeleton skeleton-text" style={{ width: "85%", height: "1rem", marginTop: "0.5rem" }} />
          <div className="skeleton skeleton-text" style={{ width: "40%", height: "1rem", marginTop: "0.5rem" }} />
        </div>
        <div
          className="skeleton skeleton-title"
          style={{ width: "120px", height: "1.5rem", marginTop: "1.5rem" }}
        />
        <ol className="skeleton-milestone-list">
          {[1, 2].map((i) => (
            <li key={i} className="skeleton-milestone-item">
              <span
                className="skeleton skeleton-text"
                style={{ width: "70%", height: "1rem" }}
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
