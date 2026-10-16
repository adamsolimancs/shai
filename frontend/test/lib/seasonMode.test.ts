import { describe, expect, it } from "vitest";
import { isOffseasonDate, resolveSeasonalMode } from "@/lib/seasonMode";

describe("season mode", () => {
  it.each([
    ["2026-07-01T00:00:00Z", true],
    ["2026-09-30T23:59:59Z", true],
    ["2026-06-30T23:59:59Z", false],
    ["2026-10-01T00:00:00Z", false],
  ])("classifies %s", (value, expected) => {
    expect(isOffseasonDate(new Date(value))).toBe(expected);
  });

  it("honors overrides only in development", () => {
    const january = new Date("2026-01-15T12:00:00Z");
    const august = new Date("2026-08-15T12:00:00Z");
    expect(resolveSeasonalMode(january, "1", true)).toBe("offseason");
    expect(resolveSeasonalMode(august, "0", true)).toBe("in-season");
    expect(resolveSeasonalMode(january, "1", false)).toBe("in-season");
    expect(resolveSeasonalMode(august, "0", false)).toBe("offseason");
  });
});
