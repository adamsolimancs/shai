"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";
type ConsentState = "granted" | "denied";

const THEME_COOKIE = "shai-color-mode";
const CONSENT_KEY = "shai-theme-consent";

const applyThemeMode = (mode: ThemeMode) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.dataset.theme = mode;
  root.style.setProperty("color-scheme", mode);
};

const getCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const entries = document.cookie ? document.cookie.split("; ") : [];
  const match = entries.find((entry) => entry.startsWith(`${name}=`));
  if (!match) return null;
  const value = match.slice(name.length + 1);
  return value ? decodeURIComponent(value) : null;
};

const setCookie = (name: string, value: string, days = 365) => {
  if (typeof document === "undefined") return;
  const maxAge = days * 24 * 60 * 60;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
};

const removeCookie = (name: string) => {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
};

const ThemeToggle = () => {
  const [mode, setMode] = useState<ThemeMode>("light");
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [showConsent, setShowConsent] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedConsent = window.localStorage.getItem(CONSENT_KEY) as ConsentState | null;
    setConsent(storedConsent === "granted" || storedConsent === "denied" ? storedConsent : null);
    const prefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const storedMode = storedConsent === "granted" ? (getCookie(THEME_COOKIE) as ThemeMode | null) : null;
    const initialMode = storedMode ?? (prefersDark ? "dark" : "light");
    setMode(initialMode);
    applyThemeMode(initialMode);
  }, []);

  const handleToggle = () => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      applyThemeMode(next);
      if (consent === "granted") {
        setCookie(THEME_COOKIE, next);
      } else if (consent === null) {
        setShowConsent(true);
      }
      return next;
    });
  };

  const handleConsent = (next: ConsentState) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CONSENT_KEY, next);
    setConsent(next);
    setShowConsent(false);
    if (next === "granted") {
      setCookie(THEME_COOKIE, mode);
    } else {
      removeCookie(THEME_COOKIE);
    }
  };

  const isDark = mode === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <>
      <div className="flex items-center justify-end">
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
      </div>
      {showConsent ? (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="flex w-full max-w-[28rem] items-center justify-between gap-3 rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.2)] bg-[color:rgba(var(--color-app-surface-rgb),0.94)] px-4 py-2 text-[0.7rem] text-[color:var(--color-app-foreground)] shadow-xl shadow-black/10 backdrop-blur">
            <span className="leading-tight">Allow cookies on this website?</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleConsent("denied")}
                className="rounded-full border border-transparent px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-wide text-[color:var(--color-app-foreground-muted)] transition hover:text-[color:var(--color-app-foreground)]"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => handleConsent("granted")}
                className="rounded-full border border-transparent bg-[color:var(--color-app-primary)] px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-wide text-[color:var(--primary-foreground)] shadow-sm transition hover:brightness-110"
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default ThemeToggle;
