/**
 * AddressField.tsx
 *
 * A Stellar address with a copy button — and, where a user would plausibly want
 * to scan it into a wallet, a QR code behind a toggle.
 *
 * Contributor Notes:
 * - The QR is opt-in (`qr`) and only rendered once toggled open: the job list
 *   shows an address per row, and rendering a QR for each one would put a few
 *   hundred SVG nodes on the page for codes nobody asked for.
 * - `truncate` is for lists and the nav bar, where the address is context rather
 *   than the subject. The full value stays in the `title` attribute and is what
 *   the copy button and the QR encode — abbreviations are display only.
 * - Feedback is a live region (`role="status"`) rather than a swapped button
 *   label alone, so a screen reader announces the copy instead of leaving the
 *   user to guess whether anything happened.
 */

import { useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import { shortAddress } from "../lib/address";
import QrCode from "./QrCode";

/** How long the "copied" confirmation stays on screen. */
const COPIED_MS = 2_000;

export default function AddressField({
  address,
  label,
  qr = false,
  truncate = false,
}: {
  address: string;
  /**
   * What this address is, e.g. `Client address`. Names the copy and QR controls
   * (so a screen reader — and a test — can tell two addresses on a page apart)
   * and is never rendered: the page writes its own visible text, which keeps the
   * label from being printed twice.
   */
  label?: string;
  /** Offer a QR code as well as a copy button. */
  qr?: boolean;
  /** Show `GABC…WXYZ` instead of the full address. */
  truncate?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const timer = useRef<number>();

  // A copy that resolves after the user navigated away must not set state on an
  // unmounted component (JobDetail re-renders on a 5s poll, so this is reachable).
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const name = label ?? "address";

  async function handleCopy() {
    const ok = await copyText(address);
    setCopied(ok);
    setFailed(!ok);
    window.clearTimeout(timer.current);
    if (ok) timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <span className="address-field">
      <code title={address}>{truncate ? shortAddress(address) : address}</code>{" "}
      <button type="button" onClick={() => void handleCopy()} aria-label={`Copy ${name}`}>
        {copied ? "Copied" : "Copy"}
      </button>
      {qr && (
        <button
          type="button"
          aria-label={`${showQr ? "Hide" : "Show"} QR code for ${name}`}
          aria-expanded={showQr}
          onClick={() => setShowQr((open) => !open)}
        >
          {showQr ? "Hide QR" : "QR"}
        </button>
      )}
      {copied && (
        <span role="status" className="muted">
          {" "}
          Address copied.
        </span>
      )}
      {failed && (
        <span role="alert" className="muted">
          {" "}
          Could not copy — select the address instead.
        </span>
      )}
      {showQr && (
        <span className="address-field-qr">
          <QrCode value={address} label={name} />
        </span>
      )}
    </span>
  );
}
