import ScoreCard from "@/components/ScoreCard";
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

type EnhancedGame = {
  id: string;
  dateKey: string;
  dateLabel: string;
  tipLabel: string;
  status: string;
  home: { name: string; score: number };
  away: { name: string; score: number };
  winner: "home" | "away" | "even";
  margin: number;
  totalPoints: number;
};

type HighlightMetric = {
  label: string;
  value: string;
  subtext: string;
};

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" });
const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function enhanceGame(game: Game): EnhancedGame {
  const date = new Date(game.date);
  const homeScore = Number.isFinite(game.home_team_score) ? game.home_team_score : 0;
  const awayScore = Number.isFinite(game.away_team_score) ? game.away_team_score : 0;
  const margin = Math.abs(homeScore - awayScore);
  const totalPoints = homeScore + awayScore;
  let winner: "home" | "away" | "even" = "even";
  if (homeScore > awayScore) winner = "home";
  if (awayScore > homeScore) winner = "away";

  return {
    id: game.game_id,
    dateKey: date.toISOString().slice(0, 10),
    dateLabel: DATE_FORMATTER.format(date),
    tipLabel: TIME_FORMATTER.format(date),
    status: game.status || "Final",
    home: { name: game.home_team_name, score: homeScore },
    away: { name: game.away_team_name, score: awayScore },
    winner,
    margin,
    totalPoints,
  };
}

function groupGamesByDate(games: EnhancedGame[]): { date: string; label: string; games: EnhancedGame[] }[] {
  const map = new Map<string, { label: string; games: EnhancedGame[] }>();
  games.forEach((game) => {
    if (!map.has(game.dateKey)) {
      map.set(game.dateKey, { label: game.dateLabel, games: [] });
    }
    map.get(game.dateKey)!.games.push(game);
  });

  return [...map.entries()]
    .map(([date, value]) => ({ date, label: value.label, games: value.games }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function deriveHighlights(games: EnhancedGame[]): HighlightMetric[] {
  if (!games.length) {
    return [
      { label: "Average points", value: "—", subtext: "No games available" },
      { label: "Close finishes", value: "—", subtext: "Awaiting schedule" },
      { label: "Largest margin", value: "—", subtext: "Awaiting schedule" },
    ];
  }

  const aggregate = games.reduce(
    (acc, game) => {
      acc.totalPoints += game.totalPoints;
      if (game.margin <= 5) acc.clutch += 1;
      if (!acc.largest || game.margin > acc.largest.margin) acc.largest = game;
      return acc;
    },
    { totalPoints: 0, clutch: 0, largest: games[0] } as {
      totalPoints: number;
      clutch: number;
      largest: EnhancedGame;
    },
  );

  const averagePoints = Math.round(aggregate.totalPoints / games.length);
  const largest = aggregate.largest;

  return [
    {
      label: "Average combined points",
      value: `${averagePoints}`,
      subtext: `${games.length} game sample across ${DEFAULT_SEASON}`,
    },
    {
      label: "One-possession finishes",
      value: `${aggregate.clutch}`,
      subtext: "Decided by five or fewer points",
    },
    {
      label: "Largest margin",
      value: `${largest.margin} pts`,
      subtext: `${largest.home.name} vs ${largest.away.name}`,
    },
  ];
}

function formatTrendLabel(trend: string) {
  return trend.toUpperCase();
}

export default async function ScoresPage() {
  const games = await nbaFetch<Game[]>(`/v1/games?season=${DEFAULT_SEASON}&page_size=36`);
  const enhanced = games.map(enhanceGame);
  const highlights = deriveHighlights(enhanced);
  const grouped = groupGamesByDate(enhanced);
  const statementGame =
    enhanced.length > 0
      ? enhanced.reduce((prev, game) => (game.totalPoints > prev.totalPoints ? game : prev))
      : null;
  const tightGames = enhanced.filter((game) => game.margin <= 3).slice(0, 4);
  const blowouts = enhanced.filter((game) => game.margin >= 18).slice(0, 4);

  return (
    <div className="space-y-12">
      <header className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.5em] text-white/60">Season scoreboard</p>
          <h1 className="mt-3 text-4xl font-semibold text-white">Catch up on the latest NBA slate</h1>
        </div>
        <dl className="grid gap-4 rounded-3xl border border-white/10 bg-slate-950/40 p-6 text-center sm:grid-cols-3">
          {highlights.map((metric) => (
            <div key={metric.label} className="space-y-2">
              <dt className="text-xs uppercase tracking-[0.4em] text-white/40">{metric.label}</dt>
              <dd className="text-3xl font-semibold text-white">{metric.value}</dd>
              <p className="text-xs text-white/60">{metric.subtext}</p>
            </div>
          ))}
        </dl>
      </header>

      <section className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Game log</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Latest results</h2>
        </div>
        {grouped.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-10 text-center text-white/70">
            No games have been loaded for {DEFAULT_SEASON} yet. Once the API cache warms up, fresh scores will appear here.
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map((group) => (
              <div key={group.date} className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold tracking-[0.3em] text-white/60">{group.label}</p>
                  <span className="text-xs uppercase text-white/60">{group.games.length} games</span>
                </div>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {group.games.map((game) => (
                    <ScoreCard
                      key={game.id}
                      href={`/boxscore/${game.id}`}
                      variant="scoreboard"
                      timeLabel={game.tipLabel}
                      status={game.status}
                      home={{ name: game.home.name, score: game.home.score }}
                      away={{ name: game.away.name, score: game.away.score }}
                      winner={game.winner}
                      footerLabel={`Margin: ${game.margin === 0 ? "OT thriller" : `${game.margin} pts`}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
