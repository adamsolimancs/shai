import "server-only";

type JsonRecord = Record<string, unknown>;

type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: JsonRecord | null;
};

type PasswordAuthUser = {
  id: string;
  email: string;
  name: string;
  username: string | null;
};

type SupabasePasswordSignInResponse = {
  access_token?: string | null;
  refresh_token?: string | null;
  user?: SupabaseAuthUser | null;
  session?: JsonRecord | null;
};

type SupabaseSignUpResponse = {
  access_token?: string | null;
  refresh_token?: string | null;
  user?: SupabaseAuthUser | null;
  session?: JsonRecord | null;
};

export class SupabaseAuthError extends Error {}

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || "";
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  process.env.SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim() ||
  process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.SUPABASE_ANON_KEY?.trim() ||
  "";

export const hasSupabasePasswordConfigured = Boolean(supabaseUrl && supabasePublishableKey);

const authUrl = (path: string) => `${supabaseUrl.replace(/\/$/, "")}/auth/v1${path}`;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readErrorMessage = (payload: unknown): string => {
  if (!payload || typeof payload !== "object") {
    return "Authentication failed. Please try again.";
  }
  const record = payload as JsonRecord;
  return (
    getText(record.msg) ||
    getText(record.error_description) ||
    getText(record.error) ||
    getText(record.message) ||
    "Authentication failed. Please try again."
  );
};

const getRecord = (value: unknown): JsonRecord | null => (isRecord(value) ? value : null);

const getNestedRecord = (record: JsonRecord | null, key: string): JsonRecord | null =>
  getRecord(record?.[key]);

const extractUser = (payload: unknown): SupabaseAuthUser | null => {
  const record = getRecord(payload);
  if (!record) {
    return null;
  }

  const dataRecord = getNestedRecord(record, "data");
  const userRecord = getNestedRecord(record, "user") ?? getNestedRecord(dataRecord, "user") ?? record;
  const id = getText(userRecord.id);
  if (!id) {
    return null;
  }

  return {
    id,
    email: getText(userRecord.email),
    user_metadata: getRecord(userRecord.user_metadata),
  };
};

const extractAccessToken = (payload: unknown): string | null => {
  const record = getRecord(payload);
  if (!record) {
    return null;
  }

  const dataRecord = getNestedRecord(record, "data");
  const sessionRecord = getNestedRecord(record, "session") ?? getNestedRecord(dataRecord, "session");

  return (
    getText(record.access_token) ||
    getText(dataRecord?.access_token) ||
    getText(sessionRecord?.access_token)
  );
};

const hasSessionPayload = (payload: unknown): boolean => {
  const record = getRecord(payload);
  if (!record) {
    return false;
  }

  const dataRecord = getNestedRecord(record, "data");
  const sessionRecord = getNestedRecord(record, "session") ?? getNestedRecord(dataRecord, "session");

  return Boolean(
    extractAccessToken(payload) ||
      getText(record.refresh_token) ||
      getText(dataRecord?.refresh_token) ||
      getText(sessionRecord?.refresh_token),
  );
};

const normalizeName = (user: SupabaseAuthUser): string => {
  const metadata = user.user_metadata ?? {};
  const name =
    getText(metadata.name) ||
    getText(metadata.full_name) ||
    [getText(metadata.first_name), getText(metadata.last_name)].filter(Boolean).join(" ").trim();
  if (name) {
    return name;
  }
  if (user.email) {
    return user.email.split("@")[0] ?? "ShAI user";
  }
  return "ShAI user";
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const normalizeUsername = (user: SupabaseAuthUser): string | null => {
  const metadata = user.user_metadata ?? {};
  const username = getText(metadata.username);
  return username ? username.toLowerCase() : null;
};

async function supabaseAuthRequest<T>(
  path: string,
  payload: JsonRecord,
): Promise<T> {
  if (!hasSupabasePasswordConfigured) {
    throw new SupabaseAuthError(
      "Email/password authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).",
    );
  }

  const response = await fetch(authUrl(path), {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: supabasePublishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new SupabaseAuthError(readErrorMessage(body));
  }

  return body as T;
}

async function fetchSupabaseAuthUser(accessToken: string) {
  const response = await fetch(authUrl("/user"), {
    method: "GET",
    cache: "no-store",
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new SupabaseAuthError(readErrorMessage(body));
  }

  return extractUser(body);
}

export async function verifySupabasePasswordUser(email: string, password: string) {
  const payload = await supabaseAuthRequest<SupabasePasswordSignInResponse>(
    "/token?grant_type=password",
    {
      email: normalizeEmail(email),
      password,
    },
  );

  const accessToken = extractAccessToken(payload);
  const user = extractUser(payload) ?? (accessToken ? await fetchSupabaseAuthUser(accessToken) : null);
  if (!user?.id) {
    throw new SupabaseAuthError("Invalid email or password.");
  }

  return {
    id: user.id,
    email: normalizeEmail(user.email ?? email),
    name: normalizeName(user),
    username: normalizeUsername(user),
  } satisfies PasswordAuthUser;
}

export async function signUpSupabasePasswordUser(input: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}) {
  const firstName = getText(input.firstName);
  const lastName = getText(input.lastName);
  const username = getText(input.username)?.toLowerCase();
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();

  const payload = await supabaseAuthRequest<SupabaseSignUpResponse>("/signup", {
    email: normalizeEmail(input.email),
    password: input.password,
    data: {
      ...(name ? { name } : {}),
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      ...(username ? { username } : {}),
    },
  });

  const user = extractUser(payload);

  return {
    hasSession: hasSessionPayload(payload),
    user: user
      ? {
          id: user.id,
          email: normalizeEmail(user.email ?? input.email),
          name: normalizeName(user),
          username: normalizeUsername(user),
        }
      : null,
  };
}
