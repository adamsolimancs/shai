import type { Envelope } from "@/lib/nbaApi";

export default function DataFreshness({ meta }: { meta?: Envelope<unknown>["meta"] }) {
  if (!meta?.stale) return null;
  const date = meta.as_of ? new Date(meta.as_of) : null;
  const known = date && Number.isFinite(date.getTime());
  return (
    <p role="status" className="text-sm text-amber-700 dark:text-amber-200">
      Showing older data.{" "}
      {known ? (
        <>
          Source last observed:{" "}
          <time dateTime={date.toISOString()}>
            {date.toLocaleString("en-US", {
              timeZone: "UTC", dateStyle: "medium", timeStyle: "short",
            })} UTC
          </time>.
        </>
      ) : "Source observation time is unknown."}
    </p>
  );
}
