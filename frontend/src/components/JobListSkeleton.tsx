/**
 * JobListSkeleton.tsx
 *
 * Skeleton placeholder for the job list on Dashboard during loading.
 */

export default function JobListSkeleton() {
  return (
    <div
      className="skeleton-container"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="sr-only">Loading jobs…</p>
      <ul className="job-list skeleton-list" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <li key={n} className="skeleton-job-item">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-badge" />
            <div className="skeleton skeleton-subtext" />
            <div className="skeleton skeleton-link" />
          </li>
        ))}
      </ul>
    </div>
  );
}
