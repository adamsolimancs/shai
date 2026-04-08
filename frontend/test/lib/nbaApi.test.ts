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
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
});
