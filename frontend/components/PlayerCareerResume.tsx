"use client";

import { type ReactNode, useMemo, useState } from "react";

type PlayerCareerStatsRow = {
  season_id: string;
  team_id: number | null;
  team_abbreviation: string | null;
  player_age: number | null;
  games_played: number;
  games_started: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number | null;
  blocks: number | null;
  field_goal_pct: number | null;
  three_point_pct: number | null;
  free_throw_pct: number | null;
  true_shooting_pct: number | null;
};

type SeasonType = "regular" | "playoffs";

type PlayerCareerResumeProps = {
  regularSeasons: PlayerCareerStatsRow[];
  playoffSeasons: PlayerCareerStatsRow[];
  allStarSeasons: string[];
};

function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(1);
}

function formatPerGame(
  total: number | null | undefined,
  games: number | null | undefined,
  digits = 1,
): string {
  if (!games || games <= 0 || total === null || total === undefined || Number.isNaN(total)) {
    return "—";
  }
  return (total / games).toFixed(digits);
}

function formatPercentage(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

const SectionHeading = ({
  eyebrow,
  title,
  rightSlot,
}: {
  eyebrow: string;
  title: string;
  rightSlot?: ReactNode;
}) => (
  <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p className="text-xs uppercase tracking-[0.35em] text-[color:rgba(var(--color-app-primary-rgb),0.65)]">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-[color:var(--color-app-foreground)]">{title}</h2>
    </div>
    {rightSlot ? <div className="flex-shrink-0">{rightSlot}</div> : null}
  </div>
);

export default function PlayerCareerResume({
  regularSeasons,
  playoffSeasons,
  allStarSeasons,
}: PlayerCareerResumeProps) {
  const initialSeasonType: SeasonType =
    regularSeasons.length === 0 && playoffSeasons.length > 0 ? "playoffs" : "regular";
  const [seasonType, setSeasonType] = useState<SeasonType>(initialSeasonType);
  const seasons = seasonType === "playoffs" ? playoffSeasons : regularSeasons;
  const showTrueShooting = seasons.some(
    (season) => season.true_shooting_pct !== null && season.true_shooting_pct !== undefined,
  );
  const allStarSet = useMemo(() => new Set(allStarSeasons), [allStarSeasons]);
  const averageColumns = showTrueShooting ? 13 : 12;
  const disablePlayoffs = playoffSeasons.length === 0;
  const seasonLabel = seasonType === "playoffs" ? "Playoffs" : "Regular season";

  const renderSeasonLabel = (seasonId: string) => (
    <span className="inline-flex items-center gap-1">
      {seasonId}
      {allStarSet.has(seasonId) ? (
        <span
          className="text-[color:var(--color-app-primary)]"
          aria-label="All-Star season"
          title="All-Star season"
        >
          ★
        </span>
      ) : null}
    </span>
  );

  const toggle = (
    <div className="flex items-center gap-1 rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.2)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)] p-1 text-[0.65rem] uppercase tracking-[0.02em]">
      <button
        type="button"
        onClick={() => setSeasonType("regular")}
        aria-pressed={seasonType === "regular"}
        className={`rounded-full px-3 py-1 font-semibold transition ${
          seasonType === "regular"
            ? "bg-[color:var(--color-app-primary)] text-black"
            : "text-[color:rgba(var(--color-app-foreground-rgb),0.7)] hover:text-[color:var(--color-app-foreground)]"
        }`}
      >
        Regular Season
      </button>
      <button
        type="button"
        onClick={() => setSeasonType("playoffs")}
        aria-pressed={seasonType === "playoffs"}
        disabled={disablePlayoffs}
        className={`rounded-full px-3 py-1 font-semibold transition ${
          seasonType === "playoffs"
            ? "bg-[color:var(--color-app-primary)] text-black"
            : "text-[color:rgba(var(--color-app-foreground-rgb),0.7)] hover:text-[color:var(--color-app-foreground)]"
        } ${disablePlayoffs ? "cursor-not-allowed opacity-50" : ""}`}
      >
        Playoffs
      </button>
    </div>
  );

  return (
    <>
      <section className="mt-20">
        <SectionHeading eyebrow="Career resume" title="Season Averages" rightSlot={toggle} />
        <div className="overflow-x-auto rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]">
          <table className="min-w-full divide-y divide-[color:rgba(var(--color-app-foreground-rgb),0.08)] bg-[color:var(--color-app-surface)] text-xs text-[color:var(--color-app-foreground)] sm:text-sm">
            <thead className="text-left text-[0.65rem] uppercase tracking-[0.35em] text-[color:rgba(var(--color-app-foreground-rgb),0.5)] sm:text-[0.7rem]">
              <tr>
                <th className="px-4 py-3">Season</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">GP</th>
                <th className="px-4 py-3">MPG</th>
                <th className="px-4 py-3">PPG</th>
                <th className="px-4 py-3">RPG</th>
                <th className="px-4 py-3">APG</th>
                <th className="px-4 py-3">SPG</th>
                <th className="px-4 py-3">BPG</th>
                <th className="px-4 py-3">FG%</th>
                <th className="px-4 py-3">3P%</th>
                <th className="px-4 py-3">FT%</th>
                {showTrueShooting ? <th className="px-4 py-3">TS%</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:rgba(var(--color-app-foreground-rgb),0.08)] text-[color:var(--color-app-foreground)]">
              {seasons.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-6 text-sm text-[color:var(--color-app-foreground-muted)]"
                    colSpan={averageColumns}
                  >
                    No {seasonLabel.toLowerCase()} averages available.
                  </td>
                </tr>
              ) : (
                seasons.map((season) => (
                  <tr key={`avg-${season.season_id}-${season.team_abbreviation ?? "tot"}`} className="group">
                    <td className="px-4 py-2 font-semibold transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {renderSeasonLabel(season.season_id)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {season.team_abbreviation ?? "—"}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {season.games_played}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPerGame(season.minutes, season.games_played)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPerGame(season.points, season.games_played)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPerGame(season.rebounds, season.games_played)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPerGame(season.assists, season.games_played)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPerGame(season.steals, season.games_played)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPerGame(season.blocks, season.games_played)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPercentage(season.field_goal_pct)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPercentage(season.three_point_pct)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatPercentage(season.free_throw_pct)}
                    </td>
                    {showTrueShooting ? (
                      <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                        {formatPercentage(season.true_shooting_pct)}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <SectionHeading eyebrow="" title="Season Totals" />
        <div className="overflow-x-auto rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]">
          <table className="min-w-full divide-y divide-[color:rgba(var(--color-app-foreground-rgb),0.08)] bg-[color:var(--color-app-surface)] text-xs text-[color:var(--color-app-foreground)] sm:text-sm">
            <thead className="text-left text-[0.65rem] uppercase tracking-[0.3em] text-[color:rgba(var(--color-app-foreground-rgb),0.5)] sm:text-[0.7rem]">
              <tr>
                <th className="pl-3 pr-0.5 py-2">Season</th>
                <th className="pl-0 pr-1 py-2">Team</th>
                <th className="px-3 py-2">GP</th>
                <th className="px-3 py-2">MIN</th>
                <th className="px-3 py-2">PTS</th>
                <th className="px-3 py-2">REB</th>
                <th className="px-3 py-2">AST</th>
                <th className="px-3 py-2">STL</th>
                <th className="px-3 py-2">BLK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:rgba(var(--color-app-foreground-rgb),0.08)]">
              {seasons.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-6 text-sm text-[color:var(--color-app-foreground-muted)]"
                    colSpan={9}
                  >
                    No {seasonLabel.toLowerCase()} totals available.
                  </td>
                </tr>
              ) : (
                seasons.map((season) => (
                  <tr key={`tot-${season.season_id}-${season.team_abbreviation ?? "tot"}`} className="group">
                    <td className="pl-3 pr-0.5 py-1.5 font-semibold transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {renderSeasonLabel(season.season_id)}
                    </td>
                    <td className="pl-0 pr-1 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {season.team_abbreviation ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {season.games_played}
                    </td>
                    <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatInteger(season.minutes)}
                    </td>
                    <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatInteger(season.points)}
                    </td>
                    <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatInteger(season.rebounds)}
                    </td>
                    <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatInteger(season.assists)}
                    </td>
                    <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatInteger(season.steals)}
                    </td>
                    <td className="px-3 py-1.5 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {formatInteger(season.blocks)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
