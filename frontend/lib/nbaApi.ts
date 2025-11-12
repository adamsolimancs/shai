const API_BASE_URL = process.env.NBA_API_BASE_URL || "http://localhost:8080";
const API_KEY = process.env.NBA_API_KEY;

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
export const DEFAULT_SEASON = process.env.NBA_DEFAULT_SEASON || "2025-26";

export async function nbaFetch<T>(
  path: string,
  init?: RequestInit & { next?: { revalidate?: number } },
): Promise<T> {
  if (!API_KEY) {
    throw new Error("NBA_API_KEY (or NEXT_PUBLIC_NBA_API_KEY) must be set to call the backend.");
  }

  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  if (process.env.NODE_ENV !== "production") {
    console.log("NBA Fetch:", url);
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      "x-api-key": API_KEY,
      ...(init?.headers || {}),
    },
    next: init?.next ?? { revalidate: DEFAULT_REVALIDATE_SECONDS },
  });

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
