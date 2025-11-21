import { Suspense } from "react";
import { LeagueStandings, type LeagueStandingsConference } from "@/components/LeagueStandings";
import HeroSearch from "@/components/HeroSearch";
import ScoreCard from "@/components/ScoreCard";
import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";
import { slugifySegment } from "@/lib/utils";

type Game = {
  game_id: string;
  date: string;
  home_team_name: string;
  home_team_score: number;
  away_team_name: string;
  away_team_score: number;
  status?: string | null;
  location?: string | null;
};

type PlayerStatsRow = {
  player_id: number;
  player_name: string;
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
  tip: string;
  location: string;
};

type PlayerHighlight = {
  name: string;
  team: string;
  points: number;
  rebounds: number;
  assists: number;
};

type FranchiseLocation = {
  name: string;
  location: string;
  aliases?: string[];
};

const TEAM_LOCATIONS: FranchiseLocation[] = [
  { name: "Atlanta Hawks", location: "Atlanta, GA" },
  { name: "Boston Celtics", location: "Boston, MA" },
  { name: "Brooklyn Nets", location: "Brooklyn, NY" },
  { name: "Charlotte Hornets", location: "Charlotte, NC" },
  { name: "Chicago Bulls", location: "Chicago, IL" },
  { name: "Cleveland Cavaliers", location: "Cleveland, OH" },
  { name: "Dallas Mavericks", location: "Dallas, TX" },
  { name: "Denver Nuggets", location: "Denver, CO" },
  { name: "Detroit Pistons", location: "Detroit, MI" },
  { name: "Golden State Warriors", location: "San Francisco, CA" },
  { name: "Houston Rockets", location: "Houston, TX" },
  { name: "Indiana Pacers", location: "Indianapolis, IN" },
  { name: "Los Angeles Clippers", aliases: ["LA Clippers"], location: "Los Angeles, CA" },
  { name: "Los Angeles Lakers", aliases: ["LA Lakers"], location: "Los Angeles, CA" },
  { name: "Memphis Grizzlies", location: "Memphis, TN" },
  { name: "Miami Heat", location: "Miami, FL" },
  { name: "Milwaukee Bucks", location: "Milwaukee, WI" },
  { name: "Minnesota Timberwolves", location: "Minneapolis, MN" },
  { name: "New Orleans Pelicans", location: "New Orleans, LA" },
  { name: "New York Knicks", location: "New York, NY" },
  { name: "Oklahoma City Thunder", location: "Oklahoma City, OK" },
  { name: "Orlando Magic", location: "Orlando, FL" },
  { name: "Philadelphia 76ers", location: "Philadelphia, PA" },
  { name: "Phoenix Suns", location: "Phoenix, AZ" },
  { name: "Portland Trail Blazers", location: "Portland, OR" },
  { name: "Sacramento Kings", location: "Sacramento, CA" },
  { name: "San Antonio Spurs", location: "San Antonio, TX" },
  { name: "Toronto Raptors", location: "Toronto, ON" },
  { name: "Utah Jazz", location: "Salt Lake City, UT" },
  { name: "Washington Wizards", location: "Washington, DC" },
];

const TEAM_LOCATION_LOOKUP = TEAM_LOCATIONS.reduce((map, team) => {
  map.set(team.name.toLowerCase(), team.location);
  team.aliases?.forEach((alias) => map.set(alias.toLowerCase(), team.location));
  return map;
}, new Map<string, string>());

function fallbackLocationForTeam(name?: string | null): string | undefined {
  if (!name) return undefined;
  return TEAM_LOCATION_LOOKUP.get(name.toLowerCase());
}

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

async function fetchRecentGames(): Promise<ScoreCardData[]> {
  const games = await nbaFetch<Game[]>(`/v1/games?season=${DEFAULT_SEASON}&page_size=6`, { next: { revalidate: 120 } });
  return games.slice(0, 6).map((game) => ({
    id: game.game_id,
    away: game.away_team_name ?? "Away",
    awayScore: game.away_team_score ?? 0,
    home: game.home_team_name ?? "Home",
    homeScore: game.home_team_score ?? 0,
    status: game.status ?? "Final",
    tip: new Date(game.date).toLocaleDateString(),
    location: game.location ?? fallbackLocationForTeam(game.home_team_name) ?? "Venue TBA",
  }));
}

async function fetchPlayerHighlights(): Promise<PlayerHighlight[]> {
  const stats = await nbaFetch<PlayerStatsRow[]>(
    `/v1/players/stats?season=${DEFAULT_SEASON}&measure=Base&per_mode=PerGame&page_size=200`,
    { next: { revalidate: 300 } },
  );
  return [...stats]
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((player) => ({
      name: player.player_name,
      team: player.team_abbreviation ?? "FA",
      points: player.points,
      rebounds: player.rebounds,
      assists: player.assists,
    }));
}

async function fetchLeagueStandings(): Promise<LeagueStanding[]> {
  return nbaFetch<LeagueStanding[]>(
    `/v1/league_standings?season=${DEFAULT_SEASON}&league_id=00&season_type=Regular%20Season`,
    { next: { revalidate: 900 } },
  );
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

const SectionTitle = ({ title, eyebrow }: { title: string; eyebrow: string }) => (
  <div className="mb-8">
    <p className="text-xs uppercase tracking-[0.35em] text-blue-300/80">{eyebrow}</p>
    <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
  </div>
);

const HeroSection = () => (
  <section className="flex flex-col gap-10 text-center md:gap-16">
    <div>
      <h1 className="pb-2 text-5xl tracking-[0.2em] text-(--foreground)">WELCOME TO ShAI</h1>
      <p className="mt-4 text-base text-(--foreground-muted)/70 md:text-lg">
        AI that speaks basketball: real-time stats, player insights, and predictive analytics powered by AI.
      </p>
    </div>
    <Suspense
      fallback={
        <div className="mx-auto h-[68px] w-full max-w-3xl animate-pulse rounded-full border border-white/10 bg-white/5" aria-hidden="true" />
      }
    >
      <HeroSearch />
    </Suspense>
  </section>
);

export default async function HomePage() {
  const [scores, players, leagueStandings] = await Promise.all([
    fetchRecentGames(),
    fetchPlayerHighlights(),
    fetchLeagueStandings(),
  ]);
  const conferenceBuckets = buildConferenceBuckets(leagueStandings);
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
      <HeroSection />

      <section id="scores" className="mt-20">
        <SectionTitle title="Recent Games" eyebrow="Live scores" />
        <div className="grid gap-4 md:grid-cols-3">
          {scores.map((game) => {
            const winner =
              game.homeScore === game.awayScore ? "even" : game.homeScore > game.awayScore ? "home" : "away";
            return (
              <ScoreCard
                key={game.id}
                href={`/boxscore/${game.id}`}
                timeLabel={game.tip}
                locationLabel={game.location}
                status={game.status}
                home={{ name: game.home, score: game.homeScore }}
                away={{ name: game.away, score: game.awayScore }}
                winner={winner}
              />
            );
          })}
        </div>
      </section>

      <section id="players" className="mt-20">
        <SectionTitle title="Player Spotlight" eyebrow="Trending performers" />
        <div className="grid gap-6 md:grid-cols-3">
          {players.map((player) => (
            <article key={player.name} className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-lg shadow-black/30">
              <div className="flex items-center justify-between text-sm text-white/60">
                <span className="font-semibold text-white">{player.name}</span>
                <span>{player.team}</span>
              </div>
              <dl className="mt-6 grid grid-cols-3 gap-3 text-center text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-[0.3em] text-white/50">PTS</dt>
                  <dd className="mt-2 text-xl font-semibold text-white">{player.points.toFixed(1)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.3em] text-white/50">REB</dt>
                  <dd className="mt-2 text-xl font-semibold text-white">{player.rebounds.toFixed(1)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.3em] text-white/50">AST</dt>
                  <dd className="mt-2 text-xl font-semibold text-white">{player.assists.toFixed(1)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section id="conference" className="mt-20">
        <SectionTitle title="League Standings" eyebrow="Team directory" />
        <LeagueStandings conferences={conferences} />
      </section>
    </>
  );
}
