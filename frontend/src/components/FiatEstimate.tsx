/**
 * FiatEstimate.tsx
 *
 * An approximate fiat figure to sit beside an amount (issue #76).
 *
 * Renders **nothing** when the asset has no rate — an unavailable feed must
 * leave the amount exactly as it was, never a placeholder or an error. When a
 * rate is present the figure is labelled `est.` on screen (the `title` carries
 * the rate it came from), because an estimate that reads like a quote is worse
 * than no estimate at all.
 *
 * Usage:
 *   Total: <strong>1.5</strong> XLM <FiatEstimate amount={1.5} asset="XLM" />
 *
 * The figure is in its own `.fiat-value` element so callers (and tests) can
 * address the number without matching the surrounding label.
 */

import { useFiatRates } from "../hooks/useFiatRates";
import { estimateFiat, formatFiat, FIAT } from "../lib/prices";

export default function FiatEstimate({
  amount,
  asset,
}: {
  /** Whole units of `asset` — a base-unit bigint should be converted first. */
  amount: number | string;
  /** Asset symbol, e.g. `XLM`. */
  asset: string;
}) {
  const rates = useFiatRates();
  const value = estimateFiat(amount, asset, rates);
  if (value === null) return null;

  const rate = rates[asset.trim().toUpperCase()];
  return (
    <span
      className="fiat"
      title={`Approximate ${FIAT} value from a public price feed (1 ${asset.toUpperCase()} = ${rate} ${FIAT}). Not a quote.`}
    >
      ≈ <span className="fiat-value">{formatFiat(value)}</span>{" "}
      <span className="muted">est.</span>
    </span>
  );
}
