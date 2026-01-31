const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT_TIME_REGEX = /T00:00:00(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

export function isFinalStatus(status?: string | null): boolean {
  if (!status) return false;
  return /(final|final\/ot|final\/2ot|game end|completed)/i.test(status);
}

export function isFinalGame(
  status?: string | null,
  dateValue?: string | null,
  homeScore?: number | null,
  awayScore?: number | null,
): boolean {
  if (isFinalStatus(status)) return true;
  if (!dateValue) return false;
  const safeHome = typeof homeScore === "number" ? homeScore : 0;
  const safeAway = typeof awayScore === "number" ? awayScore : 0;
  if (safeHome === 0 && safeAway === 0) return false;
  const parsed = parseGameDate(dateValue);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const gameDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return gameDay < today;
}

export function hasTimeInfo(value: string): boolean {
  if (!value) return false;
  if (DATE_ONLY_REGEX.test(value)) return false;
  if (MIDNIGHT_TIME_REGEX.test(value)) return false;
  return /T\d{2}:\d{2}/.test(value);
}

export function formatDateOnly(value: string, formatter: Intl.DateTimeFormat): string {
  if (!value) return "TBD";
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return formatter.format(new Date(Number(year), Number(month) - 1, Number(day)));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  if (MIDNIGHT_TIME_REGEX.test(value)) {
    return formatter.format(new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }
  return formatter.format(parsed);
}

export function buildTimeFallback(value: string, showTime: boolean, formatter: Intl.DateTimeFormat): string {
  const dateLabel = formatDateOnly(value, formatter);
  if (!showTime) return dateLabel;
  if (!hasTimeInfo(value)) {
    return dateLabel;
  }
  return dateLabel;
}

export function parseGameDate(value: string): Date {
  if (DATE_ONLY_REGEX.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  if (MIDNIGHT_TIME_REGEX.test(value)) {
    return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  }
  return parsed;
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
