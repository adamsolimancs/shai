import LocalGameTime from "@/components/LocalGameTime";
import ScoreCard from "@/components/ScoreCard";
import { buildTimeFallback, isFinalGame, parseGameDate, toDateKey } from "@/lib/gameUtils";
import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";

type Game = {
  game_id: string;
  date: string;
  start_time?: string | null;
  home_team_name: string;
  home_team_score: number;
  away_team_name: string;
  away_team_score: number;
  status?: string | null;
};

type EnhancedGame = {
  id: string;
  rawDate: string;
  timeValue: string;
  dateKey: string;
  dateLabel: string;
  timeFallback: string;
  showTime: boolean;
  status?: string;
  isFinal: boolean;
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
const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function enhanceGame(game: Game): EnhancedGame {
  const date = parseGameDate(game.date);
  const homeScore = Number.isFinite(game.home_team_score) ? game.home_team_score : 0;
  const awayScore = Number.isFinite(game.away_team_score) ? game.away_team_score : 0;
  const margin = Math.abs(homeScore - awayScore);
  const totalPoints = homeScore + awayScore;
  let winner: "home" | "away" | "even" = "even";
  if (homeScore > awayScore) winner = "home";
  if (awayScore > homeScore) winner = "away";
  const status = game.status ?? undefined;
  const isFinal = isFinalGame(status, game.date, homeScore, awayScore);
  const showTime = !isFinal;
  const statusLabel = status && /scheduled/i.test(status) ? undefined : status;
  const timeValue = game.start_time ?? game.date;

  return {
    id: game.game_id,
    rawDate: game.date,
    timeValue,
    dateKey: toDateKey(date),
    dateLabel: DATE_FORMATTER.format(date),
    timeFallback: buildTimeFallback(game.date, showTime, DATE_ONLY_FORMATTER),
    showTime,
    status: statusLabel,
    isFinal,
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
      <header className="space-y-2">
        <div>
          <p className="text-xs uppercase tracking-[0.5em] text-white/60">Season scoreboard</p>
          <h1 className="mt-3 text-4xl font-semibold text-white">Catch up on the latest NBA slate</h1>
        </div>
      </header>
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Latest results</h2>
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
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 xl:mx-auto xl:max-w-6xl xl:justify-items-center">
                  {group.games.map((game) => (
                    <ScoreCard
                      key={game.id}
                      href={`/boxscore/${game.id}`}
                      className="w-full max-w-[360px]"
                      timeLabel={<LocalGameTime value={game.timeValue} fallback={game.timeFallback} showTime={game.showTime} />}
                      status={game.status}
                      isFinal={game.isFinal}
                      home={{ name: game.home.name, score: game.home.score }}
                      away={{ name: game.away.name, score: game.away.score }}
                      winner={game.winner}
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
