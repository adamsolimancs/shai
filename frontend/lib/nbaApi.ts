const API_BASE_URL = process.env.BACKEND_API_BASE_URL || "http://localhost:8080";
const API_KEY = process.env.BACKEND_API_KEY;
const ENV_TIMEOUT_MS = Number(process.env.NBA_API_TIMEOUT_MS ?? "");

type Envelope<T> = {
  ok: true;
  data: T;
  meta: {
    request_id?: string;
  };
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

const DEFAULT_REVALIDATE_SECONDS = 300;
const DEFAULT_CACHE: RequestCache = "no-store";
const DEFAULT_TIMEOUT_MS =
  Number.isFinite(ENV_TIMEOUT_MS) && ENV_TIMEOUT_MS > 0 ? ENV_TIMEOUT_MS : 10_000;
export const DEFAULT_SEASON = process.env.NBA_DEFAULT_SEASON || "2025-26";

type NbaFetchInit = RequestInit & { next?: { revalidate?: number }; timeoutMs?: number };

export async function nbaFetch<T>(
  path: string,
  init?: NbaFetchInit,
): Promise<T> {
  if (!API_KEY) {
    throw new Error("BACKEND_API_KEY must be set to call the backend.");
  }

  const { timeoutMs, ...initRest } = init ?? {};
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  if (process.env.NODE_ENV !== "production") {
    console.log("NBA Fetch:", url);
  }

  const hasRevalidate = typeof initRest?.next?.revalidate === "number";
  const cache = initRest?.cache ?? (hasRevalidate ? "force-cache" : DEFAULT_CACHE);
  const timeoutValue =
    typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = timeoutValue ? new AbortController() : null;
  if (controller && initRest?.signal) {
    if (initRest.signal.aborted) {
      controller.abort();
    } else {
      initRest.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  const requestInit: RequestInit & { next?: { revalidate?: number } } = {
    ...initRest,
    cache,
    signal: controller?.signal ?? initRest?.signal,
    headers: {
      "x-api-key": API_KEY,
      ...(initRest?.headers || {}),
    },
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

  let response: Response;
  try {
    response = await fetch(url, requestInit);
  } catch (error) {
    if (didTimeout) {
      throw new Error(`NBA API request timed out after ${timeoutValue}ms`);
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (!response.ok) {
    const errorBody = await safeJson(response);
    const message =
      errorBody && typeof errorBody === "object" && "error" in errorBody
        ? (errorBody as Partial<ErrorEnvelope>).error?.message
        : undefined;
    throw new Error(message || `NBA API request failed with ${response.status}`);
  }

  const body = (await response.json()) as Envelope<T> | ErrorEnvelope;
  if (!body.ok) {
    throw new Error(body.error?.message || "NBA API returned error");
  }
  return body.data;
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}
