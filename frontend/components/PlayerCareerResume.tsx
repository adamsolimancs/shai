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

type SortDirection = "asc" | "desc";

type SortConfig<Key extends string> = {
  key: Key;
  direction: SortDirection;
} | null;

type AverageSortKey =
  | "season"
  | "team"
  | "gp"
  | "gs"
  | "mpg"
  | "ppg"
  | "rpg"
  | "apg"
  | "spg"
  | "bpg"
  | "fg"
  | "tp"
  | "ft"
  | "ts";

type TotalsSortKey =
  | "season"
  | "team"
  | "gp"
  | "gs"
  | "min"
  | "pts"
  | "reb"
  | "ast"
  | "stl"
  | "blk";

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

function seasonSortKey(season: string): number {
  const trimmed = season.trim();
  const startYear = Number.parseInt(trimmed.slice(0, 4), 10);
  if (Number.isNaN(startYear)) {
    return 0;
  }
  if (!trimmed.includes("-")) {
    return startYear;
  }
  const suffix = trimmed.slice(trimmed.indexOf("-") + 1);
  const endSuffix = Number.parseInt(suffix, 10);
  if (Number.isNaN(endSuffix)) {
    return startYear;
  }
  const centuryBase = Math.floor(startYear / 100) * 100;
  let endYear = centuryBase + endSuffix;
  if (endYear < startYear) {
    endYear += 100;
  }
  return endYear;
}

function perGameValue(
  total: number | null | undefined,
  games: number | null | undefined,
): number | null {
  if (!games || games <= 0 || total === null || total === undefined || Number.isNaN(total)) {
    return null;
  }
  return total / games;
}

function compareSortValues(a: number | string | null, b: number | string | null): number {
  const aIsNil = a === null || a === undefined || Number.isNaN(a);
  const bIsNil = b === null || b === undefined || Number.isNaN(b);
  if (aIsNil && bIsNil) return 0;
  if (aIsNil) return 1;
  if (bIsNil) return -1;
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b);
  }
  return (a as number) - (b as number);
}

function sortRows<Key extends string>(
  rows: PlayerCareerStatsRow[],
  config: SortConfig<Key>,
  getValue: (row: PlayerCareerStatsRow, key: Key) => number | string | null,
): PlayerCareerStatsRow[] {
  if (!config) {
    return rows;
  }
  const direction = config.direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const order = compareSortValues(getValue(a.row, config.key), getValue(b.row, config.key));
      if (order !== 0) {
        return order * direction;
      }
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

function getAverageSortValue(row: PlayerCareerStatsRow, key: AverageSortKey): number | string | null {
  switch (key) {
    case "season":
      return seasonSortKey(row.season_id);
    case "team":
      return row.team_abbreviation ?? null;
    case "gp":
      return row.games_played;
    case "gs":
      return row.games_started;
    case "mpg":
      return perGameValue(row.minutes, row.games_played);
    case "ppg":
      return perGameValue(row.points, row.games_played);
    case "rpg":
      return perGameValue(row.rebounds, row.games_played);
    case "apg":
      return perGameValue(row.assists, row.games_played);
    case "spg":
      return perGameValue(row.steals ?? null, row.games_played);
    case "bpg":
      return perGameValue(row.blocks ?? null, row.games_played);
    case "fg":
      return row.field_goal_pct ?? null;
    case "tp":
      return row.three_point_pct ?? null;
    case "ft":
      return row.free_throw_pct ?? null;
    case "ts":
      return row.true_shooting_pct ?? null;
    default:
      return null;
  }
}

function getTotalsSortValue(row: PlayerCareerStatsRow, key: TotalsSortKey): number | string | null {
  switch (key) {
    case "season":
      return seasonSortKey(row.season_id);
    case "team":
      return row.team_abbreviation ?? null;
    case "gp":
      return row.games_played;
    case "gs":
      return row.games_started;
    case "min":
      return row.minutes;
    case "pts":
      return row.points;
    case "reb":
      return row.rebounds;
    case "ast":
      return row.assists;
    case "stl":
      return row.steals ?? null;
    case "blk":
      return row.blocks ?? null;
    default:
      return null;
  }
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
  onSort,
  sortState,
}: {
  label: string;
  tooltip: string;
  className: string;
  onHoverStart: (event: React.MouseEvent<HTMLElement>, tooltipText: string) => void;
  onHoverEnd: () => void;
  onClickShow: (event: React.MouseEvent<HTMLElement>, tooltipText: string) => void;
  onSort?: () => void;
  sortState?: "asc" | "desc" | null;
}) => {
  return (
    <th
      className={`cursor-pointer ${className}`}
      onMouseEnter={(event) => onHoverStart(event, tooltip)}
      onMouseLeave={onHoverEnd}
      onClick={(event) => {
        onSort?.();
        onClickShow(event, tooltip);
      }}
      aria-sort={sortState ? (sortState === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="flex flex-col items-center leading-none">
        <span>{label}</span>
        <span
          aria-hidden="true"
          className={`mt-1 text-[0.55rem] text-[color:rgba(var(--color-app-foreground-rgb),0.55)] ${sortState ? "opacity-100" : "opacity-0"}`}
        >
          {sortState === "asc" ? "▲" : "▼"}
        </span>
      </span>
    </th>
  );
};

export default function PlayerCareerResume({
  regularSeasons,
  playoffSeasons,
  allStarSeasons,
}: PlayerCareerResumeProps) {
  const initialSeasonType: SeasonType =
    regularSeasons.length === 0 && playoffSeasons.length > 0 ? "playoffs" : "regular";
  const [seasonType, setSeasonType] = useState<SeasonType>(initialSeasonType);
  const seasons = seasonType === "playoffs" ? playoffSeasons : regularSeasons;
  const [averageSort, setAverageSort] = useState<SortConfig<AverageSortKey>>(null);
  const [totalsSort, setTotalsSort] = useState<SortConfig<TotalsSortKey>>(null);
  const showTrueShooting = seasons.some(
    (season) => season.true_shooting_pct !== null && season.true_shooting_pct !== undefined,
  );
  const allStarSet = useMemo(() => new Set(allStarSeasons), [allStarSeasons]);
  const averageColumns = showTrueShooting ? 14 : 13;
  const disablePlayoffs = playoffSeasons.length === 0;
  const seasonLabel = seasonType === "playoffs" ? "Playoffs" : "Regular season";
  const statDividerClass = "border-l border-[color:rgba(255,255,255,0.2)]";
  const buildCellProps = (isActive: boolean, extra?: string) => ({
    className: [
      "px-4 py-2 transition-colors",
      extra,
      "group-hover:bg-[color:var(--color-app-primary-soft)]",
    ]
      .filter(Boolean)
      .join(" "),
    style: undefined,
  });
  const buildSummaryCellProps = (isActive: boolean, extra?: string) => ({
    className: ["px-4 py-2", extra].filter(Boolean).join(" "),
    style: undefined,
  });
  const tooltipTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const sortedAverageSeasons = useMemo(
    () => sortRows(seasons, averageSort, getAverageSortValue),
    [seasons, averageSort],
  );
  const sortedTotalSeasons = useMemo(
    () => sortRows(seasons, totalsSort, getTotalsSortValue),
    [seasons, totalsSort],
  );
  const summary = useMemo(() => {
    if (seasons.length === 0) {
      return null;
    }
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

  const handleAverageSort = (key: AverageSortKey) => {
    setAverageSort((prev) => {
      if (!prev || prev.key !== key) {
        return { key, direction: "asc" };
      }
      return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  };

  const handleTotalsSort = (key: TotalsSortKey) => {
    setTotalsSort((prev) => {
      if (!prev || prev.key !== key) {
        return { key, direction: "asc" };
      }
      return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
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
                  onSort={() => handleAverageSort("season")}
                  sortState={averageSort?.key === "season" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="Team"
                  tooltip="Team abbreviation for that season"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("team")}
                  sortState={averageSort?.key === "team" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="GP"
                  tooltip="Games played"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("gp")}
                  sortState={averageSort?.key === "gp" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="GS"
                  tooltip="Games started"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("gs")}
                  sortState={averageSort?.key === "gs" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="MPG"
                  tooltip="Minutes per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("mpg")}
                  sortState={averageSort?.key === "mpg" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="PPG"
                  tooltip="Points per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("ppg")}
                  sortState={averageSort?.key === "ppg" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="RPG"
                  tooltip="Rebounds per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("rpg")}
                  sortState={averageSort?.key === "rpg" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="APG"
                  tooltip="Assists per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("apg")}
                  sortState={averageSort?.key === "apg" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="SPG"
                  tooltip="Steals per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("spg")}
                  sortState={averageSort?.key === "spg" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="BPG"
                  tooltip="Blocks per game"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("bpg")}
                  sortState={averageSort?.key === "bpg" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="FG%"
                  tooltip="Field goal percentage"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("fg")}
                  sortState={averageSort?.key === "fg" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="3P%"
                  tooltip="Three-point percentage"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("tp")}
                  sortState={averageSort?.key === "tp" ? averageSort.direction : null}
                />
                <HeaderCell
                  label="FT%"
                  tooltip="Free throw percentage"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleAverageSort("ft")}
                  sortState={averageSort?.key === "ft" ? averageSort.direction : null}
                />
                {showTrueShooting ? (
                  <HeaderCell
                    label="TS%"
                    tooltip="True shooting percentage"
                    className="px-4 pb-2 pt-4"
                    onHoverStart={handleTooltipEnter}
                    onHoverEnd={handleTooltipLeave}
                    onClickShow={handleTooltipClick}
                    onSort={() => handleAverageSort("ts")}
                    sortState={averageSort?.key === "ts" ? averageSort.direction : null}
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
                sortedAverageSeasons.map((season) => (
                  <tr key={`avg-${season.season_id}-${season.team_abbreviation ?? "tot"}`} className="group">
                    <td {...buildCellProps(averageSort?.key === "season", "font-semibold whitespace-nowrap")}>
                      {renderSeasonLabel(season.season_id)}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "team")}>
                      {season.team_abbreviation ?? "—"}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "gp", statDividerClass)}>
                      {season.games_played}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "gs", statDividerClass)}>
                      {season.games_started}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "mpg", statDividerClass)}>
                      {formatPerGame(season.minutes, season.games_played)}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "ppg", statDividerClass)}>
                      {formatPerGame(season.points, season.games_played)}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "rpg", statDividerClass)}>
                      {formatPerGame(season.rebounds, season.games_played)}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "apg", statDividerClass)}>
                      {formatPerGame(season.assists, season.games_played)}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "spg", statDividerClass)}>
                      {formatPerGame(season.steals, season.games_played)}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "bpg", statDividerClass)}>
                      {formatPerGame(season.blocks, season.games_played)}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "fg", statDividerClass)}>
                      {formatPercentage(season.field_goal_pct)}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "tp", statDividerClass)}>
                      {formatPercentage(season.three_point_pct)}
                    </td>
                    <td {...buildCellProps(averageSort?.key === "ft", statDividerClass)}>
                      {formatPercentage(season.free_throw_pct)}
                    </td>
                    {showTrueShooting ? (
                      <td {...buildCellProps(averageSort?.key === "ts", statDividerClass)}>
                        {formatPercentage(season.true_shooting_pct)}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
              {summary ? (
                <tr className="bg-[color:rgba(var(--color-app-foreground-rgb),0.03)] font-semibold">
                  <td {...buildSummaryCellProps(averageSort?.key === "season", "whitespace-nowrap")}>Career</td>
                  <td {...buildSummaryCellProps(averageSort?.key === "team")}>—</td>
                  <td {...buildSummaryCellProps(averageSort?.key === "gp", statDividerClass)}>
                    {summary.totalGamesPlayed}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "gs", statDividerClass)}>
                    {summary.totalGamesStarted}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "mpg", statDividerClass)}>
                    {formatInteger(summary.averages.minutes)}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "ppg", statDividerClass)}>
                    {formatInteger(summary.averages.points)}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "rpg", statDividerClass)}>
                    {formatInteger(summary.averages.rebounds)}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "apg", statDividerClass)}>
                    {formatInteger(summary.averages.assists)}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "spg", statDividerClass)}>
                    {formatInteger(summary.averages.steals)}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "bpg", statDividerClass)}>
                    {formatInteger(summary.averages.blocks)}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "fg", statDividerClass)}>
                    {formatPercentage(summary.averages.fieldGoalPct)}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "tp", statDividerClass)}>
                    {formatPercentage(summary.averages.threePointPct)}
                  </td>
                  <td {...buildSummaryCellProps(averageSort?.key === "ft", statDividerClass)}>
                    {formatPercentage(summary.averages.freeThrowPct)}
                  </td>
                  {showTrueShooting ? (
                    <td {...buildSummaryCellProps(averageSort?.key === "ts", statDividerClass)}>
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
                  onSort={() => handleTotalsSort("season")}
                  sortState={totalsSort?.key === "season" ? totalsSort.direction : null}
                />
                <HeaderCell
                  label="Team"
                  tooltip="Team abbreviation for that season"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleTotalsSort("team")}
                  sortState={totalsSort?.key === "team" ? totalsSort.direction : null}
                />
                <HeaderCell
                  label="GP"
                  tooltip="Games played"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleTotalsSort("gp")}
                  sortState={totalsSort?.key === "gp" ? totalsSort.direction : null}
                />
                <HeaderCell
                  label="GS"
                  tooltip="Games started"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleTotalsSort("gs")}
                  sortState={totalsSort?.key === "gs" ? totalsSort.direction : null}
                />
                <HeaderCell
                  label="MIN"
                  tooltip="Total minutes played"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleTotalsSort("min")}
                  sortState={totalsSort?.key === "min" ? totalsSort.direction : null}
                />
                <HeaderCell
                  label="PTS"
                  tooltip="Total points"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleTotalsSort("pts")}
                  sortState={totalsSort?.key === "pts" ? totalsSort.direction : null}
                />
                <HeaderCell
                  label="REB"
                  tooltip="Total rebounds"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleTotalsSort("reb")}
                  sortState={totalsSort?.key === "reb" ? totalsSort.direction : null}
                />
                <HeaderCell
                  label="AST"
                  tooltip="Total assists"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleTotalsSort("ast")}
                  sortState={totalsSort?.key === "ast" ? totalsSort.direction : null}
                />
                <HeaderCell
                  label="STL"
                  tooltip="Total steals"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleTotalsSort("stl")}
                  sortState={totalsSort?.key === "stl" ? totalsSort.direction : null}
                />
                <HeaderCell
                  label="BLK"
                  tooltip="Total blocks"
                  className="px-4 pb-2 pt-4"
                  onHoverStart={handleTooltipEnter}
                  onHoverEnd={handleTooltipLeave}
                  onClickShow={handleTooltipClick}
                  onSort={() => handleTotalsSort("blk")}
                  sortState={totalsSort?.key === "blk" ? totalsSort.direction : null}
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
                sortedTotalSeasons.map((season) => (
                  <tr key={`tot-${season.season_id}-${season.team_abbreviation ?? "tot"}`} className="group">
                    <td {...buildCellProps(totalsSort?.key === "season", "font-semibold whitespace-nowrap")}>
                      {renderSeasonLabel(season.season_id)}
                    </td>
                    <td {...buildCellProps(totalsSort?.key === "team")}>
                      {season.team_abbreviation ?? "—"}
                    </td>
                    <td {...buildCellProps(totalsSort?.key === "gp", statDividerClass)}>
                      {season.games_played}
                    </td>
                    <td {...buildCellProps(totalsSort?.key === "gs", statDividerClass)}>
                      {season.games_started}
                    </td>
                    <td {...buildCellProps(totalsSort?.key === "min", statDividerClass)}>
                      {formatInteger(season.minutes)}
                    </td>
                    <td {...buildCellProps(totalsSort?.key === "pts", statDividerClass)}>
                      {formatInteger(season.points)}
                    </td>
                    <td {...buildCellProps(totalsSort?.key === "reb", statDividerClass)}>
                      {formatInteger(season.rebounds)}
                    </td>
                    <td {...buildCellProps(totalsSort?.key === "ast", statDividerClass)}>
                      {formatInteger(season.assists)}
                    </td>
                    <td {...buildCellProps(totalsSort?.key === "stl", statDividerClass)}>
                      {formatInteger(season.steals)}
                    </td>
                    <td {...buildCellProps(totalsSort?.key === "blk", statDividerClass)}>
                      {formatInteger(season.blocks)}
                    </td>
                  </tr>
                ))
              )}
              {summary ? (
                <tr className="bg-[color:rgba(var(--color-app-foreground-rgb),0.03)] font-semibold">
                  <td {...buildSummaryCellProps(totalsSort?.key === "season", "whitespace-nowrap")}>Career</td>
                  <td {...buildSummaryCellProps(totalsSort?.key === "team")}>—</td>
                  <td {...buildSummaryCellProps(totalsSort?.key === "gp", statDividerClass)}>
                    {summary.totalGamesPlayed}
                  </td>
                  <td {...buildSummaryCellProps(totalsSort?.key === "gs", statDividerClass)}>
                    {summary.totalGamesStarted}
                  </td>
                  <td {...buildSummaryCellProps(totalsSort?.key === "min", statDividerClass)}>
                    {formatInteger(summary.totals.minutes)}
                  </td>
                  <td {...buildSummaryCellProps(totalsSort?.key === "pts", statDividerClass)}>
                    {formatInteger(summary.totals.points)}
                  </td>
                  <td {...buildSummaryCellProps(totalsSort?.key === "reb", statDividerClass)}>
                    {formatInteger(summary.totals.rebounds)}
                  </td>
                  <td {...buildSummaryCellProps(totalsSort?.key === "ast", statDividerClass)}>
                    {formatInteger(summary.totals.assists)}
                  </td>
                  <td {...buildSummaryCellProps(totalsSort?.key === "stl", statDividerClass)}>
                    {formatInteger(summary.totals.steals)}
                  </td>
                  <td {...buildSummaryCellProps(totalsSort?.key === "blk", statDividerClass)}>
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
