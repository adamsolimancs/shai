import type { SVGProps } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { nbaFetch } from "@/lib/nbaApi";

type BoxScoreTeamLeader = {
  player_id: number;
  player_name: string;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  stat_line: string | null;
};

type BoxScoreTeamInfo = {
  team_id: number;
  team_name: string | null;
  team_city: string | null;
  team_abbreviation: string | null;
  score: number;
  record: string | null;
  is_home: boolean;
  leaders: BoxScoreTeamLeader[];
};

type BoxScorePeriodScore = {
  label: string;
  home: number;
  away: number;
};

type BoxScoreTeamTotals = {
  team_id: number;
  team_name: string | null;
  team_abbreviation: string | null;
  minutes: string | null;
  field_goals_made: number | null;
  field_goals_attempted: number | null;
  field_goal_pct: number | null;
  three_point_made: number | null;
  three_point_attempted: number | null;
  three_point_pct: number | null;
  free_throws_made: number | null;
  free_throws_attempted: number | null;
  free_throw_pct: number | null;
  offensive_rebounds: number | null;
  defensive_rebounds: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  points: number | null;
  plus_minus: number | null;
};

type BoxScoreStarterBenchRow = {
  team_id: number;
  team_name: string | null;
  team_abbreviation: string | null;
  label: string;
  minutes: string | null;
  field_goals_made: number | null;
  field_goals_attempted: number | null;
  field_goal_pct: number | null;
  three_point_made: number | null;
  three_point_attempted: number | null;
  three_point_pct: number | null;
  free_throws_made: number | null;
  free_throws_attempted: number | null;
  free_throw_pct: number | null;
  offensive_rebounds: number | null;
  defensive_rebounds: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  points: number | null;
};

type BoxScoreTraditionalPlayer = {
  player_id: number;
  player_name: string;
  team_id: number;
  team_abbreviation: string | null;
  team_city: string | null;
  start_position: string | null;
  comment: string | null;
  minutes: string | null;
  field_goals_made: number | null;
  field_goals_attempted: number | null;
  field_goal_pct: number | null;
  three_point_made: number | null;
  three_point_attempted: number | null;
  three_point_pct: number | null;
  free_throws_made: number | null;
  free_throws_attempted: number | null;
  free_throw_pct: number | null;
  offensive_rebounds: number | null;
  defensive_rebounds: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  points: number | null;
  plus_minus: number | null;
};

type BoxScoreAdvancedPlayer = {
  player_id: number;
  player_name: string;
  team_id: number;
  team_abbreviation: string | null;
  minutes: string | null;
  offensive_rating: number | null;
  defensive_rating: number | null;
  net_rating: number | null;
  usage_pct: number | null;
  true_shooting_pct: number | null;
  effective_fg_pct: number | null;
  assist_pct: number | null;
  assist_to_turnover: number | null;
  rebound_pct: number | null;
  offensive_rebound_pct: number | null;
  defensive_rebound_pct: number | null;
  pace: number | null;
  pace_per40: number | null;
  possessions: number | null;
  pie: number | null;
};

type BoxScoreGame = {
  game_id: string;
  status: string | null;
  game_date: string | null;
  start_time: string | null;
  arena: string | null;
  attendance: number | null;
  summary: string | null;
  officials: string[];
  home_team: BoxScoreTeamInfo;
  away_team: BoxScoreTeamInfo;
  line_score: BoxScorePeriodScore[];
  team_totals: BoxScoreTeamTotals[];
  starter_bench: BoxScoreStarterBenchRow[];
  traditional_players: BoxScoreTraditionalPlayer[];
  advanced_players: BoxScoreAdvancedPlayer[];
};

type BoxScoreParams = {
  id?: string | string[];
  ":id"?: string | string[];
};

type StatsResultSet = {
  name: string;
  headers: string[];
  rowSet: unknown[][];
};

type TraditionalBoxScoreData = {
  players: BoxScoreTraditionalPlayer[];
  teamTotals: BoxScoreTeamTotals[];
  starterBench: BoxScoreStarterBenchRow[];
};

function getParamValue(value?: string | string[]) {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function formatTipoff(date?: string | null) {
  if (!date) return "Tipoff time TBA";
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(date));
  } catch {
    return date;
  }
}

function formatAttendance(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Attendance TBA";
  }
  return `${value.toLocaleString()} fans`;
}

function minutesToSeconds(minutes?: string | null) {
  if (!minutes) return 0;
  const [m, s] = minutes.split(":").map((part) => Number(part));
  if (!Number.isFinite(m) || !Number.isFinite(s)) return 0;
  return m * 60 + s;
}

function didNotPlay(minutes?: string | null) {
  return minutesToSeconds(minutes) <= 0;
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  const factor = 10 ** digits;
  return `${Math.round(value * factor) / factor}`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value * 1000) / 10}%`;
}

function groupByTeam<T extends { team_id: number }>(rows: T[]) {
  return rows.reduce((acc, row) => {
    acc[row.team_id] = acc[row.team_id] ?? [];
    acc[row.team_id].push(row);
    return acc;
  }, {} as Record<number, T[]>);
}

function mapResultSet(set?: StatsResultSet) {
  if (!set) return [] as Record<string, unknown>[];
  return set.rowSet.map((row) =>
    set.headers.reduce<Record<string, unknown>>((acc, header, index) => {
      acc[header] = row[index];
      return acc;
    }, {}),
  );
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function coerceInt(value: unknown): number | null {
  const num = coerceNumber(value);
  return num === null ? null : Math.trunc(num);
}

function coerceString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

async function fetchTraditionalBoxScore(gameId: string): Promise<TraditionalBoxScoreData | null> {
  try {
    const url = new URL("https://stats.nba.com/stats/boxscoretraditionalv2");
    url.searchParams.set("GameID", gameId);
    url.searchParams.set("StartPeriod", "0");
    url.searchParams.set("EndPeriod", "0");
    url.searchParams.set("StartRange", "0");
    url.searchParams.set("EndRange", "0");
    url.searchParams.set("RangeType", "0");
    url.searchParams.set("LeagueID", "00");

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Host: "stats.nba.com",
        Origin: "https://www.nba.com",
        Pragma: "no-cache",
        Referer: "https://www.nba.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "x-nba-stats-origin": "stats",
        "x-nba-stats-token": "true",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Failed to fetch traditional boxscore", response.status, response.statusText);
      return null;
    }

    const payload = (await response.json()) as { resultSets?: StatsResultSet[] };
    const findSet = (name: string) => payload.resultSets?.find((set) => set.name === name);

    const playerRows = mapResultSet(findSet("PlayerStats"));
    const teamRows = mapResultSet(findSet("TeamStats"));
    const starterBenchRows = mapResultSet(findSet("TeamStarterBenchStats"));

    if (!playerRows.length && !teamRows.length && !starterBenchRows.length) {
      return null;
    }

    const players: BoxScoreTraditionalPlayer[] = playerRows.map((row) => {
      const minutesValue = row["MIN"];
      const startPosition = coerceString(row["START_POSITION"]);
      const comment = coerceString(row["COMMENT"]);
      return {
        player_id: coerceInt(row["PLAYER_ID"]) ?? 0,
        player_name: coerceString(row["PLAYER_NAME"]) ?? "Unknown player",
        team_id: coerceInt(row["TEAM_ID"]) ?? 0,
        team_abbreviation: coerceString(row["TEAM_ABBREVIATION"]),
        team_city: coerceString(row["TEAM_CITY"]),
        start_position: startPosition,
        comment,
        minutes: typeof minutesValue === "string" ? minutesValue : coerceString(minutesValue),
        field_goals_made: coerceNumber(row["FGM"]),
        field_goals_attempted: coerceNumber(row["FGA"]),
        field_goal_pct: coerceNumber(row["FG_PCT"]),
        three_point_made: coerceNumber(row["FG3M"]),
        three_point_attempted: coerceNumber(row["FG3A"]),
        three_point_pct: coerceNumber(row["FG3_PCT"]),
        free_throws_made: coerceNumber(row["FTM"]),
        free_throws_attempted: coerceNumber(row["FTA"]),
        free_throw_pct: coerceNumber(row["FT_PCT"]),
        offensive_rebounds: coerceNumber(row["OREB"]),
        defensive_rebounds: coerceNumber(row["DREB"]),
        rebounds: coerceNumber(row["REB"]),
        assists: coerceNumber(row["AST"]),
        steals: coerceNumber(row["STL"]),
        blocks: coerceNumber(row["BLK"]),
        turnovers: coerceNumber(row["TO"]),
        fouls: coerceNumber(row["PF"]),
        points: coerceNumber(row["PTS"]),
        plus_minus: coerceNumber(row["PLUS_MINUS"]),
      };
    });

    const teamTotals: BoxScoreTeamTotals[] = teamRows.map((row) => {
      const minutesValue = row["MIN"];
      return {
        team_id: coerceInt(row["TEAM_ID"]) ?? 0,
        team_name: coerceString(row["TEAM_NAME"]),
        team_abbreviation: coerceString(row["TEAM_ABBREVIATION"]),
        minutes: typeof minutesValue === "string" ? minutesValue : coerceString(minutesValue),
        field_goals_made: coerceNumber(row["FGM"]),
        field_goals_attempted: coerceNumber(row["FGA"]),
        field_goal_pct: coerceNumber(row["FG_PCT"]),
        three_point_made: coerceNumber(row["FG3M"]),
        three_point_attempted: coerceNumber(row["FG3A"]),
        three_point_pct: coerceNumber(row["FG3_PCT"]),
        free_throws_made: coerceNumber(row["FTM"]),
        free_throws_attempted: coerceNumber(row["FTA"]),
        free_throw_pct: coerceNumber(row["FT_PCT"]),
        offensive_rebounds: coerceNumber(row["OREB"]),
        defensive_rebounds: coerceNumber(row["DREB"]),
        rebounds: coerceNumber(row["REB"]),
        assists: coerceNumber(row["AST"]),
        steals: coerceNumber(row["STL"]),
        blocks: coerceNumber(row["BLK"]),
        turnovers: coerceNumber(row["TO"]),
        fouls: coerceNumber(row["PF"]),
        points: coerceNumber(row["PTS"]),
        plus_minus: coerceNumber(row["PLUS_MINUS"]),
      };
    });

    const starterBench: BoxScoreStarterBenchRow[] = starterBenchRows.map((row) => {
      const minutesValue = row["MIN"];
      return {
        team_id: coerceInt(row["TEAM_ID"]) ?? 0,
        team_name: coerceString(row["TEAM_NAME"]),
        team_abbreviation: coerceString(row["TEAM_ABBREVIATION"]),
        label: coerceString(row["STARTERS_BENCH"]) ?? "Starters",
        minutes: typeof minutesValue === "string" ? minutesValue : coerceString(minutesValue),
        field_goals_made: coerceNumber(row["FGM"]),
        field_goals_attempted: coerceNumber(row["FGA"]),
        field_goal_pct: coerceNumber(row["FG_PCT"]),
        three_point_made: coerceNumber(row["FG3M"]),
        three_point_attempted: coerceNumber(row["FG3A"]),
        three_point_pct: coerceNumber(row["FG3_PCT"]),
        free_throws_made: coerceNumber(row["FTM"]),
        free_throws_attempted: coerceNumber(row["FTA"]),
        free_throw_pct: coerceNumber(row["FT_PCT"]),
        offensive_rebounds: coerceNumber(row["OREB"]),
        defensive_rebounds: coerceNumber(row["DREB"]),
        rebounds: coerceNumber(row["REB"]),
        assists: coerceNumber(row["AST"]),
        steals: coerceNumber(row["STL"]),
        blocks: coerceNumber(row["BLK"]),
        turnovers: coerceNumber(row["TO"]),
        fouls: coerceNumber(row["PF"]),
        points: coerceNumber(row["PTS"]),
      };
    });

    return { players, teamTotals, starterBench };
  } catch (error) {
    console.error("Error loading traditional boxscore from stats.nba.com", error);
    return null;
  }
}

function statLineFromLeader(leader: BoxScoreTeamLeader) {
  if (leader.stat_line && leader.stat_line.trim().length > 0) {
    return leader.stat_line;
  }
  const parts: string[] = [];
  if (leader.points !== null && leader.points !== undefined) parts.push(`${leader.points} PTS`);
  if (leader.rebounds !== null && leader.rebounds !== undefined) parts.push(`${leader.rebounds} REB`);
  if (leader.assists !== null && leader.assists !== undefined) parts.push(`${leader.assists} AST`);
  return parts.length ? parts.join(" • ") : "Impact TBA";
}

function TraditionalTable({
  team,
  players,
  totals,
}: {
  team: BoxScoreTeamInfo;
  players: BoxScoreTraditionalPlayer[];
  totals?: BoxScoreTeamTotals;
}) {
  if (!players.length) {
    return (
      <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-6 text-sm text-[color:var(--color-app-foreground-muted)] dark:border-white/10 dark:bg-slate-950/40 dark:text-white/60">
        No traditional box score data available for {team.team_name ?? team.team_abbreviation ?? "this team"}.
      </div>
    );
  }

  const sortedPlayers = [...players].sort((a, b) => {
    const aDnp = didNotPlay(a.minutes);
    const bDnp = didNotPlay(b.minutes);
    if (aDnp !== bDnp) return aDnp ? 1 : -1;
    return minutesToSeconds(b.minutes) - minutesToSeconds(a.minutes);
  });

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm text-[color:var(--color-app-foreground)] dark:text-white/80">
        <thead className="text-[0.65rem] uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">
          <tr>
            <th className="px-3 py-2 text-left">Player</th>
            <th className="px-3 py-2">Min</th>
            <th className="px-3 py-2">FG</th>
            <th className="px-3 py-2">3PT</th>
            <th className="px-3 py-2">FT</th>
            <th className="px-3 py-2">REB</th>
            <th className="px-3 py-2">AST</th>
            <th className="px-3 py-2">STL</th>
            <th className="px-3 py-2">BLK</th>
            <th className="px-3 py-2">TO</th>
            <th className="px-3 py-2">PF</th>
            <th className="px-3 py-2">PTS</th>
            <th className="px-3 py-2">+/-</th>
          </tr>
        </thead>
        <tbody>
          {sortedPlayers.map((player) => {
            const dnp = didNotPlay(player.minutes);
            const fg = dnp ? "-" : `${formatNumber(player.field_goals_made, 1)}/${formatNumber(player.field_goals_attempted, 1)}`;
            const fg3 = dnp ? "-" : `${formatNumber(player.three_point_made, 1)}/${formatNumber(player.three_point_attempted, 1)}`;
            const ft = dnp ? "-" : `${formatNumber(player.free_throws_made, 1)}/${formatNumber(player.free_throws_attempted, 1)}`;
            return (
              <tr key={`${team.team_id}-${player.player_id}-${player.player_name}`} className="border-t border-[color:var(--color-app-border)] dark:border-white/10">
                <td className="px-3 py-2 text-left text-[color:var(--color-app-foreground)] dark:text-white">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{player.player_name}</span>
                    {player.start_position ? (
                      <span className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">{player.start_position}</span>
                    ) : null}
                  </div>
                  {player.comment ? (
                    <p className="text-[0.7rem] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">{player.comment}</p>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-center font-semibold">{dnp ? "DNP" : player.minutes ?? "—"}</td>
                <td className="px-3 py-2 text-center">{fg}</td>
                <td className="px-3 py-2 text-center">{fg3}</td>
                <td className="px-3 py-2 text-center">{ft}</td>
                <td className="px-3 py-2 text-center">{dnp ? "-" : formatNumber(player.rebounds, 1)}</td>
                <td className="px-3 py-2 text-center">{dnp ? "-" : formatNumber(player.assists, 1)}</td>
                <td className="px-3 py-2 text-center">{dnp ? "-" : formatNumber(player.steals, 1)}</td>
                <td className="px-3 py-2 text-center">{dnp ? "-" : formatNumber(player.blocks, 1)}</td>
                <td className="px-3 py-2 text-center">{dnp ? "-" : formatNumber(player.turnovers, 1)}</td>
                <td className="px-3 py-2 text-center">{dnp ? "-" : formatNumber(player.fouls, 1)}</td>
                <td className="px-3 py-2 text-center">{dnp ? "-" : formatNumber(player.points, 1)}</td>
                <td className="px-3 py-2 text-center">{dnp ? "-" : formatNumber(player.plus_minus, 1)}</td>
              </tr>
            );
          })}
          {totals ? (
            <tr className="border-t border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] text-[color:var(--color-app-foreground)] dark:border-white/20 dark:bg-white/5 dark:text-white">
              <td className="px-3 py-2 text-left font-semibold text-[color:var(--color-app-foreground)] dark:text-white">Totals</td>
              <td className="px-3 py-2 text-center">{totals.minutes ?? "—"}</td>
              <td className="px-3 py-2 text-center">{`${formatNumber(totals.field_goals_made, 1)}/${formatNumber(totals.field_goals_attempted, 1)}`}</td>
              <td className="px-3 py-2 text-center">{`${formatNumber(totals.three_point_made, 1)}/${formatNumber(totals.three_point_attempted, 1)}`}</td>
              <td className="px-3 py-2 text-center">{`${formatNumber(totals.free_throws_made, 1)}/${formatNumber(totals.free_throws_attempted, 1)}`}</td>
              <td className="px-3 py-2 text-center">{formatNumber(totals.rebounds, 1)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(totals.assists, 1)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(totals.steals, 1)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(totals.blocks, 1)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(totals.turnovers, 1)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(totals.fouls, 1)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(totals.points, 1)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(totals.plus_minus, 1)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function AdvancedTable({
  team,
  players,
}: {
  team: BoxScoreTeamInfo;
  players: BoxScoreAdvancedPlayer[];
}) {
  if (!players.length) {
    return (
      <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-6 text-sm text-[color:var(--color-app-foreground-muted)] dark:border-white/10 dark:bg-slate-950/40 dark:text-white/60">
        No advanced metrics have been published yet for {team.team_name ?? team.team_abbreviation ?? "this team"}.
      </div>
    );
  }
  const sortedPlayers = [...players].sort((a, b) => minutesToSeconds(b.minutes) - minutesToSeconds(a.minutes));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm text-[color:var(--color-app-foreground)] dark:text-white/80">
        <thead className="text-[0.6rem] uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">
          <tr>
            <th className="px-3 py-2 text-left">Player</th>
            <th className="px-3 py-2">Min</th>
            <th className="px-3 py-2">OffRtg</th>
            <th className="px-3 py-2">DefRtg</th>
            <th className="px-3 py-2">Net</th>
            <th className="px-3 py-2">USG%</th>
            <th className="px-3 py-2">TS%</th>
            <th className="px-3 py-2">eFG%</th>
            <th className="px-3 py-2">AST%</th>
            <th className="px-3 py-2">REB%</th>
            <th className="px-3 py-2">PACE</th>
            <th className="px-3 py-2">PIE</th>
          </tr>
        </thead>
        <tbody>
          {sortedPlayers.map((player) => (
            <tr key={`${team.team_id}-adv-${player.player_id}-${player.player_name}`} className="border-t border-[color:var(--color-app-border)] dark:border-white/10">
              <td className="px-3 py-2 text-left text-[color:var(--color-app-foreground)] dark:text-white">{player.player_name}</td>
              <td className="px-3 py-2 text-center">{player.minutes ?? "—"}</td>
              <td className="px-3 py-2 text-center">{formatNumber(player.offensive_rating, 1)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(player.defensive_rating, 1)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(player.net_rating, 1)}</td>
              <td className="px-3 py-2 text-center">{formatPercent(player.usage_pct)}</td>
              <td className="px-3 py-2 text-center">{formatPercent(player.true_shooting_pct)}</td>
              <td className="px-3 py-2 text-center">{formatPercent(player.effective_fg_pct)}</td>
              <td className="px-3 py-2 text-center">{formatPercent(player.assist_pct)}</td>
              <td className="px-3 py-2 text-center">{formatPercent(player.rebound_pct)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(player.pace, 2)}</td>
              <td className="px-3 py-2 text-center">{formatNumber(player.pie, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttendanceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
      <path
        d="M12 12.5a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 12.5Z"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 19.5c.7-3.2 3.8-5.5 7.5-5.5s6.8 2.3 7.5 5.5"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TeamScoreCard({ team }: { team: BoxScoreTeamInfo }) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-5 text-[color:var(--color-app-foreground)] shadow-[0_14px_40px_-18px_rgba(0,0,0,0.2)] dark:border-white/10 dark:bg-slate-900/80 dark:text-white dark:shadow-[0_14px_40px_-18px_rgba(0,0,0,0.65)]">
      <p className="text-xs uppercase tracking-[0.25em] text-[color:var(--color-app-foreground-muted)] dark:text-white/60">{team.team_abbreviation ?? "TEAM"}</p>
      <p className="mt-2 text-xl font-semibold leading-tight">{team.team_name ?? team.team_abbreviation ?? "Team"}</p>
      <p className="text-xs text-[color:var(--color-app-foreground-muted)] dark:text-white/60">{team.record ?? "Record pending"}</p>
      <p className="mt-4 text-6xl font-black leading-none tracking-tight">{team.score}</p>
      <div className="mt-4 space-y-2 text-sm text-[color:var(--color-app-foreground-muted)] dark:text-white/70">
        {team.leaders.length === 0 ? (
          <p className="text-xs text-[color:var(--color-app-foreground-muted)] dark:text-white/50">Leaders will populate shortly.</p>
        ) : (
          team.leaders.map((leader) => (
            <div
              key={`${team.team_id}-${leader.player_id}-${leader.player_name}`}
              className="rounded-xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] px-3 py-2 dark:border-white/5 dark:bg-slate-950/60"
            >
              <p className="font-semibold text-[color:var(--color-app-foreground)] dark:text-white">{leader.player_name}</p>
              <p className="text-xs text-[color:var(--color-app-foreground-muted)] dark:text-white/60">{statLineFromLeader(leader)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default async function BoxscorePage({ params }: { params: Promise<BoxScoreParams> }) {
  const resolvedParams = await params;
  const id = getParamValue(resolvedParams.id) ?? getParamValue(resolvedParams[":id"]);
  if (!id) {
    console.error("No game ID provided");
    notFound();
  }

  let boxscore: BoxScoreGame;
  try {
    boxscore = await nbaFetch<BoxScoreGame>(`/v1/boxscores/${id}`);
  } catch (error) {
    console.error("Failed to load boxscore", error);
    notFound();
  }

  const traditionalData = await fetchTraditionalBoxScore(id);

  const traditionalPlayers = traditionalData?.players?.length ? traditionalData.players : boxscore.traditional_players;
  const teamTotals = traditionalData?.teamTotals?.length ? traditionalData.teamTotals : boxscore.team_totals;
  const starterBench = traditionalData?.starterBench?.length ? traditionalData.starterBench : boxscore.starter_bench;

  const traditionalByTeam = groupByTeam(traditionalPlayers);
  const advancedByTeam = groupByTeam(boxscore.advanced_players);
  const totalsByTeam = teamTotals.reduce((acc, row) => {
    acc[row.team_id] = row;
    return acc;
  }, {} as Record<number, BoxScoreTeamTotals>);

  const homePlayers = traditionalByTeam[boxscore.home_team.team_id] ?? [];
  const awayPlayers = traditionalByTeam[boxscore.away_team.team_id] ?? [];
  const homeAdvanced = advancedByTeam[boxscore.home_team.team_id] ?? [];
  const awayAdvanced = advancedByTeam[boxscore.away_team.team_id] ?? [];

  return (
    <div className="space-y-10 text-[color:var(--color-app-foreground)] dark:text-white">
      <Link
        href="/scores"
        className="inline-flex items-center gap-2 text-sm text-[color:var(--color-app-foreground-muted)] transition hover:text-[color:var(--color-app-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-app-primary-soft)] dark:text-white/70 dark:hover:text-white dark:focus-visible:ring-white/40"
      >
        <span aria-hidden="true">←</span>
        Back to scores
      </Link>

      <section className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-6 shadow-lg shadow-[0_14px_40px_-18px_rgba(0,0,0,0.2)] dark:border-white/10 dark:bg-slate-950/60 dark:shadow-black/30">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[color:var(--color-app-foreground-muted)] dark:text-white/60">
          <p className="font-medium text-[color:var(--color-app-foreground)] dark:text-white">{boxscore.status ?? "Final"}</p>
          <p>{formatTipoff(boxscore.start_time)}</p>
        </div>
        <p className="mt-2 text-xs uppercase tracking-[0.35em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">
          {boxscore.arena ?? `${boxscore.home_team.team_city ?? "Home"}`}
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <TeamScoreCard team={boxscore.away_team} />
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface)] p-6 text-center text-[color:var(--color-app-foreground)] shadow-[0_14px_40px_-18px_rgba(0,0,0,0.2)] dark:border-white/10 dark:bg-slate-900/70 dark:text-white dark:shadow-[0_14px_40px_-18px_rgba(0,0,0,0.65)]">
            <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">{boxscore.status ?? "Final"}</p>
            <div className="mt-4 flex items-end justify-center gap-6 text-[color:var(--color-app-foreground)] dark:text-white">
              <div className="text-center">
                <p className="text-[0.75rem] uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">
                  {boxscore.away_team.team_abbreviation ?? "Away"}
                </p>
                <p className="text-6xl font-black leading-none tracking-tight">{boxscore.away_team.score}</p>
              </div>
              <span className="pb-2 text-2xl font-semibold text-[color:var(--color-app-foreground-muted)] dark:text-white/50">–</span>
              <div className="text-center">
                <p className="text-[0.75rem] uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">
                  {boxscore.home_team.team_abbreviation ?? "Home"}
                </p>
                <p className="text-6xl font-black leading-none tracking-tight">{boxscore.home_team.score}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2 text-sm text-[color:var(--color-app-foreground-muted)] dark:text-white/70">
              <AttendanceIcon className="h-4 w-4 text-[color:var(--color-app-foreground-muted)] dark:text-white/50" />
              <span className="font-medium text-[color:var(--color-app-foreground)] dark:text-white">{formatAttendance(boxscore.attendance)}</span>
            </div>
          </div>
          <TeamScoreCard team={boxscore.home_team} />
        </div>
      </section>

      <section className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-6 dark:border-white/10 dark:bg-slate-950/60">
        <p className="text-xs uppercase tracking-[0.35em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">Line score</p>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-center text-sm text-[color:var(--color-app-foreground)] dark:text-white/80">
            <thead className="text-xs uppercase tracking-[0.25em] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">
              <tr>
                <th className="px-3 py-2 text-left">Team</th>
                {boxscore.line_score.map((period) => (
                  <th key={period.label} className="px-3 py-2">
                    {period.label}
                  </th>
                ))}
                <th className="px-3 py-2">Final</th>
              </tr>
            </thead>
            <tbody>
              {[boxscore.away_team, boxscore.home_team].map((team) => (
                <tr key={`${team.team_id}-line`} className="border-t border-[color:var(--color-app-border)] dark:border-white/10">
                  <td className="px-3 py-2 text-left font-semibold text-[color:var(--color-app-foreground)] dark:text-white">{team.team_name ?? team.team_abbreviation ?? "Team"}</td>
                  {boxscore.line_score.map((period) => (
                    <td key={`${team.team_id}-${period.label}`} className="px-3 py-2">
                      {team.team_id === boxscore.home_team.team_id ? period.home : period.away}
                    </td>
                  ))}
                  <td className="px-3 py-2 font-semibold text-[color:var(--color-app-foreground)] dark:text-white">{team.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-6 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-6 dark:border-white/10 dark:bg-slate-950/60">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">Traditional box score</p>
          <p className="text-sm text-[color:var(--color-app-foreground-muted)] dark:text-white/60">Field goals, usage, and hustle numbers pulled directly from stats.nba.com.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <TraditionalTable team={boxscore.away_team} players={awayPlayers} totals={totalsByTeam[boxscore.away_team.team_id]} />
          <TraditionalTable team={boxscore.home_team} players={homePlayers} totals={totalsByTeam[boxscore.home_team.team_id]} />
        </div>
      </section>

      <section className="space-y-6 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-6 dark:border-white/10 dark:bg-slate-950/60">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">Advanced impact</p>
          <p className="text-sm text-[color:var(--color-app-foreground-muted)] dark:text-white/60">Offensive rating, usage, and possession efficiency for every player.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <AdvancedTable team={boxscore.away_team} players={awayAdvanced} />
          <AdvancedTable team={boxscore.home_team} players={homeAdvanced} />
        </div>
      </section>

      {starterBench.length ? (
        <section className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-6 dark:border-white/10 dark:bg-slate-950/60">
          <p className="text-xs uppercase tracking-[0.35em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">Rotation splits</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {starterBench.map((row) => (
              <div
                key={`${row.team_id}-${row.label}`}
                className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-4 text-sm text-[color:var(--color-app-foreground)] dark:border-white/10 dark:bg-white/5 dark:text-white/80"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[color:var(--color-app-foreground)] dark:text-white">{row.team_name ?? row.team_abbreviation ?? "Team"}</p>
                  <span className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">{row.label}</span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-[0.75rem]">
                  <div>
                    <dt className="text-[color:var(--color-app-foreground-muted)] dark:text-white/50">PTS</dt>
                    <dd className="text-[color:var(--color-app-foreground)] dark:text-white">{formatNumber(row.points, 1)}</dd>
                  </div>
                  <div>
                    <dt className="text-[color:var(--color-app-foreground-muted)] dark:text-white/50">REB</dt>
                    <dd className="text-[color:var(--color-app-foreground)] dark:text-white">{formatNumber(row.rebounds, 1)}</dd>
                  </div>
                  <div>
                    <dt className="text-[color:var(--color-app-foreground-muted)] dark:text-white/50">AST</dt>
                    <dd className="text-[color:var(--color-app-foreground)] dark:text-white">{formatNumber(row.assists, 1)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {boxscore.officials.length ? (
        <section className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-6 dark:border-white/10 dark:bg-slate-950/60">
          <p className="text-xs uppercase tracking-[0.35em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">Officials</p>
          <ul className="mt-3 flex flex-wrap gap-3 text-sm text-[color:var(--color-app-foreground-muted)] dark:text-white/70">
            {boxscore.officials.map((name) => (
              <li
                key={name}
                className="rounded-full border border-[color:var(--color-app-border)] px-3 py-1 text-[color:var(--color-app-foreground)] dark:border-white/10 dark:text-white"
              >
                {name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
