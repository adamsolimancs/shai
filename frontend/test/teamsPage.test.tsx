import { beforeEach, describe, expect, it, vi } from "vitest";

import TeamsPage from "@/app/(main)/teams/page";
import { nbaFetch } from "@/lib/nbaApi";

vi.mock("@/lib/nbaApi", () => ({
  DEFAULT_SEASON: "2025-26",
  nbaFetch: vi.fn(async (path: string) => {
    if (path === "/v1/meta") {
      return { supported_seasons: ["2023-24", "2025-26"] };
    }
    return [];
  }),
}));

describe("teams season selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["2023-24", "2023-24"],
    ["invalid", "2025-26"],
  ])("loads season %s using the supported season %s", async (season, expected) => {
    await TeamsPage({ searchParams: Promise.resolve({ season }) });

    expect(nbaFetch).toHaveBeenCalledWith(
      `/v1/teams?season=${expected}`,
      expect.any(Object),
    );
    expect(nbaFetch).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/teams/stats?season=${expected}`),
      expect.any(Object),
    );
  });
});
