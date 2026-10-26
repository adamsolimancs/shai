import { afterEach, expect, it, vi } from "vitest";
import { isFinalGame } from "@/lib/gameUtils";

afterEach(() => vi.useRealTimers());

it("respects an explicit live status after the calendar date changes", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  expect(isFinalGame("Q3 04:12", "2026-10-25", 90, 85)).toBe(false);
  expect(isFinalGame("Final", "2026-10-26", 110, 105)).toBe(true);
  expect(isFinalGame(null, "2026-10-25", 110, 105)).toBe(true);
});
