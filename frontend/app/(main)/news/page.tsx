import Link from "next/link";

import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";

type Game = {
  game_id: string;
  date: string;
  home_team_name: string;
  home_team_score: number;
  away_team_name: string;
  away_team_score: number;
  status?: string | null;
};

type PlayerStatsRow = {
  player_id: number;
  player_name: string;
  team_abbreviation: string | null;
  points: number;
  rebounds: number;
  assists: number;
};

type StoryAccent = "highlight" | "neutral" | "alert";

type NewsStory = {
  id: string;
  tag: string;
  title: string;
  summary: string;
  timestamp: string;
  accent: StoryAccent;
};

type PulseMetric = {
  label: string;
  value: string;
  detail: string;
};

const STORY_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function describeResult(game: Game): { descriptor: string; accent: StoryAccent } {
  const margin = Math.abs(game.home_team_score - game.away_team_score);
  if (margin <= 3) return { descriptor: "edges", accent: "alert" };
  if (margin >= 15) return { descriptor: "dominates", accent: "highlight" };
  return { descriptor: "tops", accent: "neutral" };
}

function buildGameStories(games: Game[]): NewsStory[] {
  return games.map((game) => {
    const winnerIsHome = game.home_team_score >= game.away_team_score;
    const winner = winnerIsHome ? game.home_team_name : game.away_team_name;
    const loser = winnerIsHome ? game.away_team_name : game.home_team_name;
    const { descriptor, accent } = describeResult(game);
    const margin = Math.abs(game.home_team_score - game.away_team_score);
    const total = game.home_team_score + game.away_team_score;
    const timestamp = new Date(game.date).toISOString();

    const scoreline = `${game.away_team_name} ${game.away_team_score} @ ${game.home_team_name} ${game.home_team_score}`;

    return {
      id: `game-${game.game_id}`,
      tag: "Game recap",
      title: `${winner} ${descriptor} ${loser}`,
      summary: `${scoreline} (${game.status ?? "Final"}). ${winner} ${descriptor} ${loser} by ${margin}. Combined output: ${total} points.`,
      timestamp,
      accent,
    };
  });
}

function buildPlayerStories(stats: PlayerStatsRow[]): NewsStory[] {
  return stats.map((row, index) => {
    const timestamp = new Date(Date.now() - index * 60 * 60 * 1000).toISOString();
    return {
      id: `player-${row.player_id}`,
      tag: "Player spotlight",
      title: `${row.player_name} keeps stuffing the sheet`,
      summary: `${row.player_name} is pacing ${row.points.toFixed(1)} / ${row.rebounds.toFixed(1)} / ${row.assists.toFixed(1)} per night for ${row.team_abbreviation ?? "FA"}.`,
      timestamp,
      accent: "highlight",
    };
  });
}

function formatStoryTime(value: string) {
  return STORY_DATE.format(new Date(value));
}

function accentClasses(accent: StoryAccent) {
  switch (accent) {
    case "highlight":
      return "border-blue-400/30 bg-blue-500/10";
    case "alert":
      return "border-amber-300/40 bg-amber-200/10";
    default:
      return "border-white/10 bg-slate-950/60";
  }
}

export default async function NewsPage() {
  const [games, stats] = await Promise.all([
    nbaFetch<Game[]>(`/v1/games?season=${DEFAULT_SEASON}&page_size=24`),
    nbaFetch<PlayerStatsRow[]>(`/v1/players/stats?season=${DEFAULT_SEASON}&page_size=12`),
  ]);

  const recaps = buildGameStories(games.slice(0, 8));
  const playerAngles = buildPlayerStories(stats.slice(0, 4));
  const stories = [...recaps, ...playerAngles].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 10);

  const pulseAggregate = games.slice(0, 12).reduce(
    (acc, game) => {
      const total = game.home_team_score + game.away_team_score;
      const margin = Math.abs(game.home_team_score - game.away_team_score);
      acc.totals += total;
      acc.count += 1;
      acc.dates.add(game.date);
      if (margin <= 5) acc.clutch += 1;
      if (margin > acc.largestMargin) {
        acc.largestMargin = margin;
        acc.largestLabel = `${game.home_team_name} vs ${game.away_team_name}`;
      }
      return acc;
    },
    {
      totals: 0,
      count: 0,
      clutch: 0,
      largestMargin: 0,
      largestLabel: "",
      dates: new Set<string>(),
    },
  );

  const averageTotal = pulseAggregate.count ? `${Math.round(pulseAggregate.totals / pulseAggregate.count)}` : "—";
  const clutchRate = pulseAggregate.count ? `${Math.round((pulseAggregate.clutch / pulseAggregate.count) * 100)}%` : "—";
  const biggestSwing = pulseAggregate.largestMargin ? `${pulseAggregate.largestMargin} pts` : "—";
  const pulseMetrics: PulseMetric[] = [
    { label: "Avg total score", value: averageTotal, detail: `Across ${pulseAggregate.count} recent games` },
    { label: "Close finish rate", value: clutchRate, detail: "≤5 point margins" },
    {
      label: "Biggest rout",
      value: biggestSwing,
      detail: pulseAggregate.largestLabel || "Awaiting results",
    },
  ];

  return (
    <div className="space-y-12">
      <header className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.5em] text-blue-300/80">League notebook</p>
          <h1 className="mt-3 text-4xl font-semibold text-white">Newsworthy runs, powered by data</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/70">
            We turn fresh box scores and league dashboards into story-ready blurbs. Use this feed to brief a broadcast, prep for a
            podcast hit, or simply keep tabs on trend lines without sifting through dozens of tabs.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-white/60">
          <span className="rounded-full border border-white/10 px-4 py-1">Season {DEFAULT_SEASON}</span>
          <span className="rounded-full border border-white/10 px-4 py-1">Stories refresh with every API cache update</span>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-white/40">Top stories</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Instant recaps & talking points</h2>
            </div>
            <span className="text-xs uppercase tracking-[0.3em] text-white/60">Sourced from /v1/games & /v1/players/stats</span>
          </div>
          {stories.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-10 text-center text-white/70">
              No stories yet—check back after the first slate posts scores.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {stories.map((story) => (
                <article key={story.id} className={`rounded-3xl border p-5 transition ${accentClasses(story.accent)}`}>
                  <p className="text-xs uppercase tracking-[0.4em] text-white/50">{story.tag}</p>
                  <h3 className="mt-3 text-xl font-semibold text-white">{story.title}</h3>
                  <p className="mt-2 text-sm text-white/70">{story.summary}</p>
                  <div className="mt-4 flex items-center justify-between text-xs text-white/60">
                    <span>{formatStoryTime(story.timestamp)}</span>
                    <span>{story.accent === "alert" ? "Tight finish" : story.accent === "highlight" ? "Statement" : "Final"}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <aside className="space-y-6">
          <article className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
            <p className="text-xs uppercase tracking-[0.4em] text-white/40">League pulse</p>
            <ul className="mt-4 space-y-4 text-sm text-white/80">
              {pulseMetrics.map((metric) => (
                <li key={metric.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{metric.value}</p>
                  <p className="text-xs text-white/60">{metric.detail}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-white/60">
              Coverage window spans {pulseAggregate.dates.size || "n/a"} unique dates from the latest response.
            </p>
          </article>
          <article className="rounded-3xl border border-white/10 bg-slate-950/60 p-5 space-y-3">
            <p className="text-xs uppercase tracking-[0.4em] text-white/40">Keep exploring</p>
            <Link href="/scores" className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/40">
              Tonight&apos;s scoreboard →
            </Link>
            <Link href="/players" className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/40">
              Deep dive on players →
            </Link>
            <Link href="/teams" className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:border-white/40">
              Team directory →
            </Link>
          </article>
        </aside>
      </section>
    </div>
  );
}
