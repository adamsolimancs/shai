"use client";

import { useEffect, useState } from "react";

type LocalGameTimeProps = {
  value?: string | null;
  fallback?: string;
  className?: string;
  showTime?: boolean;
  tbdLabel?: string;
};

const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const TIME_ONLY_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT_TIME_REGEX = /T00:00:00(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function parseGameDate(value: string): { date: Date | null; hasTime: boolean } {
  if (DATE_ONLY_REGEX.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return { date: new Date(year, month - 1, day), hasTime: false };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: null, hasTime: false };
  }

  const hasTime = /T\d{2}:\d{2}/.test(value) && !MIDNIGHT_TIME_REGEX.test(value);
  if (!hasTime) {
    return { date: new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()), hasTime: false };
  }

  return { date: parsed, hasTime };
}

function formatLabel(value: string, showTime: boolean, tbdLabel: string): string {
  const { date, hasTime } = parseGameDate(value);
  if (!date) {
    return value;
  }
  const dateLabel = DATE_ONLY_FORMATTER.format(date);
  if (!showTime) {
    return dateLabel;
  }
  if (!hasTime) {
    return dateLabel;
  }
  return `${dateLabel} · ${TIME_ONLY_FORMATTER.format(date)}`;
}

export default function LocalGameTime({
  value,
  fallback,
  className,
  showTime = true,
  tbdLabel = "TBD",
}: LocalGameTimeProps) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setLabel(null);
      return;
    }
    setLabel(formatLabel(value, showTime, tbdLabel));
  }, [value, showTime, tbdLabel]);

  if (!value) {
    return fallback ? <span className={className}>{fallback}</span> : null;
  }

  return (
    <span className={className} suppressHydrationWarning>
      {label ?? fallback ?? value}
    </span>
  );
}
