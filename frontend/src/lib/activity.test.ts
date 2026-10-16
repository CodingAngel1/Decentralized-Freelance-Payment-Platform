import { describe, expect, it } from "vitest";
import { actionLabel } from "./activity";

describe("actionLabel", () => {
  it("turns an indexed event name into a phrase a client can read", () => {
    // docs/EVENTS.md names — the API stores them verbatim from topic0.
    expect(actionLabel("created")).toBe("Escrow created");
    expect(actionLabel("funded")).toBe("Escrow funded");
    expect(actionLabel("milestone_released")).toBe("Milestone released");
    expect(actionLabel("dispute_opened")).toBe("Dispute opened");
    expect(actionLabel("refunded")).toBe("Escrow refunded");
    expect(actionLabel("rated")).toBe("Rating submitted");
  });

  it("spells out an event this build does not know instead of hiding it", () => {
    // A contract deployed ahead of the frontend can emit a name not in the map.
    expect(actionLabel("milestone_reopened")).toBe("milestone reopened");
  });
});
