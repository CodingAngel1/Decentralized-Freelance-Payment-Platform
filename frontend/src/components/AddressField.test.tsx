import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// What the QR was asked to encode. The real encoder is exercised in
// QrCode.test.tsx; this file is about the component's behaviour.
const qr = vi.hoisted(() => ({ values: [] as string[] }));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value, "aria-label": label }: { value: string; "aria-label"?: string }) => {
    qr.values.push(value);
    return <svg role="img" aria-label={label} />;
  },
}));

import AddressField from "./AddressField";

const CLIENT = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  qr.values = [];
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("AddressField", () => {
  it("shows the full address and a labelled copy button", () => {
    render(<AddressField address={CLIENT} label="Client address" />);

    expect(screen.getByText(CLIENT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Client address" })).toBeTruthy();
    // The label names the controls; it is not printed next to the address (the
    // page already writes "Client: ").
    expect(screen.queryByText(/Client address:/)).toBeNull();
  });

  it("truncates for a list but keeps the full value readable on hover", () => {
    render(<AddressField address={CLIENT} truncate />);

    const code = screen.getByTitle(CLIENT);
    expect(code.textContent).toBe("GBPLJH…Q75B");
  });

  it("copies the full address even when it is displayed truncated", async () => {
    render(<AddressField address={CLIENT} truncate />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CLIENT));
  });

  it("confirms the copy in a live region", async () => {
    render(<AddressField address={CLIENT} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/address copied/i);
  });

  it("does not render a QR unless it is asked for", () => {
    render(<AddressField address={CLIENT} />);

    expect(screen.queryByRole("button", { name: /QR code/ })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("opens the QR on demand and encodes the full address", () => {
    render(<AddressField address={CLIENT} label="Freelancer address" qr />);

    // Nothing is encoded until the user asks: a job list renders one address per
    // row and must not pay for a QR per row.
    expect(qr.values).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Show QR code for Freelancer address" }));

    expect(qr.values).toEqual([CLIENT]);
    expect(screen.getByRole("img", { name: "QR code for Freelancer address" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Hide QR code for Freelancer address" }));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("says so instead of claiming success when the copy fails", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    render(<AddressField address={CLIENT} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not copy/i);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
