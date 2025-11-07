import HeroSearch from "@/components/HeroSearch";
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

type Team = {
  id: number;
  city: string;
  name: string;
  abbreviation: string;
  conference: string | null;
  division: string | null;
};

type MetaResponse = {
  service: string;
  version: string;
  supported_seasons: string[];
  last_cache_refresh: Record<string, string | null>;
};

type ScoreCard = {
  id: string;
  away: string;
  awayScore: number;
  home: string;
  homeScore: number;
  status: string;
  tip: string;
};

type PlayerHighlight = {
  name: string;
  team: string;
  points: number;
  rebounds: number;
  assists: number;
};

type ConferenceSnapshot = {
  conference: string;
  teams: { name: string; abbreviation: string; division: string | null }[];
};

async function fetchRecentGames(): Promise<ScoreCard[]> {
  const games = await nbaFetch<Game[]>(`/v1/games?season=${DEFAULT_SEASON}&page_size=6`, { next: { revalidate: 120 } });
  return games.slice(0, 6).map((game) => ({
    id: game.game_id,
    away: game.away_team_name ?? "Away",
    awayScore: game.away_team_score ?? 0,
    home: game.home_team_name ?? "Home",
    homeScore: game.home_team_score ?? 0,
    status: game.status ?? "Final",
    tip: new Date(game.date).toLocaleDateString(),
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

async function fetchConferenceSnapshot(): Promise<ConferenceSnapshot[]> {
  const seasonTeams = await nbaFetch<Team[]>(`/v1/teams?season=${DEFAULT_SEASON}`, { next: { revalidate: 3600 } });
  const grouped = new Map<string, ConferenceSnapshot>();
  seasonTeams.forEach((team) => {
    const conference = team.conference ?? "Unknown";
    if (!grouped.has(conference)) {
      grouped.set(conference, { conference, teams: [] });
    }
    grouped.get(conference)!.teams.push({
      name: `${team.city} ${team.name}`,
      abbreviation: team.abbreviation,
      division: team.division,
    });
  });
  return [...grouped.values()].map((snapshot) => ({
    ...snapshot,
    teams: snapshot.teams.slice(0, 4),
  }));
}

async function fetchMetaSnapshot(): Promise<MetaResponse> {
  return nbaFetch<MetaResponse>("/v1/meta", { next: { revalidate: 3600 } });
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
      <h1 className="pb-2 text-5xl tracking-[0.2em] text-blue-300/60">WELCOME TO NBAi</h1>
      <p className="mt-4 text-base text-white/70 md:text-lg">
        Track nightly box scores, dive into advanced numbers, and stay ahead with curated metrics powered by the NBA Stats
        service.
      </p>
    </div>
    <HeroSearch />
  </section>
);

export default async function HomePage() {
  const [scores, players, conferences, meta] = await Promise.all([
    fetchRecentGames(),
    fetchPlayerHighlights(),
    fetchConferenceSnapshot(),
    fetchMetaSnapshot(),
  ]);

  return (
    <>
      <HeroSection />

      <section id="scores" className="mt-20">
        <SectionTitle title="Recent Games" eyebrow="Live scores" />
        <div className="grid gap-4 md:grid-cols-3">
          {scores.map((game) => (
            <article
              key={game.id}
              className="rounded-3xl border border-white/10 bg-linear-to-br from-slate-900/80 to-slate-950/60 p-5 shadow-lg shadow-black/30"
            >
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
                <span>{game.tip}</span>
              </div>
              <div className="mt-4 space-y-3 text-lg font-semibold">
                <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <span>{game.away}</span>
                  <span>{game.awayScore}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                  <span>{game.home}</span>
                  <span>{game.homeScore}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="players" className="mt-20">
        <SectionTitle title="Player spotlight" eyebrow="Trending performers" />
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
        <SectionTitle title="Conference snapshot" eyebrow="Team directory" />
        <div className="grid gap-6 md:grid-cols-2">
          {conferences.map((snapshot) => (
            <article key={snapshot.conference} className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <p className="text-xs uppercase tracking-[0.35em] text-white/50">{snapshot.conference} Conference</p>
              <ul className="mt-4 space-y-3 text-sm text-white/80">
                {snapshot.teams.map((team) => (
                  <li key={team.abbreviation} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                    <span className="font-semibold text-white">{team.name}</span>
                    <span className="text-white/60">{team.division ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section id="meta" className="mt-20">
        <SectionTitle title="" eyebrow="Powered by nba_api" />
      </section>
    </>
  );
}
