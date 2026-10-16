import { describe, expect, it } from "vitest";
import { formatDate, formatDeadline, formatRemaining, secondsUntil } from "./time";

describe("secondsUntil", () => {
  it("counts down to the deadline in whole seconds", () => {
    expect(secondsUntil(1_700_000_000n, 1_699_999_940)).toBe(60);
  });

  it("floors at zero once the deadline has passed", () => {
    // The contract allows reclaim only strictly after the deadline, so a
    // non-positive countdown is the UI's signal that the action is live.
    expect(secondsUntil(1_700_000_000n, 1_700_000_000)).toBe(0);
    expect(secondsUntil(1_700_000_000n, 1_700_000_001)).toBe(0);
  });
});

describe("formatRemaining", () => {
  it("picks the two most significant units", () => {
    expect(formatRemaining(2 * 86_400 + 3 * 3_600)).toBe("2d 3h");
    expect(formatRemaining(3 * 3_600 + 4 * 60)).toBe("3h 4m");
    expect(formatRemaining(4 * 60 + 5)).toBe("4m 5s");
    expect(formatRemaining(12)).toBe("12s");
    expect(formatRemaining(0)).toBe("0s");
  });
});

describe("formatDeadline", () => {
  it("renders the deadline as a wall-clock time", () => {
    // `toLocaleString` output is locale/zone dependent, so assert on the year.
    expect(formatDeadline(1_700_000_000n)).toMatch(/2023/);
  });
});

describe("formatDate", () => {
  it("renders an ISO timestamp as a locale date", () => {
    // Locale/zone dependent, so compare against the same formatter the app uses.
    const iso = "2026-01-03T00:00:00.000Z";
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString());
  });
});
