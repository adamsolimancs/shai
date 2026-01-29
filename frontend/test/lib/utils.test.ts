import { describe, expect, it } from "vitest";

import { containsBannedTerm, slugifySegment, unslugifySegment } from "@/lib/utils";


describe("utils", () => {
  it("detects banned terms", () => {
    expect(containsBannedTerm("clean input")).toBe(false);
    expect(containsBannedTerm("This is ShIt")).toBe(true);
  });

  it("slugifies segments", () => {
    expect(slugifySegment("  Jalen Brunson ")).toBe("jalen-brunson");
    expect(slugifySegment("LeBron James!!!")).toBe("lebron-james");
    expect(slugifySegment(undefined)).toBe("");
  });

  it("unslugifies segments", () => {
    expect(unslugifySegment("lebron-james")).toBe("Lebron James");
    expect(unslugifySegment("")).toBe("");
  });
});
