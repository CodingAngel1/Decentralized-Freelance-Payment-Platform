import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ThemeToggle from "./ThemeToggle";
import { THEME_STORAGE_KEY } from "../hooks/useTheme";

describe("ThemeToggle", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, val: string) => {
          store[key] = val;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          store = {};
        },
      },
      writable: true,
    });
    document.documentElement.removeAttribute("data-theme");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to light theme when no storage exists and matchesMedia is false", () => {
    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    const button = screen.getByRole("button", { name: /switch to dark theme/i });
    expect(button).toBeDefined();
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles theme to dark when clicked and persists to localStorage", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /switch to dark theme/i });
    fireEvent.click(button);

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeDefined();
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles back to light from dark", () => {
    store[THEME_STORAGE_KEY] = "dark";
    document.documentElement.setAttribute("data-theme", "dark");

    render(<ThemeToggle />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    const button = screen.getByRole("button", { name: /switch to light theme/i });
    fireEvent.click(button);

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
