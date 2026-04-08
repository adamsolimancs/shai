import "server-only";

const API_BASE_URL = process.env.BACKEND_API_BASE_URL || "http://localhost:8080";
const API_KEY = process.env.BACKEND_API_KEY;

type Envelope<T> = {
  ok: true;
  data: T;
};

type ErrorEnvelope = {
  ok: false;
  error?: {
    code?: string;
    message?: string;
  };
};

type DetailEnvelope = {
  detail?: {
    code?: string;
    message?: string;
  };
};

export type UserAccountRecord = {
  auth_user_id: string;
  email: string;
  name: string | null;
  username: string | null;
};

type ApiError = Error & {
  status?: number;
};

const readErrorMessage = (payload: unknown): string => {
  if (!payload || typeof payload !== "object") {
    return "Account request failed.";
  }

  const record = payload as ErrorEnvelope & DetailEnvelope;
  return record.error?.message || record.detail?.message || "Account request failed.";
};

const buildApiError = (message: string, status?: number): ApiError => {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
};

async function accountApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_KEY) {
    throw buildApiError("BACKEND_API_KEY must be set to manage account records.");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-api-key": API_KEY,
      ...(init?.headers || {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw buildApiError(readErrorMessage(payload), response.status);
  }

  if (payload && typeof payload === "object" && "ok" in payload) {
    return (payload as Envelope<T>).data;
  }

  return payload as T;
}

export async function findUserAccountByUsername(username: string): Promise<UserAccountRecord | null> {
  try {
    return await accountApiRequest<UserAccountRecord>(
      `/v1/user-accounts/lookup?username=${encodeURIComponent(username.trim().toLowerCase())}`,
    );
  } catch (error) {
    if ((error as ApiError).status === 404) {
      return null;
    }
    throw error;
  }
}

export async function findUserAccountByAuthUserId(authUserId: string): Promise<UserAccountRecord | null> {
  try {
    return await accountApiRequest<UserAccountRecord>(
      `/v1/user-accounts/by-auth-user/${encodeURIComponent(authUserId.trim())}`,
    );
  } catch (error) {
    if ((error as ApiError).status === 404) {
      return null;
    }
    throw error;
  }
}

export async function syncUserAccount(input: {
  auth_user_id: string;
  email: string;
  name?: string | null;
  username?: string | null;
}): Promise<UserAccountRecord> {
  return accountApiRequest<UserAccountRecord>("/v1/user-accounts/sync", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
