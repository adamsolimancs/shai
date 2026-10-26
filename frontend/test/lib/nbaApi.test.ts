import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  clone: () => FetchResponse;
};

const makeResponse = (payload: unknown, ok = true, status = 200): FetchResponse => {
  const response: FetchResponse = {
    ok,
    status,
    json: async () => payload,
    clone: () => response,
  };
  return response;
};

describe("nbaFetch", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NBA_DEFAULT_SEASON;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws when API key is missing", async () => {
    delete process.env.BACKEND_API_KEY;
    const { nbaFetch } = await import("@/lib/nbaApi");

    await expect(nbaFetch("/players")).rejects.toThrow(
      /BACKEND_API_KEY must be set to call the backend/i,
    );
  });

  it("returns data for ok responses", async () => {
    process.env.BACKEND_API_KEY = "test-key";
    const fetchSpy = vi.fn(async () => makeResponse({ ok: true, data: { id: 1 }, meta: {} }));
    vi.stubGlobal("fetch", fetchSpy);

    const { nbaFetch } = await import("@/lib/nbaApi");
    const data = await nbaFetch<{ id: number }>("/players/1");

    expect(data).toEqual({ id: 1 });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("throws with backend error message", async () => {
    process.env.BACKEND_API_KEY = "test-key";
    const fetchSpy = vi.fn(async () =>
      makeResponse({
        ok: false,
        error: { code: "FAIL", message: "Bad request" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { nbaFetch } = await import("@/lib/nbaApi");

    await expect(nbaFetch("/players/1")).rejects.toThrow("Bad request");
  });

  it("throws when HTTP response is not ok", async () => {
    process.env.BACKEND_API_KEY = "test-key";
    const fetchSpy = vi.fn(async () =>
      makeResponse({
        error: { message: "Not found" },
      }, false, 404),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { nbaFetch } = await import("@/lib/nbaApi");

    await expect(nbaFetch("/players/1")).rejects.toThrow("Not found");
  });

  it.each([200, 503])("times out while reading a stalled %s response body", async (status) => {
    process.env.BACKEND_API_KEY = "test-key";
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const response = makeResponse(null, status === 200, status);
      response.json = () => new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
      });
      return response;
    }));
    const { nbaFetch } = await import("@/lib/nbaApi");

    const rejected = expect(nbaFetch("/players/1", { timeoutMs: 50 }))
      .rejects.toThrow("NBA API request timed out after 50ms");
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the caller abort listener after a completed request", async () => {
    process.env.BACKEND_API_KEY = "test-key";
    const caller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requestSignal = init.signal;
      return makeResponse({ ok: true, data: [] });
    }));
    const { nbaFetch } = await import("@/lib/nbaApi");

    await nbaFetch("/players", { signal: caller.signal });
    caller.abort();

    expect(requestSignal?.aborted).toBe(false);
  });

  it("derives the NBA season from the calendar instead of a fixed default", async () => {
    const { seasonForDate } = await import("@/lib/nbaApi");

    expect(seasonForDate(new Date("2026-09-30T12:00:00Z"))).toBe("2025-26");
    expect(seasonForDate(new Date("2026-10-01T00:00:00Z"))).toBe("2026-27");
  });

  it("allows an explicit season override", async () => {
    process.env.NBA_DEFAULT_SEASON = "2030-31";

    const { DEFAULT_SEASON } = await import("@/lib/nbaApi");

    expect(DEFAULT_SEASON).toBe("2030-31");
  });
});

describe("freshness metadata", () => {
  it("preserves nullable observation time, source and stale status", async () => {
    process.env.BACKEND_API_KEY = "test-key";
    const envelope = { ok: true, data: [], meta: { source: "db", as_of: null, stale: true } };
    vi.stubGlobal("fetch", vi.fn(async () => makeResponse(envelope)));
    const { nbaFetchEnvelope } = await import("@/lib/nbaApi");
    expect(await nbaFetchEnvelope("/games")).toEqual(envelope);
    vi.unstubAllGlobals();
  });

  it("uses the oldest observation and preserves unknown constituents", async () => {
    const { combineFreshness } = await import("@/lib/nbaApi");
    const old = { source: "db", as_of: "2026-01-15T18:30:00Z", stale: true };
    const fresh = { source: "redis", as_of: "2026-01-16T18:30:00Z", stale: false };
    expect(combineFreshness([old, fresh])).toMatchObject({ as_of: "2026-01-15T18:30:00.000Z", stale: true });
    expect(combineFreshness([old, { ...fresh, as_of: null }]).as_of).toBeNull();
  });
});
