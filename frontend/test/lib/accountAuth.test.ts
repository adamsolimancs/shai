import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type JwtCallback = (params: Record<string, unknown>) => Promise<Record<string, unknown>>;

const nextAuthConfig: { current: { callbacks: { jwt: JwtCallback } } | null } = { current: null };
const authSession = vi.fn();
const updateSession = vi.fn();

vi.mock("next-auth/providers/google", () => ({
  default: (options: Record<string, unknown>) => ({ id: "google", ...options }),
}));
vi.mock("next-auth", () => ({
  default: (config: { callbacks: { jwt: JwtCallback } }) => {
    nextAuthConfig.current = config;
    return {
      handlers: { GET: vi.fn(), POST: vi.fn() },
      auth: authSession,
      signIn: vi.fn(),
      signOut: vi.fn(),
      unstable_update: updateSession,
    };
  },
}));

type RecordedRequest = { url: string; method: string; body: Record<string, unknown> | null };

const accountResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status < 400 ? { ok: true, data } : { detail: data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const recordFetch = (respond: (request: RecordedRequest) => Response) => {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const request = {
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      };
      requests.push(request);
      return respond(request);
    }),
  );
  return requests;
};

const googleSignIn = (randomUserId: string) => ({
  token: { email: "fan@example.com", name: "Fan Name" },
  user: { id: randomUserId, email: "fan@example.com", name: "Fan Name", image: "https://img" },
  account: { provider: "google", providerAccountId: "001234567890", type: "oidc" },
  profile: { sub: "001234567890", email_verified: true },
  trigger: "signIn",
});

beforeEach(() => {
  vi.resetModules();
  nextAuthConfig.current = null;
  authSession.mockReset();
  updateSession.mockReset();
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("BACKEND_API_KEY", "test-key");
  vi.stubEnv("BACKEND_API_BASE_URL", "http://backend.test");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Google sign-in account sync", () => {
  it("keys the account and session by the stable provider subject", async () => {
    const requests = recordFetch(() =>
      accountResponse({
        auth_user_id: "google:001234567890",
        email: "fan@example.com",
        name: "Saved Name",
        username: "saved_user",
      }),
    );
    await import("@/auth");
    const jwt = nextAuthConfig.current!.callbacks.jwt;

    const first = await jwt(googleSignIn("random-uuid-1"));
    const second = await jwt(googleSignIn("random-uuid-2"));

    expect(requests.map((request) => request.body)).toEqual([
      {
        auth_user_id: "google:001234567890",
        email: "fan@example.com",
        email_verified: true,
        name: "Fan Name",
      },
      {
        auth_user_id: "google:001234567890",
        email: "fan@example.com",
        email_verified: true,
        name: "Fan Name",
      },
    ]);
    expect(first.sub).toBe("google:001234567890");
    expect(second.sub).toBe("google:001234567890");
    expect(second).toMatchObject({ name: "Saved Name", username: "saved_user", provider: "google" });
  });

  it("keeps a stable session identity when account sync is unavailable", async () => {
    recordFetch(() => accountResponse({ message: "Unavailable" }, 503));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await import("@/auth");

    const token = await nextAuthConfig.current!.callbacks.jwt(googleSignIn("random-uuid"));

    expect(token.sub).toBe("google:001234567890");
    expect(token.username).toBeNull();
  });
});

describe("updateProfileAction", () => {
  const profileForm = (name: string, username: string) => {
    const form = new FormData();
    form.set("name", name);
    form.set("username", username);
    return form;
  };

  it("persists profile edits for the signed-in provider subject", async () => {
    authSession.mockResolvedValue({ user: { id: "google:001234567890", provider: "google" } });
    const requests = recordFetch(() =>
      accountResponse({
        auth_user_id: "google:001234567890",
        email: "fan@example.com",
        name: "New Name",
        username: "new_handle",
      }),
    );
    const { updateProfileAction } = await import("@/lib/profileActions");

    const result = await updateProfileAction(
      { error: null, success: null },
      profileForm(" New Name ", "New_Handle"),
    );

    expect(result).toEqual({ error: null, success: "Profile updated." });
    expect(requests).toEqual([
      {
        url: "http://backend.test/v1/user-accounts/by-auth-user/google%3A001234567890",
        method: "PATCH",
        body: { name: "New Name", username: "new_handle" },
      },
    ]);
    expect(updateSession).toHaveBeenCalledWith({ user: { name: "New Name", username: "new_handle" } });
  });

  it("does not update the session when the account record is missing", async () => {
    authSession.mockResolvedValue({ user: { id: "stale-session-id", provider: "google" } });
    recordFetch(() => accountResponse({ code: "NOT_FOUND", message: "Account not found." }, 404));
    const { updateProfileAction } = await import("@/lib/profileActions");

    const result = await updateProfileAction({ error: null, success: null }, profileForm("Name", ""));

    expect(result).toEqual({ error: "Sign in again to update your profile.", success: null });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("surfaces username conflicts without updating the session", async () => {
    authSession.mockResolvedValue({ user: { id: "google:001234567890", provider: "google" } });
    recordFetch(() =>
      accountResponse({ code: "CONFLICT", message: "That username is already in use." }, 409),
    );
    const { updateProfileAction } = await import("@/lib/profileActions");

    const result = await updateProfileAction(
      { error: null, success: null },
      profileForm("Name", "taken_name"),
    );

    expect(result).toEqual({ error: "That username is already in use.", success: null });
    expect(updateSession).not.toHaveBeenCalled();
  });
});
