import { readFile } from "node:fs/promises";
import { nbaFetchEnvelope, type Envelope } from "@/lib/nbaApi";
import type { OvernightSnapshot } from "@/lib/statsSearch";

export async function fetchRecentResults(): Promise<Envelope<OvernightSnapshot | null>> {
  const localPath = process.env.HOOPR_LOCAL_SNAPSHOT_PATH;
  if (process.env.NODE_ENV === "development" && localPath) {
    const data: OvernightSnapshot = JSON.parse(await readFile(localPath, "utf8"));
    return {
      ok: true,
      data,
      meta: { source: "hoopR", as_of: data.observed_at, stale: false },
    };
  }
  return nbaFetchEnvelope<OvernightSnapshot | null>("/v1/poc/last-night");
}
