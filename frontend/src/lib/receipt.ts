/**
 * receipt.ts
 *
 * Standalone HTML for the downloadable escrow receipt (issue #77). The page can
 * be printed to PDF from the browser, but "exportable" also means a file the
 * client can keep: this builds one self-contained document — no scripts, no
 * external assets — so it opens and prints anywhere, offline.
 *
 * Kept out of the page component so it stays pure and testable, and so the
 * receipt's content can be asserted without rendering a page.
 */

import type { EscrowReceiptApi } from "./api";
import { actionLabel } from "./activity";
import { explorerTxUrl } from "./stellar";
import { formatDateTime } from "./time";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape text for HTML. Job titles, descriptions and comments are user input and
 * are embedded in a document that the browser will render, so they cannot be
 * interpolated raw.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** `Name <code>G…</code>` when a display name exists, otherwise just the address. */
function party(
  person: { stellarAddress: string; displayName: string | null } | null,
): string {
  if (!person) return "—";
  const name = person.displayName ? `${escapeHtml(person.displayName)} ` : "";
  return `${name}<code>${escapeHtml(person.stellarAddress)}</code>`;
}

function orDash(value: string | null | undefined): string {
  return value ? escapeHtml(value) : "—";
}

/**
 * A single-file receipt: a header with the totals, the milestone breakdown, and
 * every indexed action with a link to its transaction.
 */
export function buildReceiptHtml(receipt: EscrowReceiptApi): string {
  const { job, totals } = receipt;

  const milestoneRows = receipt.milestones
    .map(
      (milestone) => `
      <tr>
        <td>${milestone.index + 1}</td>
        <td>${orDash(milestone.description)}</td>
        <td class="num">${escapeHtml(milestone.amount)} ${escapeHtml(job.asset)}</td>
        <td>${escapeHtml(milestone.status)}</td>
        <td>${milestone.releasedAt ? escapeHtml(formatDateTime(milestone.releasedAt)) : "—"}</td>
      </tr>`,
    )
    .join("");

  const eventRows = receipt.events
    .map(
      (event) => `
      <tr>
        <td>${escapeHtml(formatDateTime(event.createdAt))}</td>
        <td>${escapeHtml(actionLabel(event.action))}</td>
        <td class="num">${event.amount === null ? "—" : `${escapeHtml(event.amount)} ${escapeHtml(job.asset)}`}</td>
        <td>${
          event.txHash
            ? `<a href="${escapeHtml(explorerTxUrl(event.txHash))}">${escapeHtml(
                event.txHash.slice(0, 16),
              )}…</a>`
            : "—"
        }</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Escrow receipt #${escapeHtml(receipt.escrowId)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1rem; margin-top: 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  th, td { border: 1px solid #ccc; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  td.num { text-align: right; white-space: nowrap; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 1rem; margin: 0; }
  dt { color: #555; }
  dd { margin: 0; }
  .muted { color: #666; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Escrow receipt #${escapeHtml(receipt.escrowId)}</h1>
<p class="muted">Generated ${escapeHtml(formatDateTime(receipt.generatedAt))}</p>

<h2>${escapeHtml(job.title)}</h2>
<dl>
  <dt>Status</dt><dd>${escapeHtml(job.status)}</dd>
  <dt>Client</dt><dd>${party(job.client)}</dd>
  <dt>Freelancer</dt><dd>${party(job.freelancer)}</dd>
  <dt>Total</dt><dd>${escapeHtml(job.totalAmount)} ${escapeHtml(job.asset)}</dd>
  <dt>Released</dt><dd>${escapeHtml(totals.released)} ${escapeHtml(job.asset)}</dd>
  <dt>Outstanding</dt><dd>${escapeHtml(totals.outstanding)} ${escapeHtml(job.asset)}</dd>
  <dt>Created</dt><dd>${escapeHtml(formatDateTime(job.createdAt))}</dd>
</dl>

<h2>Milestones</h2>
<table>
  <thead>
    <tr><th>#</th><th>Description</th><th>Amount</th><th>Status</th><th>Released</th></tr>
  </thead>
  <tbody>${milestoneRows}
  </tbody>
</table>

<h2>Transactions</h2>
<table>
  <thead>
    <tr><th>Date</th><th>Action</th><th>Amount</th><th>Transaction</th></tr>
  </thead>
  <tbody>${eventRows}
  </tbody>
</table>

<p class="muted">Amounts are in ${escapeHtml(job.asset)}. Descriptions:</p>
<p class="muted">${escapeHtml(job.description)}</p>
</body>
</html>
`;
}
