export type SeasonalMode = "in-season" | "offseason";

export function isOffseasonDate(value: Date = new Date()): boolean {
  const month = value.getUTCMonth() + 1;
  return month >= 7 && month <= 9;
}

export function resolveSeasonalMode(
  value: Date = new Date(),
  developmentOverride?: string,
  isDevelopment = process.env.NODE_ENV !== "production",
): SeasonalMode {
  if (isDevelopment && developmentOverride === "1") return "offseason";
  if (isDevelopment && developmentOverride === "0") return "in-season";
  return isOffseasonDate(value) ? "offseason" : "in-season";
}
