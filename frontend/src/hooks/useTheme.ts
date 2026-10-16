/**
 * useTheme.ts
 *
 * Theme management hook supporting light and dark modes with localStorage persistence
 * and system preference fallback. Prevents flash of wrong theme by synchronizing
 * with document.documentElement's data-theme attribute.
 */

import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // localStorage may be inaccessible in restricted iframe/incognito
  }

  const existingAttr = document.documentElement.getAttribute("data-theme");
  if (existingAttr === "light" || existingAttr === "dark") {
    return existingAttr;
  }

  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage errors
    }
  }, [theme]);

  // Listen to system theme changes if no explicit user preference was saved in localStorage
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const listener = (e: MediaQueryListEvent) => {
      try {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (!saved) {
          setTheme(e.matches ? "dark" : "light");
        }
      } catch {
        setTheme(e.matches ? "dark" : "light");
      }
    };

    if (media.addEventListener) {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    } else if (media.addListener) {
      media.addListener(listener);
      return () => media.removeListener(listener);
    }
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return { theme, setTheme, toggleTheme };
}
