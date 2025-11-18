"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "shai-color-mode";

const applyThemeMode = (mode: ThemeMode) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.dataset.theme = mode;
  root.style.setProperty("color-scheme", mode);
};

const ThemeToggle = () => {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialMode = stored ?? (prefersDark ? "dark" : "light");
    setMode(initialMode);
    applyThemeMode(initialMode);
  }, []);

  const handleToggle = () => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyThemeMode(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
      return next;
    });
  };

  const isDark = mode === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={isDark}
      aria-label={label}
      className="group inline-flex items-center gap-3 rounded-full border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] px-4 py-2 text-[color:var(--color-app-foreground)] transition hover:border-[color:var(--color-app-border-strong)] hover:bg-[color:var(--color-app-background-soft)]"
    >
      <span className="text-xs font-semibold uppercase tracking-wide">
        {isDark ? "Dark Mode" : "Light Mode"}
      </span>
      <span className="relative inline-flex h-6 w-11 items-center rounded-full bg-[color:var(--color-app-background-soft)] transition group-hover:bg-[color:var(--color-app-surface)]">
        <span
          className={`inline-block h-4 w-4 rounded-full bg-[color:var(--color-app-primary)] shadow-sm transition-transform duration-200 ${
            isDark ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
};

export default ThemeToggle;
