import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EXAMPLES, parseQuestion, rankScorers, type Game } from "@/lib/statsSearch";
import { fetchRecentResults } from "@/lib/recentResults";

export const metadata: Metadata = {
  title: "NBA Stats Search",
  robots: { index: false, follow: false },
};

const dateLabel = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" });
const updatedLabel = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
});

function questionLink(date: string, q: string) {
  return `/stats-search?${new URLSearchParams({ date, q })}`;
}

function BoxScore({ game }: { game: Game }) {
  const columns = ["Player", "Team", "MIN", "PTS", "REB", "AST", "STL", "BLK", "FG", "3PT", "FT"];
  return (
    <section id={`game-${game.id}`} className="scroll-mt-24 rounded-2xl border border-[var(--color-app-border)] p-4">
      <h3 className="text-lg font-semibold">{game.away} {game.awayScore} · {game.home} {game.homeScore}</h3>
      <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Player box score">
        <table className="w-full text-left text-sm tabular-nums">
          <thead>
            <tr>{columns.map(column => <th className="whitespace-nowrap px-2 py-1" scope="col" key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {game.players.map(player => (
              <tr key={player.id} className="border-t border-[var(--color-app-border)]">
                <th scope="row" className="whitespace-nowrap px-2 py-1 font-normal">{player.name}</th>
                {[player.team, player.minutes, player.points, player.rebounds, player.assists, player.steals,
                  player.blocks, player.fg.join("–"), player.three.join("–"), player.ft.join("–")]
                  .map((value, index) => <td className="px-2 py-1" key={columns[index + 1]}>{value}</td>)}
              </tr>
            ))}
            {game.didNotPlay?.map(player => (
              <tr key={player.id} className="border-t border-[var(--color-app-border)]">
                <th scope="row" className="whitespace-nowrap px-2 py-1 font-normal">{player.name}</th>
                <td className="px-2 py-1">{player.team}</td>
                <td className="px-2 py-1" colSpan={9}>Did not play</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function StatsSearchPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; date?: string | string[] }>;
}) {
  if (process.env.HOOPR_POC_ENABLED !== "true") notFound();

  const [params, response] = await Promise.all([
    searchParams,
    fetchRecentResults().catch(() => null),
  ]);
  const snapshot = response?.data;
  const slate = snapshot?.slates.find(item => item.date === params.date) ?? snapshot?.slates[0];
  const question = typeof params.q === "string" ? params.q.trim().slice(0, 250) : EXAMPLES[0].question;
  const intent = parseQuestion(question);
  const results = slate && intent && intent.kind !== "scores"
    ? rankScorers(slate.games, intent.kind, intent.maxMinutes)
    : [];

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-7 px-4 py-6 sm:space-y-8 sm:px-8 sm:py-10">
      <header className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">NBA Stats Search</h1>
        {slate && <p className="text-sm text-[var(--color-app-foreground-muted)]">
          {dateLabel.format(new Date(slate.date))} · {slate.games.length} {slate.games.length === 1 ? "game" : "games"}
        </p>}
      </header>

      {!slate || !snapshot ? (
        <p>Recent results are currently unavailable. Check back after the next morning update.</p>
      ) : (
        <>
          <form action="/stats-search" method="get" className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="overnight-question">Ask about the selected slate</label>
              <input key={question} id="overnight-question" name="q" defaultValue={question} maxLength={250}
                className="min-w-0 flex-1 rounded-xl border border-[var(--color-app-border)] bg-[var(--color-app-surface-elevated)] px-4 py-3" required />
              <input type="hidden" name="date" value={slate.date} />
              <button type="submit" className="btn-primary rounded-xl px-5 py-3 font-semibold">Ask</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map(example => (
                <a key={example.label} href={questionLink(slate.date, example.question)}
                  className="rounded-full border border-[var(--color-app-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-app-primary-soft)]">
                  {example.label}
                </a>
              ))}
            </div>
          </form>

          <nav aria-label="Available slates" className="flex flex-wrap gap-3 text-sm">
            {snapshot.slates.map(item => (
              <a key={item.date} aria-current={item.date === slate.date ? "page" : undefined}
                href={questionLink(item.date, question)}
                className={item.date === slate.date ? "font-semibold underline" : "hover:underline"}>
                {dateLabel.format(new Date(item.date))}
              </a>
            ))}
          </nav>

          {!intent && <p>Try one of the sample questions about scoring, minutes, or final scores.</p>}
          {intent && intent.kind !== "scores" && (
            <section className="space-y-3" aria-labelledby="scoring-results">
              <h2 id="scoring-results" className="text-2xl font-semibold">
                {intent.kind === "relative" ? "Biggest scoring jumps" : "Top scorers"}
              </h2>
              {intent.maxMinutes !== undefined && <p>Players under {intent.maxMinutes} minutes</p>}
              {intent.kind === "relative" && <p className="text-sm text-[var(--color-app-foreground-muted)]">
                Compared with each player’s average in available regular-season games before this slate.
              </p>}
              {results.length === 0 && <p>No player lines match this question.</p>}
              <ol className="divide-y divide-[var(--color-app-border)] rounded-2xl border border-[var(--color-app-border)]">
                {results.map(player => (
                  <li key={player.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                    <a href={`#game-${player.gameId}`} className="font-medium underline">{player.name} · {player.team}</a>
                    <span className="tabular-nums">
                      {player.points} pts · {player.minutes} min
                      {intent.kind === "relative" && player.average !== null && player.delta !== null
                        && ` · ${player.delta >= 0 ? "+" : ""}${player.delta.toFixed(1)} vs. ${player.average.toFixed(1)} avg`}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="space-y-4" aria-labelledby="overnight-box-scores">
            <h2 id="overnight-box-scores" className="text-2xl font-semibold">Final scores and player box scores</h2>
            {slate.games.map(game => <BoxScore key={game.id} game={game} />)}
          </section>
          <p className="text-sm text-[var(--color-app-foreground-muted)]">
            Source <a className="underline" href="https://github.com/sportsdataverse/hoopR-nba-data">hoopR</a>
            {" · Imported "}{updatedLabel.format(new Date(snapshot.observed_at))} ET
          </p>
        </>
      )}
    </div>
  );
}
