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

type StoryAccent = "highlight" | "neutral" | "alert";

type NewsArticle = {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  published_at: string;
  image_url?: string | null;
};

type NewsStory = NewsArticle & {
  accent: StoryAccent;
};

type PulseMetric = {
  label: string;
  value: string;
  detail: string;
};

const STORY_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function deriveAccent(article: NewsArticle): StoryAccent {
  const haystack = `${article.title} ${article.summary}`.toLowerCase();
  if (haystack.match(/\b(injury|out|ruled|questionable|sidelined|suspension)\b/)) {
    return "alert";
  }
  if (haystack.match(/\b(win|beats|tops|dominates|career-high|season-high)\b/)) {
    return "highlight";
  }
  return "neutral";
}

function formatStoryTime(value: string) {
  return STORY_DATE.format(new Date(value));
}

function accentClasses() {
  return "border-white/10 bg-slate-950/60";
}

export default async function NewsPage() {
  const [news, games] = await Promise.all([
    nbaFetch<NewsArticle[]>("/v1/news", { next: { revalidate: 300 } }),
    nbaFetch<Game[]>(`/v1/games?season=${DEFAULT_SEASON}&page_size=24`),
  ]);

  const stories: NewsStory[] = news
    .map((article) => ({
      ...article,
      accent: deriveAccent(article),
    }))
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, 12);

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
        </div>
      </header>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-white/40">Top stories</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {stories.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-10 text-center text-white/70 sm:col-span-2 xl:col-span-2">
              No stories yet—check back after the first slate posts scores.
            </div>
          ) : (
            stories.map((story) => (
              <article key={story.id} className={`rounded-3xl border p-5 transition ${accentClasses()}`}>
                <p className="text-xs uppercase tracking-[0.4em] text-white/50">{story.source}</p>
                <h3 className="mt-3 text-xl font-semibold text-white">{story.title}</h3>
                <p className="mt-2 text-sm text-white/70">{story.summary}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-white/60">
                  <span>{formatStoryTime(story.published_at)}</span>
                  <a
                    href={story.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue-300 hover:text-blue-200"
                  >
                    Read article
                  </a>
                </div>
              </article>
            ))
          )}
          <div className="rounded-3xl border border-white/10 bg-slate-950/60 px-6 py-4 sm:col-span-2 xl:col-span-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs uppercase tracking-[0.4em] text-white/40">Keep exploring</p>
              <div className="flex flex-wrap gap-3">
                {[
                  { href: "/scores", label: "Scores" },
                  { href: "/players", label: "Player directory" },
                  { href: "/teams", label: "Team directory" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40"
                  >
                    {item.label}
                    <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
