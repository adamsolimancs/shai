"use client";

import { useRouter } from "next/navigation";
import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import { cn } from "@/lib/utils";

export type SearchSuggestion = {
  type: "player" | "team";
  id: number;
  name: string;
  subtitle: string | null;
  url: string;
};

type SearchStatus = "idle" | "loading" | "success" | "error";

type SearchComboboxProps = {
  id?: string;
  initialValue?: string;
  ariaLabel?: string;
  placeholder?: string;
  idleContent?: ReactNode;
  formClassName?: string;
  fieldClassName?: string;
  inputWrapperClassName?: string;
  inputClassName?: string;
  leadingButtonClassName?: string;
  submitButtonClassName?: string;
  showLeadingButton?: boolean;
  submitLabel?: string;
};

const DEBOUNCE_MS = 175;
const MIN_QUERY_LENGTH = 2;

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rememberPlayerSearch(suggestion: SearchSuggestion | null, query: string) {
  if (typeof window === "undefined") {
    return;
  }
  const shouldRemember = suggestion?.type === "player" || suggestion === null;
  if (!shouldRemember) {
    return;
  }
  try {
    window.sessionStorage.setItem("lastPlayerSearch", suggestion?.name ?? query.trim());
  } catch {
    // Storage can be disabled without affecting navigation.
  }
}

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-4.35-4.35m1.6-5.4a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
      />
    </svg>
  );
}

export default function SearchCombobox({
  id,
  initialValue = "",
  ariaLabel = "Search players and teams",
  placeholder,
  idleContent,
  formClassName,
  fieldClassName,
  inputWrapperClassName,
  inputClassName,
  leadingButtonClassName,
  submitButtonClassName,
  showLeadingButton = true,
  submitLabel = "Search",
}: SearchComboboxProps) {
  const router = useRouter();
  const generatedId = useId();
  const inputId = id ?? `search-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const statusId = `${inputId}-status`;
  const [query, setQuery] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const skipNextFetch = useRef(false);

  useEffect(() => {
    setQuery(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    if (!hasInteracted) {
      return;
    }
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setActiveIndex(-1);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    setSuggestions([]);
    setActiveIndex(-1);
    setStatus("loading");

    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmedQuery, limit: "8" });
        const response = await fetch(`/api/search/suggestions?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Search request failed with ${response.status}`);
        }
        const data = (await response.json()) as SearchSuggestion[];
        if (controller.signal.aborted) {
          return;
        }
        const nextSuggestions = Array.isArray(data) ? data : [];
        setSuggestions(nextSuggestions);
        setActiveIndex(nextSuggestions.length > 0 ? 0 : -1);
        setStatus("success");
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        setSuggestions([]);
        setActiveIndex(-1);
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hasInteracted, query]);

  const trimmedQuery = query.trim();
  const meetsMinimum = trimmedQuery.length >= MIN_QUERY_LENGTH;
  const panelOpen = isFocused && isOpen && meetsMinimum && status !== "idle";
  const listboxOpen = panelOpen && status === "success" && suggestions.length > 0;
  const activeSuggestion = activeIndex >= 0 ? suggestions[activeIndex] : undefined;

  const navigate = (suggestion: SearchSuggestion | null) => {
    const fallbackSlug = slugify(query);
    const url =
      suggestion?.url ?? (fallbackSlug ? `/players/${encodeURIComponent(fallbackSlug)}` : "");
    if (!url) {
      return;
    }
    rememberPlayerSearch(suggestion, query);
    if (suggestion) {
      skipNextFetch.current = true;
      setQuery(suggestion.name);
    }
    setIsOpen(false);
    startTransition(() => {
      router.push(url);
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(activeSuggestion ?? suggestions[0] ?? null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
      }
      return;
    }

    if (!suggestions.length) {
      return;
    }

    if (event.key === "Enter" && activeSuggestion) {
      event.preventDefault();
      navigate(activeSuggestion);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex(suggestions.length - 1);
    }
  };

  const statusText =
    !meetsMinimum
      ? "Enter at least two characters to search."
      : status === "loading"
        ? "Searching players and teams."
        : status === "error"
          ? "Suggestions are unavailable."
          : suggestions.length > 0
            ? `${suggestions.length} suggestions available.`
            : "No matching players or teams.";

  return (
    <form role="search" className={cn("relative", formClassName)} onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="sr-only">
        {ariaLabel}
      </label>
      <div className={fieldClassName}>
        {showLeadingButton ? (
          <button type="submit" aria-label="Submit search" className={leadingButtonClassName}>
            <SearchIcon />
          </button>
        ) : null}
        <div className={cn("relative", inputWrapperClassName)}>
          <input
            id={inputId}
            type="search"
            role="combobox"
            aria-label={ariaLabel}
            aria-autocomplete="list"
            aria-controls={listboxOpen ? listboxId : undefined}
            aria-describedby={statusId}
            aria-expanded={listboxOpen}
            aria-activedescendant={
              listboxOpen && activeSuggestion ? `${listboxId}-option-${activeIndex}` : undefined
            }
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onFocus={() => {
              setHasInteracted(true);
              setIsFocused(true);
              if (meetsMinimum) {
                setIsOpen(true);
              }
            }}
            onBlur={() => {
              setIsFocused(false);
              setIsOpen(false);
            }}
            onChange={(event) => {
              setHasInteracted(true);
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            className={inputClassName}
          />
          {!hasInteracted && query.length === 0 ? idleContent : null}
        </div>
        <button type="submit" className={submitButtonClassName}>
          {isPending ? (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-hidden="true"
            />
          ) : null}
          <span className="text-background">{isPending ? "Loading" : submitLabel}</span>
        </button>
      </div>

      <span id={statusId} className="sr-only" aria-live="polite">
        {statusText}
      </span>

      {isFocused && isOpen && trimmedQuery.length === 1 ? (
        <div className="surface-card absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 rounded-2xl px-4 py-3 text-sm text-[color:var(--color-app-foreground-muted)] shadow-2xl">
          Type one more character to search.
        </div>
      ) : null}

      {panelOpen ? (
        <div className="surface-card absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl shadow-2xl">
          {status === "loading" ? (
            <p className="px-4 py-3 text-sm text-[color:var(--color-app-foreground-muted)]">
              Searching…
            </p>
          ) : status === "error" ? (
            <p className="px-4 py-3 text-sm text-[color:var(--color-app-foreground-muted)]">
              Suggestions are unavailable. Press Enter to search players.
            </p>
          ) : suggestions.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[color:var(--color-app-foreground-muted)]">
              No matching players or teams.
            </p>
          ) : (
            <ul id={listboxId} role="listbox" aria-label="Search suggestions" className="py-2">
              {suggestions.map((suggestion, index) => (
                <li
                  id={`${listboxId}-option-${index}`}
                  key={`${suggestion.type}-${suggestion.id}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    navigate(suggestion);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left transition",
                    activeIndex === index
                      ? "bg-[color:var(--color-app-primary-soft)]"
                      : "hover:bg-[color:rgba(var(--color-app-foreground-rgb),0.06)]",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--color-app-foreground)]">
                      {suggestion.name}
                    </span>
                    {suggestion.subtitle ? (
                      <span className="block truncate text-xs text-[color:var(--color-app-foreground-muted)]">
                        {suggestion.subtitle}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 rounded-full border border-[color:var(--color-app-border)] px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-[color:var(--color-app-foreground-muted)]">
                    {suggestion.type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </form>
  );
}
