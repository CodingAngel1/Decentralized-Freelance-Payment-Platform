import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import QrCode from "./QrCode";

const CLIENT = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";

afterEach(() => cleanup());

describe("QrCode", () => {
  it("renders a scannable svg with an accessible name", () => {
    render(<QrCode value={CLIENT} label="Client address" />);

    const svg = screen.getByRole("img", { name: "QR code for Client address" });
    // Two paths: the background and the module matrix. An empty <svg> would mean
    // the encoder silently produced nothing.
    expect(svg.querySelectorAll("path").length).toBe(2);
    expect(svg.getAttribute("width")).toBe("148");
  });

  it("names the code after its value when no label is given", () => {
    render(<QrCode value={CLIENT} />);

    expect(screen.getByRole("img", { name: `QR code for ${CLIENT}` })).toBeTruthy();
  });
});
