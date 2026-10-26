import { backendHeaders } from "@/lib/backendHeaders";

const API_BASE_URL = process.env.BACKEND_API_BASE_URL || "http://localhost:8080";
const API_KEY = process.env.BACKEND_API_KEY;
const ENV_TIMEOUT_MS = Number(
  process.env.BACKEND_API_TIMEOUT_MS ?? process.env.NBA_API_TIMEOUT_MS ?? "",
);

export type Envelope<T> = {
  ok: true;
  data: T;
  meta: {
    request_id?: string;
    source: string;
    as_of: string | null;
    stale: boolean;
  };
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export class NbaApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfter?: string | null) {
    super(message);
    this.name = "NbaApiError";
  }
}

const DEFAULT_REVALIDATE_SECONDS = 300;
const DEFAULT_CACHE: RequestCache = "no-store";
const DEFAULT_TIMEOUT_MS =
  Number.isFinite(ENV_TIMEOUT_MS) && ENV_TIMEOUT_MS > 0 ? ENV_TIMEOUT_MS : 10_000;

export function seasonForDate(value: Date = new Date()): string {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  const startYear = month >= 9 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export const DEFAULT_SEASON = process.env.NBA_DEFAULT_SEASON?.trim() || seasonForDate();

type NbaFetchInit = RequestInit & { next?: { revalidate?: number }; timeoutMs?: number };

export async function nbaFetchEnvelope<T>(
  path: string,
  init?: NbaFetchInit,
): Promise<Envelope<T>> {
  if (!API_KEY) {
    throw new Error("BACKEND_API_KEY must be set to call the backend.");
  }

  const { timeoutMs, ...initRest } = init ?? {};
  const requestHeaders = await backendHeaders(initRest.headers);
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  if (process.env.NODE_ENV !== "production") {
    console.log("NBA Fetch:", url);
  }

  const hasRevalidate = typeof initRest?.next?.revalidate === "number";
  const cache = initRest?.cache ?? (hasRevalidate ? "force-cache" : DEFAULT_CACHE);
  const timeoutValue =
    typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = timeoutValue ? new AbortController() : null;
  const abortFromCaller = () => controller?.abort();
  if (controller && initRest?.signal) {
    if (initRest.signal.aborted) {
      controller.abort();
    } else {
      initRest.signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  const requestInit: RequestInit & { next?: { revalidate?: number } } = {
    ...initRest,
    cache,
    signal: controller?.signal ?? initRest?.signal,
    headers: requestHeaders,
  };

  if (cache !== "no-store") {
    requestInit.next = initRest?.next ?? { revalidate: DEFAULT_REVALIDATE_SECONDS };
  } else if ("next" in requestInit) {
    delete requestInit.next;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;
  if (controller && timeoutValue) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutValue);
  }

  try {
    const response = await fetch(url, requestInit);
    if (!response.ok) {
      const errorBody = await safeJson(response);
      const message =
        errorBody && typeof errorBody === "object" && "error" in errorBody
          ? (errorBody as Partial<ErrorEnvelope>).error?.message
          : undefined;
      throw new NbaApiError(
        message || `NBA API request failed with ${response.status}`,
        response.status,
        response.headers?.get("Retry-After"),
      );
    }

    const body = (await response.json()) as Envelope<T> | ErrorEnvelope;
    if (!body.ok) {
      throw new Error(body.error?.message || "NBA API returned error");
    }
    return body;
  } catch (error) {
    if (didTimeout) {
      throw new Error(`NBA API request timed out after ${timeoutValue}ms`);
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    initRest?.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

// Data-only adapter for consumers that do not display freshness.
export async function nbaFetch<T>(path: string, init?: NbaFetchInit): Promise<T> {
  return (await nbaFetchEnvelope<T>(path, init)).data;
}

export function combineFreshness(metas: Envelope<unknown>["meta"][]): Envelope<unknown>["meta"] {
  const times = metas.map((meta) => meta.as_of ? Date.parse(meta.as_of) : NaN);
  return {
    source: [...new Set(metas.map((meta) => meta.source))].join(", "),
    stale: metas.some((meta) => meta.stale),
    as_of: times.length && times.every(Number.isFinite) ? new Date(Math.min(...times)).toISOString() : null,
  };
}

// Keep observations local to a composed server view (never shared across requests).
export function createObservedFetcher() {
  const metas: Envelope<unknown>["meta"][] = [];
  return {
    metas,
    async fetch<T>(path: string, init?: NbaFetchInit): Promise<T> {
      const response = await nbaFetchEnvelope<T>(path, init);
      metas.push(response.meta);
      return response.data;
    },
  };
}
