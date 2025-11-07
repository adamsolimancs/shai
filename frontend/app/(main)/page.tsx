import HeroSearch from "@/components/HeroSearch";

type Standing = {
  team: string;
  record: string;
  streak: string;
};

type StandingsResponse = {
  east: Standing[];
  west: Standing[];
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

type NewsItem = {
  title: string;
  source: string;
  url: string;
  timestamp: string;
};

type PlayerHighlight = {
  name: string;
  team: string;
  points: number;
  rebounds: number;
  assists: number;
};

const standingsSeed: StandingsResponse = {
  east: [
    { team: "Boston Celtics", record: "48-12", streak: "W5" },
    { team: "Milwaukee Bucks", record: "43-18", streak: "W2" },
    { team: "New York Knicks", record: "40-22", streak: "W3" },
    { team: "Orlando Magic", record: "38-25", streak: "L1" },
  ],
  west: [
    { team: "Oklahoma City Thunder", record: "46-16", streak: "W4" },
    { team: "Denver Nuggets", record: "44-19", streak: "W1" },
    { team: "Minnesota Timberwolves", record: "43-20", streak: "L2" },
    { team: "LA Clippers", record: "41-21", streak: "W2" },
  ],
};

const scoresSeed: ScoreCard[] = [
  {
    id: "lal-gsw",
    away: "LAL",
    awayScore: 108,
    home: "GSW",
    homeScore: 112,
    status: "Final",
    tip: "Chase Center",
  },
  {
    id: "bos-mia",
    away: "BOS",
    awayScore: 99,
    home: "MIA",
    homeScore: 94,
    status: "Final",
    tip: "FTX Arena",
  },
  {
    id: "den-phx",
    away: "DEN",
    awayScore: 115,
    home: "PHX",
    homeScore: 118,
    status: "Q4 · 2:41",
    tip: "Footprint Center",
  },
];

const newsSeed: NewsItem[] = [
  {
    title: "ESPN: Celtics surge continues behind dominant defense",
    source: "ESPN",
    url: "https://www.espn.com/nba/",
    timestamp: "2h ago",
  },
  {
    title: "The Athletic: Western Conference race down to the wire",
    source: "The Athletic",
    url: "https://theathletic.com/nba/",
    timestamp: "4h ago",
  },
  {
    title: "NBA.com: Rookie spotlight with historic first half",
    source: "NBA.com",
    url: "https://www.nba.com/news",
    timestamp: "6h ago",
  },
];

const playersSeed: PlayerHighlight[] = [
  { name: "Nikola Jokić", team: "DEN", points: 26.1, rebounds: 12.3, assists: 9.8 },
  { name: "Luka Dončić", team: "DAL", points: 33.4, rebounds: 9.0, assists: 9.9 },
  { name: "Jayson Tatum", team: "BOS", points: 27.2, rebounds: 8.5, assists: 4.5 },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Mock API helpers to be replaced with real endpoints later.
const fetchStandings = async (): Promise<StandingsResponse> => {
  await wait(120);
  return standingsSeed;
};

const fetchScores = async (): Promise<ScoreCard[]> => {
  await wait(80);
  return scoresSeed;
};

const fetchNews = async (): Promise<NewsItem[]> => {
  await wait(150);
  return newsSeed;
};

const fetchPlayerHighlights = async (): Promise<PlayerHighlight[]> => {
  await wait(60);
  return playersSeed;
};

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
        Track nightly box scores, dive into advanced numbers, and stay ahead with curated news without leaving one modern dashboard.
      </p>
    </div>
    <HeroSearch />
  </section>
);

export default async function HomePage() {
  const [standings, scores, news, players] = await Promise.all([
    fetchStandings(),
    fetchScores(),
    fetchNews(),
    fetchPlayerHighlights(),
  ]);

  return (
    <>
      <HeroSection />
      <section id="scores" className="mt-20">
        <SectionTitle title="Tonight&apos;s scoreboard" eyebrow="Live scores" />
        <div className="grid gap-4 md:grid-cols-3">
          {scores.map((game) => (
            <article
              key={game.id}
              className="rounded-3xl border border-white/10 bg-linear-to-br from-slate-900/80 to-slate-950/60 p-5 shadow-lg shadow-black/30"
            >
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
                <span>{game.tip}</span>
                <span className="text-blue-300">{game.status}</span>
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
                <div className="rounded-2xl bg-blue-500/10 p-3">
                  <dt className="text-xs uppercase tracking-wider text-white/60">PTS</dt>
                  <dd className="text-xl font-semibold text-white">{player.points.toFixed(1)}</dd>
                </div>
                <div className="rounded-2xl bg-blue-500/10 p-3">
                  <dt className="text-xs uppercase tracking-wider text-white/60">REB</dt>
                  <dd className="text-xl font-semibold text-white">{player.rebounds.toFixed(1)}</dd>
                </div>
                <div className="rounded-2xl bg-blue-500/10 p-3">
                  <dt className="text-xs uppercase tracking-wider text-white/60">AST</dt>
                  <dd className="text-xl font-semibold text-white">{player.assists.toFixed(1)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section id="teams" className="mt-20">
        <SectionTitle title="Current NBA standings" eyebrow="League table" />
        <div className="grid gap-6 md:grid-cols-2">
          {Object.entries(standings).map(([conference, teams]) => (
            <article
              key={conference}
              className="rounded-3xl border border-white/10 bg-linear-to-br from-slate-900/70 to-slate-950/50 p-6 shadow-lg shadow-black/30"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  {conference === "east" ? "Eastern Conference" : "Western Conference"}
                </h3>
                <span className="text-sm text-blue-300/80">Updated moments ago</span>
              </div>
              <div className="divide-y divide-white/5 text-sm">
                {teams.map((team, index) => (
                  <div key={team.team} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-white/40">#{index + 1}</span>
                      <span className="font-semibold text-white">{team.team}</span>
                    </div>
                    <div className="flex items-center gap-4 text-white/70">
                      <span>{team.record}</span>
                      <span className="text-xs text-blue-300">{team.streak}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="news" className="mt-20">
        <SectionTitle title="Latest NBA news" eyebrow="Around the league" />
        <div className="grid gap-5 md:grid-cols-3">
          {news.map((story) => (
            <article key={story.title} className="flex h-full flex-col justify-between rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-lg shadow-black/30">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-blue-300/60">{story.source}</p>
                <h3 className="mt-3 text-lg font-semibold text-white">{story.title}</h3>
              </div>
              <div className="mt-6 flex items-center justify-between text-xs text-white/50">
                <span>{story.timestamp}</span>
                <a
                  href={story.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-300 hover:text-blue-200"
                >
                  Read on {story.source} →
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="mt-24 flex flex-col items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-900/70 px-8 py-8 text-center text-white shadow-lg shadow-black/30 sm:flex-row sm:text-left">
        <p className="text-sm text-white/70">© {new Date().getFullYear()} NBAi. All rights reserved.</p>
        <div className="flex flex-col items-center gap-1 sm:items-end">
          <span className="text-xs uppercase tracking-[0.35em] text-blue-200/70">Mobile app coming soon</span>
        </div>
      </footer>
    </>
  );
}
