/**
 * ThemeToggle.tsx
 *
 * Button to toggle between light and dark themes with full keyboard and screen reader accessibility.
 */

import { useTheme } from "../hooks/useTheme";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  const isDark = theme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
    >
      <span aria-hidden="true" className="theme-toggle-icon">
        {isDark ? "☀️" : "🌙"}
      </span>
      <span className="theme-toggle-text">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
