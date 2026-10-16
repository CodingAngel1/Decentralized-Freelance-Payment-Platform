/**
 * FiatEstimate.test.tsx
 *
 * Two properties matter for issue #76, and both are about restraint: the
 * figure must be labelled as an estimate rather than read like a quote, and
 * when there is no rate the amount must be left exactly as it was — no
 * placeholder, no zero, no error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ rates: {} as Record<string, number> }));

vi.mock("../hooks/useFiatRates", () => ({ useFiatRates: () => h.rates }));

import FiatEstimate from "./FiatEstimate";

beforeEach(() => {
  h.rates = {};
});

afterEach(() => cleanup());

describe("FiatEstimate", () => {
  it("shows an approximate figure beside the amount", () => {
    h.rates = { XLM: 0.5 };
    render(<FiatEstimate amount={1.5} asset="XLM" />);

    expect(screen.getByText("$0.75")).toBeTruthy();
  });

  it("labels the figure as an estimate", () => {
    h.rates = { XLM: 0.5 };
    render(<FiatEstimate amount={1.5} asset="XLM" />);

    const node = screen.getByText("$0.75").closest(".fiat");
    expect(node?.textContent).toContain("≈");
    expect(node?.textContent).toContain("est.");
  });

  it("names the rate it used, so the figure can be checked", () => {
    h.rates = { XLM: 0.5 };
    render(<FiatEstimate amount={1.5} asset="XLM" />);

    const title = screen.getByText("$0.75").closest(".fiat")?.getAttribute("title");
    expect(title).toContain("1 XLM = 0.5 USD");
    expect(title).toContain("Not a quote");
  });

  it("renders nothing when the asset has no rate", () => {
    h.rates = { USDC: 1 };
    const { container } = render(<FiatEstimate amount={1.5} asset="AQUA" />);

    expect(container.textContent).toBe("");
  });

  it("renders nothing when no rate has arrived at all", () => {
    const { container } = render(<FiatEstimate amount={1.5} asset="XLM" />);

    expect(container.textContent).toBe("");
  });

  it("accepts an exact decimal string, as the API returns amounts", () => {
    h.rates = { USDC: 1 };
    render(<FiatEstimate amount="10.5" asset="USDC" />);

    expect(screen.getByText("$10.50")).toBeTruthy();
  });

  it("shows `<` rather than $0.00 for a tiny non-zero amount", () => {
    h.rates = { XLM: 0.5 };
    render(<FiatEstimate amount={0.001} asset="XLM" />);

    expect(screen.getByText("<$0.01")).toBeTruthy();
  });
});
