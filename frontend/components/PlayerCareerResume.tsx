"use client";

import { type ReactNode, useMemo, useRef, useState } from "react";

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

function sumStat(
  seasons: PlayerCareerStatsRow[],
  getter: (season: PlayerCareerStatsRow) => number | null | undefined,
): number | null {
  let total = 0;
  let hasValue = false;
  seasons.forEach((season) => {
    const value = getter(season);
    if (value === null || value === undefined || Number.isNaN(value)) {
      return;
    }
    total += value;
    hasValue = true;
  });
  return hasValue ? total : null;
}

function weightedAverage(
  seasons: PlayerCareerStatsRow[],
  getter: (season: PlayerCareerStatsRow) => number | null | undefined,
  weightGetter: (season: PlayerCareerStatsRow) => number,
): number | null {
  let weighted = 0;
  let weights = 0;
  seasons.forEach((season) => {
    const value = getter(season);
    if (value === null || value === undefined || Number.isNaN(value)) {
      return;
    }
    const weight = weightGetter(season);
    if (!weight || Number.isNaN(weight)) {
      return;
    }
    weighted += value * weight;
    weights += weight;
  });
  return weights > 0 ? weighted / weights : null;
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

const HeaderCell = ({
  label,
  tooltip,
  className,
  onHoverStart,
  onHoverEnd,
  onClickShow,
}: {
  label: string;
  tooltip: string;
  className: string;
  onHoverStart: (event: React.MouseEvent<HTMLElement>, tooltipText: string) => void;
  onHoverEnd: () => void;
  onClickShow: (event: React.MouseEvent<HTMLElement>, tooltipText: string) => void;
}) => (
  <th
    className={`cursor-pointer ${className}`}
    onMouseEnter={(event) => onHoverStart(event, tooltip)}
    onMouseLeave={onHoverEnd}
    onClick={(event) => onClickShow(event, tooltip)}
  >
    <span>{label}</span>
  </th>
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
  const averageColumns = showTrueShooting ? 14 : 13;
  const disablePlayoffs = playoffSeasons.length === 0;
  const seasonLabel = seasonType === "playoffs" ? "Playoffs" : "Regular season";
  const statDividerClass = "border-l border-[color:rgba(255,255,255,0.2)]";
  const tooltipTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const summary = useMemo(() => {
    if (seasons.length === 0) {
      return null;
    }
    const perGameValue = (
      total: number | null | undefined,
      games: number | null | undefined,
    ): number | null => {
      if (!games || games <= 0 || total === null || total === undefined) {
        return null;
      }
      return total / games;
    };
    const totalGamesPlayed = seasons.reduce((sum, season) => sum + (season.games_played || 0), 0);
    const totalGamesStarted = seasons.reduce((sum, season) => sum + (season.games_started || 0), 0);
    const totals = {
      minutes: sumStat(seasons, (season) => season.minutes),
      points: sumStat(seasons, (season) => season.points),
      rebounds: sumStat(seasons, (season) => season.rebounds),
      assists: sumStat(seasons, (season) => season.assists),
      steals: sumStat(seasons, (season) => season.steals),
      blocks: sumStat(seasons, (season) => season.blocks),
    };
    const averages = {
      minutes: weightedAverage(
        seasons,
        (season) => perGameValue(season.minutes, season.games_played),
        (season) => season.games_played,
      ),
      points: weightedAverage(
        seasons,
        (season) => perGameValue(season.points, season.games_played),
        (season) => season.games_played,
      ),
      rebounds: weightedAverage(
        seasons,
        (season) => perGameValue(season.rebounds, season.games_played),
        (season) => season.games_played,
      ),
      assists: weightedAverage(
        seasons,
        (season) => perGameValue(season.assists, season.games_played),
        (season) => season.games_played,
      ),
      steals: weightedAverage(
        seasons,
        (season) => perGameValue(season.steals, season.games_played),
        (season) => season.games_played,
      ),
      blocks: weightedAverage(
        seasons,
        (season) => perGameValue(season.blocks, season.games_played),
        (season) => season.games_played,
      ),
      fieldGoalPct: weightedAverage(seasons, (season) => season.field_goal_pct, (season) => season.games_played),
      threePointPct: weightedAverage(
        seasons,
        (season) => season.three_point_pct,
        (season) => season.games_played,
      ),
      freeThrowPct: weightedAverage(
        seasons,
        (season) => season.free_throw_pct,
        (season) => season.games_played,
      ),
      trueShootingPct: weightedAverage(
        seasons,
        (season) => season.true_shooting_pct,
        (season) => season.games_played,
      ),
    };
    return { totalGamesPlayed, totalGamesStarted, totals, averages };
  }, [seasons]);

  const handleTooltipEnter = (event: React.MouseEvent<HTMLElement>, tooltipText: string) => {
    if (tooltipTimeoutRef.current) {
      globalThis.clearTimeout(tooltipTimeoutRef.current);
    }
    const target = event.currentTarget as HTMLElement;
    tooltipTimeoutRef.current = globalThis.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      setTooltip({
        text: tooltipText,
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      });
    }, 1000);
  };

  const handleTooltipLeave = () => {
    if (tooltipTimeoutRef.current) {
      globalThis.clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setTooltip(null);
  };

  const handleTooltipClick = (event: React.MouseEvent<HTMLElement>, tooltipText: string) => {
    if (tooltipTimeoutRef.current) {
      globalThis.clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    setTooltip({
      text: tooltipText,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

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
    <div className="flex w-fit items-center gap-1 self-start rounded-full border border-[color:rgba(var(--color-app-foreground-rgb),0.2)] bg-[color:rgba(var(--color-app-foreground-rgb),0.05)] p-1 text-[0.65rem] uppercase tracking-[0.02em]">
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
          <table className="min-w-full divide-y divide-y-[0.5px] divide-[color:rgba(var(--color-app-foreground-rgb),0.08)] bg-[color:var(--color-app-surface)] text-xs text-[color:var(--color-app-foreground)] sm:text-sm">
            <thead className="text-left text-[0.65rem] uppercase tracking-[0.35em] text-[color:rgba(var(--color-app-foreground-rgb),0.5)] sm:text-[0.7rem]">
              <tr>
                <HeaderCell
                  label="Season"
                  tooltip="Season year and league cycle"
                  className="px-4 pb-2 pt-4 whitespace-nowrap"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="Team"
                  tooltip="Team abbreviation for that season"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="GP"
                  tooltip="Games played"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="GS"
                  tooltip="Games started"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="MPG"
                  tooltip="Minutes per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="PPG"
                  tooltip="Points per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="RPG"
                  tooltip="Rebounds per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="APG"
                  tooltip="Assists per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="SPG"
                  tooltip="Steals per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="BPG"
                  tooltip="Blocks per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="FG%"
                  tooltip="Field goal percentage"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="3P%"
                  tooltip="Three-point percentage"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="FT%"
                  tooltip="Free throw percentage"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                {showTrueShooting ? (
                  <HeaderCell
                    label="TS%"
                    tooltip="True shooting percentage"
                    className="px-4 pb-2 pt-4"
                    onHoverStart={handleTooltipEnter}
                    onHoverEnd={handleTooltipLeave}
                    onClickShow={handleTooltipClick}
                  />
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-y-[0.5px] divide-[color:rgba(var(--color-app-foreground-rgb),0.08)] text-[color:var(--color-app-foreground)]">
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
                    <td className="px-4 py-2 font-semibold whitespace-nowrap transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {renderSeasonLabel(season.season_id)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {season.team_abbreviation ?? "—"}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {season.games_played}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {season.games_started}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatPerGame(season.minutes, season.games_played)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatPerGame(season.points, season.games_played)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatPerGame(season.rebounds, season.games_played)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatPerGame(season.assists, season.games_played)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatPerGame(season.steals, season.games_played)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatPerGame(season.blocks, season.games_played)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatPercentage(season.field_goal_pct)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatPercentage(season.three_point_pct)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatPercentage(season.free_throw_pct)}
                    </td>
                    {showTrueShooting ? (
                      <td
                        className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                      >
                        {formatPercentage(season.true_shooting_pct)}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
              {summary ? (
                <tr className="bg-[color:rgba(var(--color-app-foreground-rgb),0.03)] font-semibold">
                  <td className="px-4 py-2 whitespace-nowrap">Career</td>
                  <td className="px-4 py-2">—</td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>{summary.totalGamesPlayed}</td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>{summary.totalGamesStarted}</td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.averages.minutes)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.averages.points)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.averages.rebounds)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.averages.assists)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.averages.steals)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.averages.blocks)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatPercentage(summary.averages.fieldGoalPct)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatPercentage(summary.averages.threePointPct)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatPercentage(summary.averages.freeThrowPct)}
                  </td>
                  {showTrueShooting ? (
                    <td className={`px-4 py-2 ${statDividerClass}`}>
                      {formatPercentage(summary.averages.trueShootingPct)}
                    </td>
                  ) : null}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6">
        <SectionHeading eyebrow="" title="Season Totals" />
        <div className="overflow-x-auto rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)]">
          <table className="min-w-full divide-y divide-y-[0.5px] divide-[color:rgba(var(--color-app-foreground-rgb),0.08)] bg-[color:var(--color-app-surface)] text-xs text-[color:var(--color-app-foreground)] sm:text-sm">
            <thead className="text-left text-[0.65rem] uppercase tracking-[0.35em] text-[color:rgba(var(--color-app-foreground-rgb),0.5)] sm:text-[0.7rem]">
              <tr>
                <HeaderCell
                  label="Season"
                  tooltip="Season year and league cycle"
                  className="px-4 pb-2 pt-4 whitespace-nowrap"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="Team"
                  tooltip="Team abbreviation for that season"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="GP"
                  tooltip="Games played"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="GS"
                  tooltip="Games started"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="MIN"
                  tooltip="Total minutes played"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="PTS"
                  tooltip="Total points"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="REB"
                  tooltip="Total rebounds"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="AST"
                  tooltip="Total assists"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="STL"
                  tooltip="Total steals"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
                <HeaderCell
                  label="BLK"
                  tooltip="Total blocks"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-y-[0.5px] divide-[color:rgba(var(--color-app-foreground-rgb),0.08)]">
              {seasons.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-6 text-sm text-[color:var(--color-app-foreground-muted)]"
                    colSpan={10}
                  >
                    No {seasonLabel.toLowerCase()} totals available.
                  </td>
                </tr>
              ) : (
                seasons.map((season) => (
                  <tr key={`tot-${season.season_id}-${season.team_abbreviation ?? "tot"}`} className="group">
                    <td className="px-4 py-2 font-semibold whitespace-nowrap transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {renderSeasonLabel(season.season_id)}
                    </td>
                    <td className="px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)]">
                      {season.team_abbreviation ?? "—"}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {season.games_played}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {season.games_started}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatInteger(season.minutes)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatInteger(season.points)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatInteger(season.rebounds)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatInteger(season.assists)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatInteger(season.steals)}
                    </td>
                    <td
                      className={`px-4 py-2 transition-colors group-hover:bg-[color:var(--color-app-primary-soft)] ${statDividerClass}`}
                    >
                      {formatInteger(season.blocks)}
                    </td>
                  </tr>
                ))
              )}
              {summary ? (
                <tr className="bg-[color:rgba(var(--color-app-foreground-rgb),0.03)] font-semibold">
                  <td className="px-4 py-2 whitespace-nowrap">Career</td>
                  <td className="px-4 py-2">—</td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>{summary.totalGamesPlayed}</td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>{summary.totalGamesStarted}</td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.totals.minutes)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.totals.points)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.totals.rebounds)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.totals.assists)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.totals.steals)}
                  </td>
                  <td className={`px-4 py-2 ${statDividerClass}`}>
                    {formatInteger(summary.totals.blocks)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {tooltip ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 w-max max-w-[14rem] -translate-x-1/2 -translate-y-full rounded-md bg-[color:var(--color-app-foreground)] px-2 py-1 text-[0.65rem] font-semibold text-[color:var(--color-app-background)] shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </>
  );
}
