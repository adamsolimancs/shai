import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const incoming = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: incoming.headers }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("BACKEND_API_KEY", "test-service-secret");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
  incoming.headers.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const identity = (ip: string) => createHmac("sha256", "test-service-secret").update(`visitor:v1:${ip}`).digest("hex");

describe("trusted visitor forwarding", () => {
  it("overwrites service auth and removes caller-supplied identities without trusted ingress", async () => {
    const { backendHeaders } = await import("@/lib/backendHeaders");
    const result = await backendHeaders({ "x-api-key": "fake", "x-shai-visitor-id": "a".repeat(64) });
    expect(result.get("x-api-key")).toBe("test-service-secret");
    expect(result.has("x-shai-visitor-id")).toBe(false);
    expect(incoming.headers).not.toHaveBeenCalled();
  });

  it("keeps a stable opaque Vercel identity and isolates different visitors", async () => {
    vi.stubEnv("VERCEL", "1");
    incoming.headers.mockResolvedValue(new Headers({ "x-vercel-forwarded-for": "192.0.2.1", "x-forwarded-for": "198.51.100.99", "x-shai-visitor-id": "fake" }));
    const { backendHeaders } = await import("@/lib/backendHeaders");
    const first = await backendHeaders();
    expect(first.get("x-shai-visitor-id")).toBe(identity("192.0.2.1"));
    expect((await backendHeaders()).get("x-shai-visitor-id")).toBe(first.get("x-shai-visitor-id"));
    incoming.headers.mockResolvedValue(new Headers({ "x-vercel-forwarded-for": "192.0.2.2" }));
    expect((await backendHeaders()).get("x-shai-visitor-id")).not.toBe(first.get("x-shai-visitor-id"));
    expect(first.has("x-forwarded-for")).toBe(false);
  });

  it.each(["192.0.2.1, 198.51.100.1", "invalid", "", "192.0.2.1:123", "fe80::1%lo0"])("ignores invalid or ambiguous ingress IP: %s", async (ip) => {
    vi.stubEnv("VERCEL", "1");
    incoming.headers.mockResolvedValue(new Headers({ "x-vercel-forwarded-for": ip }));
    const { backendHeaders } = await import("@/lib/backendHeaders");
    expect((await backendHeaders()).has("x-shai-visitor-id")).toBe(false);
  });

  it("normalizes equivalent IPv6 addresses", async () => {
    vi.stubEnv("VERCEL", "1");
    incoming.headers.mockResolvedValue(new Headers({ "x-vercel-forwarded-for": "2001:db8::1" }));
    const { backendHeaders } = await import("@/lib/backendHeaders");
    const first = (await backendHeaders()).get("x-shai-visitor-id");
    incoming.headers.mockResolvedValue(new Headers({ "x-vercel-forwarded-for": "2001:0db8:0:0:0:0:0:1" }));
    expect((await backendHeaders()).get("x-shai-visitor-id")).toBe(first);
  });

  it("supports an explicitly configured ingress and calls without request context", async () => {
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-test-ingress-ip");
    incoming.headers.mockResolvedValue(new Headers({ "x-test-ingress-ip": "192.0.2.1" }));
    const { backendHeaders } = await import("@/lib/backendHeaders");
    expect((await backendHeaders()).get("x-shai-visitor-id")).toBe(identity("192.0.2.1"));
    incoming.headers.mockRejectedValue(new Error("outside request context"));
    expect((await backendHeaders()).has("x-shai-visitor-id")).toBe(false);
  });

  it("propagates the same identity through stats and account requests", async () => {
    vi.stubEnv("VERCEL", "1");
    incoming.headers.mockResolvedValue(new Headers({ "x-vercel-forwarded-for": "192.0.2.1" }));
    const sent: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers));
      return new Response(JSON.stringify({ ok: true, data: {}, meta: {} }));
    }));
    const { nbaFetch } = await import("@/lib/nbaApi");
    const { syncUserAccount } = await import("@/lib/userAccountsApi");
    await nbaFetch("/v1/meta");
    await syncUserAccount({ auth_user_id: "google:1", email: "test@example.test", email_verified: true });
    expect(sent.map(value => value.get("x-shai-visitor-id"))).toEqual([identity("192.0.2.1"), identity("192.0.2.1")]);
    expect(sent[1].get("Content-Type")).toBe("application/json");
  });
});
