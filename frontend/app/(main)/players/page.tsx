import MagicBentoLeaderboardGrid from "@/components/MagicBentoLeaderboardGrid";
import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";

type LeagueLeaderRow = {
  player_id: number;
  rank: number;
  player_name: string;
  team_abbreviation: string | null;
  stat_value: number;
  stat_category: string;
};

type LeaderStatCategory = "PTS" | "REB" | "AST" | "STL" | "BLK";

type Leaderboard = {
  id: string;
  label: string;
  metric: string;
  category: LeaderStatCategory;
  digits?: number;
  rows: LeagueLeaderRow[];
};

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

const LEADER_LIMIT = 5;
const LEADERBOARDS: Array<Omit<Leaderboard, "rows">> = [
  { id: "points", label: "Scoring leaders", metric: "PTS", category: "PTS" },
  { id: "rebounds", label: "Glass cleaners", metric: "REB", category: "REB" },
  { id: "assists", label: "Assist leaders", metric: "AST", category: "AST" },
  { id: "steals", label: "Pickpockets", metric: "STL", category: "STL" },
  { id: "blocks", label: "Rim protectors", metric: "BLK", category: "BLK" },
];

function extractParam(params: SearchParams, key: string): string {
  const raw = params[key];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0] ?? "";
  return "";
}

type PlayersPageProps = {
  searchParams?: SearchParams | Promise<SearchParams>;
};

async function fetchLeaders(
  category: LeaderStatCategory,
  seasonType: string,
): Promise<LeagueLeaderRow[]> {
  const params = new URLSearchParams({
    season: DEFAULT_SEASON,
    season_type: seasonType,
    per_mode: "PerGame",
    stat_category: category,
    limit: String(LEADER_LIMIT),
  });
  return nbaFetch<LeagueLeaderRow[]>(`/v1/league/leaders?${params.toString()}`);
}

export default async function PlayersPage({ searchParams }: PlayersPageProps) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const seasonTypeParam = extractParam(resolvedSearchParams, "season_type");
  const seasonType =
    seasonTypeParam.toLowerCase() === "playoffs" ? "Playoffs" : "Regular Season";

  const leaderboardsRows = await Promise.all(
    LEADERBOARDS.map((board) => fetchLeaders(board.category, seasonType)),
  );

  const leaderboards: Leaderboard[] = LEADERBOARDS.map((board, index) => ({
    ...board,
    rows: leaderboardsRows[index] ?? [],
  }));

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Leaderboards</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            {seasonType === "Playoffs" ? "Playoff Leaders" : "Season Leaders"}
          </h2>
          <p className="mt-1 text-xs uppercase tracking-[0.28em] text-white/45">Per game</p>
        </div>
        <MagicBentoLeaderboardGrid leaderboards={leaderboards} />
      </section>
    </div>
  );
}
