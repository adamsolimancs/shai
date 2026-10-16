import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { LeagueStandings, type LeagueStandingsConference } from "@/components/LeagueStandings";
import HeroSearch from "@/components/HeroSearch";
import LocalGameTime from "@/components/LocalGameTime";
import ScoreCard from "@/components/ScoreCard";
import StarBorder from "@/components/StarBorder";
import DevOffseasonToggle from "@/components/DevOffseasonToggle";
import OffseasonHome, { type FinalsSummary, type OffseasonLeader } from "@/components/OffseasonHome";
import { buildTimeFallback, isFinalGame } from "@/lib/gameUtils";
import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";
import { resolveSeasonalMode } from "@/lib/seasonMode";
import { slugifySegment } from "@/lib/utils";

const SITE_URL = "https://shaistats.vercel.app";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  url: `${SITE_URL}/`,
  name: "ShAI",
  description: "Explore NBA scores, player and team profiles, standings, and advanced stats.",
  inLanguage: "en-US",
};

type Game = {
  game_id: string;
  date: string;
  start_time?: string | null;
  home_team_name: string;
  home_team_score: number;
  away_team_name: string;
  away_team_score: number;
  status?: string | null;
  location?: string | null;
};

type PlayerStatsRow = {
  player_id: number;
  player_name?: string | null;
  playerName?: string | null;
  name?: string | null;
  full_name?: string | null;
  team_abbreviation: string | null;
  points: number;
  rebounds: number;
  assists: number;
};

type ScoreCardData = {
  id: string;
  away: string;
  awayScore: number;
  home: string;
  homeScore: number;
  status: string;
  isFinal: boolean;
  date: string;
  timeValue: string;
  timeFallback: string;
  showTime: boolean;
  location?: string;
};

type PlayerHighlight = {
  id: number;
  name: string;
  team: string;
  points: number;
  rebounds: number;
  assists: number;
};

type PlayerInfo = {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type LeagueStanding = {
  team_id: number;
  team_name: string;
  team_city: string;
  team_slug?: string | null;
  team_abbreviation?: string | null;
  conference?: string | null;
  conference_rank?: number | null;
  division?: string | null;
  division_rank?: number | null;
  wins: number;
  losses: number;
  win_pct: number;
  record?: string | null;
  home_record?: string | null;
  road_record?: string | null;
  last_ten?: string | null;
  streak?: string | null;
  eliminated_conference?: boolean | number | null;
};

type NewsArticle = {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published_at: string;
  image_url?: string | null;
};

type LeaderStatCategory = "PTS" | "REB" | "AST" | "STL" | "BLK";

const OFFSEASON_LEADERBOARDS = [
  { label: "Points", metric: "PPG", category: "PTS" as const },
  { label: "Rebounds", metric: "RPG", category: "REB" as const },
  { label: "Assists", metric: "APG", category: "AST" as const },
  { label: "Blocks", metric: "BPG", category: "BLK" as const },
];

const NEWS_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const HOME_DATE_FALLBACK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

async function fetchRecentGames(): Promise<ScoreCardData[]> {
  const games = await nbaFetch<Game[]>(`/v1/games?season=${DEFAULT_SEASON}&page_size=6`, { next: { revalidate: 120 } });
  return games.slice(0, 6).map((game) => {
    const status = game.status ?? "Scheduled";
    const isFinal = isFinalGame(status, game.date, game.home_team_score, game.away_team_score);
    const showTime = !isFinal;
    const timeValue = game.start_time ?? game.date;
    return {
      id: game.game_id,
      away: game.away_team_name ?? "Away",
      awayScore: game.away_team_score ?? 0,
      home: game.home_team_name ?? "Home",
      homeScore: game.home_team_score ?? 0,
      status,
      isFinal,
      date: game.date,
      timeValue,
      timeFallback: buildTimeFallback(game.date, showTime, HOME_DATE_FALLBACK),
      showTime,
      location: game.location?.trim() || undefined,
    };
  });
}

async function fetchPlayerHighlights(): Promise<PlayerHighlight[]> {
  const stats = await nbaFetch<PlayerStatsRow[]>(
    `/v1/players/stats?season=${DEFAULT_SEASON}&measure=Base&per_mode=PerGame&page_size=200`,
    { next: { revalidate: 300 } },
  );
  const placeholderNamePattern = /^Player \d+$/;

  const resolvePlayerName = (player: PlayerStatsRow): string => {
    const candidates = [player.player_name, player.playerName, player.name, player.full_name];
    for (const candidate of candidates) {
      const value = candidate?.trim();
      if (value) {
        return value;
      }
    }
    return `Player ${player.player_id}`;
  };

  const topPlayers = [...stats]
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);

  return Promise.all(
    topPlayers.map(async (player) => {
      let name = resolvePlayerName(player);
      if (placeholderNamePattern.test(name)) {
        try {
          const info = await nbaFetch<PlayerInfo | null>(`/v1/players/${player.player_id}/info`, {
            next: { revalidate: 300 },
          });
          const fallbackName = info?.display_name?.trim();
          if (fallbackName) {
            name = fallbackName;
          } else {
            const composed = [info?.first_name, info?.last_name].filter(Boolean).join(" ").trim();
            if (composed) {
              name = composed;
            }
          }
        } catch {
          // Keep deterministic placeholder when player profile info isn't available.
        }
      }
      return {
        id: player.player_id,
        name,
        team: player.team_abbreviation ?? "FA",
        points: player.points,
        rebounds: player.rebounds,
        assists: player.assists,
      };
    }),
  );
}

async function fetchLeagueStandings(): Promise<LeagueStanding[]> {
  return nbaFetch<LeagueStanding[]>(
    `/v1/league_standings?season=${DEFAULT_SEASON}&league_id=00&season_type=Regular%20Season`,
    { next: { revalidate: 900 } },
  );
}

async function fetchNews(): Promise<NewsArticle[]> {
  return nbaFetch<NewsArticle[]>("/v1/news", { next: { revalidate: 300 } });
}

async function fetchLeaders(category: LeaderStatCategory, seasonType = "Regular Season", limit = 5) {
  const params = new URLSearchParams({
    season: DEFAULT_SEASON,
    season_type: seasonType,
    per_mode: "PerGame",
    stat_category: category,
    limit: String(limit),
  });
  return nbaFetch<OffseasonLeader[]>(`/v1/league/leaders?${params.toString()}`, {
    next: { revalidate: 900 },
  });
}

async function fetchFinalsSummary(): Promise<FinalsSummary> {
  const endYear = Number(DEFAULT_SEASON.slice(0, 4)) + 1;
  const games = await nbaFetch<Game[]>(
    `/v1/games?season=${DEFAULT_SEASON}&date_from=${endYear}-06-01&date_to=${endYear}-06-30&page_size=50`,
    { next: { revalidate: 3600 }, timeoutMs: 3000 },
  );
  const completed = games.filter((game) => isFinalGame(game.status ?? "", game.date, game.home_team_score, game.away_team_score));
  const latest = completed.toSorted((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) return null;
  const finalists = [latest.home_team_name, latest.away_team_name].toSorted();
  const finalsGames = completed.filter((game) =>
    [game.home_team_name, game.away_team_name].toSorted().every((team, index) => team === finalists[index]),
  );
  if (finalsGames.length === 0) return null;

  const totals = new Map<string, { wins: number; points: number }>(finalists.map((team) => [team, { wins: 0, points: 0 }]));
  for (const game of finalsGames) {
    const home = totals.get(game.home_team_name)!;
    const away = totals.get(game.away_team_name)!;
    home.points += game.home_team_score;
    away.points += game.away_team_score;
    if (game.home_team_score > game.away_team_score) home.wins += 1;
    if (game.away_team_score > game.home_team_score) away.wins += 1;
  }
  const [champion, finalist] = finalists.toSorted((a, b) => totals.get(b)!.wins - totals.get(a)!.wins);
  return {
    champion,
    finalist,
    championWins: totals.get(champion)!.wins,
    finalistWins: totals.get(finalist)!.wins,
    championPoints: totals.get(champion)!.points / finalsGames.length,
    finalistPoints: totals.get(finalist)!.points / finalsGames.length,
  };
}

function formatNewsDate(value: string): string {
  return NEWS_DATE.format(new Date(value));
}

function formatStandingRecord(row: LeagueStanding): string {
  return `${row.wins}-${row.losses}`;
}

function formatStandingTeamName(row: LeagueStanding): string {
  const full = `${row.team_city ?? ""} ${row.team_name ?? ""}`.trim();
  return full || row.team_name || row.team_abbreviation || "—";
}

function formatWinPercent(value?: number): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(3);
}

function buildConferenceBuckets(rows: LeagueStanding[]) {
  return ["East", "West"].map((label) => ({
    conference: label,
    teams: rows
      .filter((row) => (row.conference ?? "").toLowerCase() === label.toLowerCase())
      .sort((a, b) => (a.conference_rank ?? 99) - (b.conference_rank ?? 99)),
  }));
}

const SectionTitle = ({
  title,
  eyebrow,
  link,
}: {
  title: string;
  eyebrow: string;
  link?: { href: string; label: string };
}) => (
  <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p className="text-[0.6rem] uppercase tracking-[0.3em] text-blue-300/80 sm:text-xs sm:tracking-[0.35em]">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">{title}</h2>
    </div>
    {link ? (
      <Link
        href={link.href}
        className="text-sm font-semibold text-blue-200 transition hover:text-blue-100"
      >
        {link.label}
      </Link>
    ) : null}
  </div>
);

const HeroSection = () => (
  <section className="flex flex-col gap-8 text-center sm:gap-12 md:gap-16">
    <div>
      <h1 className="pb-2 text-3xl tracking-[0.12em] text-(--foreground) sm:text-4xl sm:tracking-[0.16em] md:text-5xl md:tracking-[0.2em]">
        WELCOME TO ShAI
      </h1>
      <p className="mt-3 text-sm text-(--foreground-muted)/70 sm:mt-4 sm:text-base md:text-lg">
        NBA scores, player insights, standings, and advanced stats in one place.
      </p>
    </div>
    <Suspense
      fallback={
        <div
          className="skeleton-block mx-auto h-[52px] w-full max-w-3xl rounded-full border border-white/10 bg-white/5 sm:h-[68px]"
          aria-hidden="true"
        />
      }
    >
      <HeroSearch />
    </Suspense>
  </section>
);

function settledSection<T>(
  section: string,
  result: PromiseSettledResult<T>,
  fallback: T,
): T {
  if (result.status === "fulfilled") {
    return result.value;
  }
  console.error(`Homepage ${section} section failed to load`, result.reason);
  return fallback;
}

type HomePageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function HomePage({ searchParams }: HomePageProps) {
  const params: Record<string, string | string[] | undefined> = searchParams
    ? await searchParams
    : {};
  const override = typeof params.offseason === "string" ? params.offseason : undefined;
  const isOffseason = resolveSeasonalMode(new Date(), override) === "offseason";

  if (isOffseason) {
    const [scorersResult, playoffsResult, finalsResult, ...leaderResults] = await Promise.allSettled([
      fetchLeaders("PTS"),
      fetchLeaders("PTS", "Playoffs"),
      fetchFinalsSummary(),
      ...OFFSEASON_LEADERBOARDS.map((board) => fetchLeaders(board.category, "Regular Season", 1)),
    ]);
    const topScorers = settledSection("top scorers", scorersResult, []);
    const playoffLeaders = settledSection("playoff leaders", playoffsResult, []);
    // Finals snapshots may not be ingested yet; absence is a supported offseason state.
    const finals = finalsResult.status === "fulfilled" ? finalsResult.value : null;
    const leaderboards = OFFSEASON_LEADERBOARDS.map((board, index) => ({
      label: board.label,
      metric: board.metric,
      rows: settledSection(`${board.label} leaders`, leaderResults[index], []),
    }));
    return <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c") }} />
      <HeroSection />
      <OffseasonHome season={DEFAULT_SEASON} topScorers={topScorers} playoffLeaders={playoffLeaders} leaderboards={leaderboards} finals={finals} />
      {process.env.NODE_ENV !== "production" ? <Suspense><DevOffseasonToggle isOffseason /></Suspense> : null}
    </>;
  }

  const [scoresResult, playersResult, standingsResult, newsResult] = await Promise.allSettled([
    fetchRecentGames(),
    fetchPlayerHighlights(),
    fetchLeagueStandings(),
    fetchNews(),
  ]);
  const scores = settledSection("scores", scoresResult, []);
  const players = settledSection("players", playersResult, []);
  const leagueStandings = settledSection("standings", standingsResult, []);
  const news = settledSection("news", newsResult, []);
  const conferenceBuckets = buildConferenceBuckets(leagueStandings);
  const stories = [...news]
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, 4);
  const conferences: LeagueStandingsConference[] = conferenceBuckets.map((bucket) => ({
    id: bucket.conference.toLowerCase(),
    title: `${bucket.conference} Conference`,
    subtitle: bucket.teams.length === 0 ? "Awaiting data" : undefined,
    teams: bucket.teams.map((team, index) => {
      const rank = team.conference_rank ?? index + 1;
      const name = formatStandingTeamName(team);
      const slug = slugifySegment(name);
      return {
        id: team.team_id,
        name,
        record: formatStandingRecord(team),
        standing: String(rank),
        rank,
        winPct: formatWinPercent(team.win_pct),
        streak: team.streak ?? null,
        lastTen: team.last_ten ?? null,
        eliminatedConference: Boolean(team.eliminated_conference),
        href: slug ? `/teams/${slug}` : undefined,
      };
    }),
    emptyLabel: "Standings data unavailable.",
  }));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c") }} />
      <HeroSection />

      <section id="scores" className="mt-12 sm:mt-16 lg:mt-20">
        <SectionTitle title="Recent Games" eyebrow="Live scores" link={{ href: "/scores", label: "View all scores →" }} />
        {/* TODO: if no recent games (offseason), display last season's playoff results. */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 md:gap-5 lg:mx-auto lg:max-w-5xl lg:justify-items-center">
          {scores.length === 0 ? (
            <div className="col-span-full w-full rounded-3xl border border-white/10 bg-slate-950/60 p-6 text-center text-sm text-white/70">
              {scoresResult.status === "rejected"
                ? "Scores are temporarily unavailable."
                : "No recent games are available."}
            </div>
          ) : scores.map((game) => {
            const winner =
              game.homeScore === game.awayScore ? "even" : game.homeScore > game.awayScore ? "home" : "away";
            return (
              <ScoreCard
                key={game.id}
                href={`/boxscore/${game.id}`}
                prefetch={false}
                className="w-full max-w-[360px]"
                density="compact"
                timeLabel={<LocalGameTime value={game.timeValue} fallback={game.timeFallback} showTime={game.showTime} />}
                locationLabel={game.location}
                status={game.status}
                isFinal={game.isFinal}
                home={{ name: game.home, score: game.homeScore }}
                away={{ name: game.away, score: game.awayScore }}
                winner={winner}
              />
            );
          })}
        </div>
      </section>

      <section id="players" className="mt-12 sm:mt-16 lg:mt-20">
        <SectionTitle title="Player Spotlight" eyebrow="Trending performers" link={{ href: "/players", label: "View all players →" }} />
        <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
          {players.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 text-center text-sm text-white/70 md:col-span-3">
              {playersResult.status === "rejected"
                ? "Player highlights are temporarily unavailable."
                : "No player highlights are available."}
            </div>
          ) : players.map((player) => (
            <StarBorder
              key={player.id}
              as={Link}
              href={`/players/${player.id}`}
              className="group block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
              contentClassName="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/30 transition hover:border-[color:var(--color-app-primary)] hover:bg-slate-900/80 hover:ring-2 hover:ring-[color:var(--color-app-primary-soft)] sm:p-6"
              color="var(--color-star-border)"
              speed="6.5s"
            >
              <div className="text-center">
                <p className="text-xl font-semibold text-white sm:text-2xl">
                  {player.name || `Player ${player.id}`}
                </p>
                <p className="mt-1 text-xs text-white/60 sm:text-sm">{player.team}</p>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm sm:mt-6 sm:gap-3">
                <div>
                  <dt className="text-[0.6rem] uppercase tracking-[0.3em] text-white/50 sm:text-xs">PTS</dt>
                  <dd className="mt-1 text-lg font-semibold text-white sm:mt-2 sm:text-xl">
                    {player.points.toFixed(1)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.6rem] uppercase tracking-[0.3em] text-white/50 sm:text-xs">REB</dt>
                  <dd className="mt-1 text-lg font-semibold text-white sm:mt-2 sm:text-xl">
                    {player.rebounds.toFixed(1)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.6rem] uppercase tracking-[0.3em] text-white/50 sm:text-xs">AST</dt>
                  <dd className="mt-1 text-lg font-semibold text-white sm:mt-2 sm:text-xl">
                    {player.assists.toFixed(1)}
                  </dd>
                </div>
              </dl>
            </StarBorder>
          ))}
        </div>
      </section>

      <section id="conference" className="mt-12 sm:mt-16 lg:mt-20">
        <SectionTitle title="League Standings" eyebrow="Team directory" link={{ href: "/teams", label: "View all teams →" }} />
        <LeagueStandings conferences={conferences} />
      </section>

      <section id="news" className="mt-12 sm:mt-16 lg:mt-20">
        <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.3em] text-blue-300/80 sm:text-xs sm:tracking-[0.35em]">
              Latest updates
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">News</h2>
          </div>
          <Link
            href="/news"
            className="text-sm font-semibold text-blue-200 transition hover:text-blue-100"
          >
            View all news →
          </Link>
        </div>
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
          {stories.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 text-center text-sm text-white/70 md:col-span-2">
              No news items yet. Check back soon.
            </div>
          ) : (
            stories.map((story) => (
              <article
                key={story.id}
                className="rounded-3xl border border-white/10 bg-slate-950/60 p-4 text-white"
              >
                <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/50 sm:text-xs">
                  {story.source}
                </p>
                <h3 className="mt-2 text-base font-semibold text-white sm:text-lg">{story.title}</h3>
                <p className="mt-2 text-sm text-white/70">{story.summary}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-white/60">
                  <span>{formatNewsDate(story.published_at)}</span>
                  <a
                    href={story.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue-200 hover:text-blue-100"
                  >
                    Read
                  </a>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      {process.env.NODE_ENV !== "production" ? <Suspense><DevOffseasonToggle isOffseason={false} /></Suspense> : null}
    </>
  );
}
