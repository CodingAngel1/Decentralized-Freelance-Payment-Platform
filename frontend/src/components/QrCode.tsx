/**
 * QrCode.tsx
 *
 * Renders a Stellar address as a QR code a wallet app can scan.
 *
 * Wrapped rather than used directly so every code in the app is the same size,
 * keeps a 2-module quiet zone (a QR with no margin often fails to scan), uses a
 * medium error-correction level (a screen is not a printed sticker: a couple of
 * occluded modules should still decode) and carries an accessible name. Swapping
 * the encoder later touches this one file.
 */

import { QRCodeSVG } from "qrcode.react";

export default function QrCode({
  value,
  label,
  size = 148,
}: {
  /** The address (or any string) to encode. */
  value: string;
  /** What the code is for, e.g. `Client address`; defaults to the value. */
  label?: string;
  size?: number;
}) {
  const name = label ?? value;
  return (
    <QRCodeSVG
      className="qr-code"
      value={value}
      size={size}
      level="M"
      marginSize={2}
      aria-label={`QR code for ${name}`}
    />
  );
}
