import { NextResponse } from "next/server";

import type { SearchSuggestion } from "@/components/SearchCombobox";
import { nbaFetch } from "@/lib/nbaApi";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const requestedLimit = Number(url.searchParams.get("limit") ?? "8");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 20)
    : 8;

  if (query.length < 2) {
    return NextResponse.json<SearchSuggestion[]>([]);
  }

  try {
    const suggestions = await nbaFetch<SearchSuggestion[]>(
      `/v1/search/suggestions?q=${encodeURIComponent(query)}&limit=${limit}`,
      { cache: "no-store", signal: request.signal, timeoutMs: 5_000 },
    );
    return NextResponse.json(suggestions);
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    const message = error instanceof Error ? error.message : "Search suggestions failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
