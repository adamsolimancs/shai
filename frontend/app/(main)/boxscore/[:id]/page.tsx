import Link from "next/link";
import { notFound } from "next/navigation";

import DataFreshness from "@/components/DataFreshness";
import { nbaFetchEnvelope, NbaApiError, type Envelope } from "@/lib/nbaApi";
import { slugifySegment } from "@/lib/utils";

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

type TopPerformer = {
  playerId: number | null;
  playerName: string;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  impact: number;
};

const HEADSHOT_BASE = "https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190";

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
    return null;
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

const STARTER_POSITION_ORDER: Record<string, number> = {
  PG: 0,
  SG: 1,
  SF: 2,
  PF: 3,
  C: 4,
};

function starterPositionRank(position?: string | null) {
  if (!position) return Number.MAX_SAFE_INTEGER;
  const normalized = position.trim().toUpperCase();
  return STARTER_POSITION_ORDER[normalized] ?? STARTER_POSITION_ORDER.C + 1;
}

function numericStat(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return value;
}

function isStarter(player: BoxScoreTraditionalPlayer) {
  return Boolean(player.start_position && player.start_position.trim().length > 0);
}

function splitTraditionalPlayers(players: BoxScoreTraditionalPlayer[]) {
  const starters = players.filter((player) => isStarter(player)).sort((a, b) => {
    const rankDiff = starterPositionRank(a.start_position) - starterPositionRank(b.start_position);
    if (rankDiff !== 0) return rankDiff;
    return minutesToSeconds(b.minutes) - minutesToSeconds(a.minutes);
  });
  const bench = players.filter((player) => !isStarter(player)).sort((a, b) => {
    const aDnp = didNotPlay(a.minutes);
    const bDnp = didNotPlay(b.minutes);
    if (aDnp !== bDnp) return aDnp ? 1 : -1;
    return minutesToSeconds(b.minutes) - minutesToSeconds(a.minutes);
  });
  return { starters, bench };
}

function totalImpact(points: number | null | undefined, rebounds: number | null | undefined, assists: number | null | undefined) {
  return numericStat(points) + numericStat(rebounds) + numericStat(assists);
}

function topPerformerFromPlayers(players: BoxScoreTraditionalPlayer[]) {
  if (!players.length) return null;
  return players.reduce<BoxScoreTraditionalPlayer | null>((best, player) => {
    if (!best) return player;
    const bestImpact = totalImpact(best.points, best.rebounds, best.assists);
    const playerImpact = totalImpact(player.points, player.rebounds, player.assists);
    if (playerImpact !== bestImpact) return playerImpact > bestImpact ? player : best;
    const pointDiff = numericStat(player.points) - numericStat(best.points);
    if (pointDiff !== 0) return pointDiff > 0 ? player : best;
    return minutesToSeconds(player.minutes) > minutesToSeconds(best.minutes) ? player : best;
  }, null);
}

function topPerformerFromLeaders(leaders: BoxScoreTeamLeader[]) {
  if (!leaders.length) return null;
  return leaders.reduce<BoxScoreTeamLeader | null>((best, leader) => {
    if (!best) return leader;
    const bestImpact = totalImpact(best.points, best.rebounds, best.assists);
    const leaderImpact = totalImpact(leader.points, leader.rebounds, leader.assists);
    if (leaderImpact !== bestImpact) return leaderImpact > bestImpact ? leader : best;
    return numericStat(leader.points) > numericStat(best.points) ? leader : best;
  }, null);
}

function resolveTopPerformer(team: BoxScoreTeamInfo, players: BoxScoreTraditionalPlayer[]): TopPerformer | null {
  const player = topPerformerFromPlayers(players);
  if (player) {
    return {
      playerId: player.player_id,
      playerName: player.player_name,
      points: player.points,
      rebounds: player.rebounds,
      assists: player.assists,
      impact: totalImpact(player.points, player.rebounds, player.assists),
    };
  }

  const leader = topPerformerFromLeaders(team.leaders);
  if (leader) {
    return {
      playerId: leader.player_id,
      playerName: leader.player_name,
      points: leader.points,
      rebounds: leader.rebounds,
      assists: leader.assists,
      impact: totalImpact(leader.points, leader.rebounds, leader.assists),
    };
  }

  return null;
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

function playerProfileHref(playerId?: number | null, playerName?: string | null) {
  if (typeof playerId === "number" && Number.isFinite(playerId) && playerId > 0) {
    return `/players/${playerId}`;
  }
  const slug = slugifySegment(playerName ?? "");
  return slug ? `/players/${slug}` : null;
}

function PlayerNameLink({
  playerId,
  playerName,
  className,
}: {
  playerId?: number | null;
  playerName: string;
  className?: string;
}) {
  const href = playerProfileHref(playerId, playerName);
  if (!href) {
    return <span className={className}>{playerName}</span>;
  }
  return (
    <Link
      href={href}
      className={`underline-offset-2 transition hover:underline focus-visible:underline focus-visible:outline-none ${className ?? ""}`}
    >
      {playerName}
    </Link>
  );
}

function groupByTeam<T extends { team_id: number }>(rows: T[]) {
  return rows.reduce((acc, row) => {
    acc[row.team_id] = acc[row.team_id] ?? [];
    acc[row.team_id].push(row);
    return acc;
  }, {} as Record<number, T[]>);
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
      <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-4 text-xs text-[color:var(--color-app-foreground-muted)] dark:border-white/10 dark:bg-slate-950/40 dark:text-white/60 sm:p-6 sm:text-sm">
        No traditional box score data available for {team.team_name ?? team.team_abbreviation ?? "this team"}.
      </div>
    );
  }

  const { starters, bench } = splitTraditionalPlayers(players);

  const renderPlayerRow = (player: BoxScoreTraditionalPlayer) => {
    const dnp = didNotPlay(player.minutes);
    const fg = dnp ? "-" : `${formatNumber(player.field_goals_made, 1)}/${formatNumber(player.field_goals_attempted, 1)}`;
    const fg3 = dnp ? "-" : `${formatNumber(player.three_point_made, 1)}/${formatNumber(player.three_point_attempted, 1)}`;
    const ft = dnp ? "-" : `${formatNumber(player.free_throws_made, 1)}/${formatNumber(player.free_throws_attempted, 1)}`;
    return (
      <tr
        key={`${team.team_id}-${player.player_id}-${player.player_name}`}
        className="border-t border-[color:var(--color-app-border)] transition-colors hover:bg-[color:rgba(var(--color-app-foreground-rgb),0.04)] dark:border-white/10 dark:hover:bg-white/[0.04]"
      >
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-left text-[color:var(--color-app-foreground)] dark:text-white">
          <div className="flex items-center gap-2">
            <PlayerNameLink playerId={player.player_id} playerName={player.player_name} className="font-medium" />
            {player.start_position ? (
              <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">{player.start_position}</span>
            ) : null}
          </div>
          {player.comment ? (
            <p className="text-[0.7rem] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">{player.comment}</p>
          ) : null}
        </td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center font-semibold">{dnp ? "DNP" : player.minutes ?? "—"}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{dnp ? "-" : formatNumber(player.points, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{dnp ? "-" : formatNumber(player.rebounds, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{dnp ? "-" : formatNumber(player.assists, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{dnp ? "-" : formatNumber(player.steals, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{dnp ? "-" : formatNumber(player.blocks, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{fg}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{fg3}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{ft}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{dnp ? "-" : formatNumber(player.turnovers, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{dnp ? "-" : formatNumber(player.fouls, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{dnp ? "-" : formatNumber(player.plus_minus, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center text-xs text-[color:var(--color-app-foreground-muted)] dark:text-white/50">N/A</td>
      </tr>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs text-[color:var(--color-app-foreground)] dark:text-white/80 sm:text-sm">
        <thead className="text-[0.55rem] uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40 sm:text-[0.65rem] sm:tracking-[0.3em]">
          <tr>
            <th className="px-2 py-1 sm:px-3 sm:py-2 text-left">Player</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">Min</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">PTS</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">REB</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">AST</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">STL</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">BLK</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">FG</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">3PT</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">FT</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">TO</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">PF</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">+/-</th>
            <th className="px-2 py-1 sm:px-3 sm:py-2">SHAI Rating</th>
          </tr>
        </thead>
        <tbody>
          {[...starters, ...bench].map((player) => renderPlayerRow(player))}
          {totals ? (
            <tr className="border-t border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] text-[color:var(--color-app-foreground)] dark:border-white/20 dark:bg-white/5 dark:text-white">
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-left font-semibold text-[color:var(--color-app-foreground)] dark:text-white">Totals</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{totals.minutes ?? "—"}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatNumber(totals.points, 1)}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatNumber(totals.rebounds, 1)}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatNumber(totals.assists, 1)}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatNumber(totals.steals, 1)}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatNumber(totals.blocks, 1)}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{`${formatNumber(totals.field_goals_made, 1)}/${formatNumber(totals.field_goals_attempted, 1)}`}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{`${formatNumber(totals.three_point_made, 1)}/${formatNumber(totals.three_point_attempted, 1)}`}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{`${formatNumber(totals.free_throws_made, 1)}/${formatNumber(totals.free_throws_attempted, 1)}`}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatNumber(totals.turnovers, 1)}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatNumber(totals.fouls, 1)}</td>
              <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatNumber(totals.plus_minus, 1)}</td>
              <td className="px-2 py-1 text-center text-[color:var(--color-app-foreground-muted)] dark:text-white/50 sm:px-3 sm:py-2">—</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function TopPerformerCard({
  team,
  performer,
}: {
  team: BoxScoreTeamInfo;
  performer: TopPerformer | null;
}) {
  const headshot = performer?.playerId ? `${HEADSHOT_BASE}/${performer.playerId}.png` : null;
  const playerHref = performer ? playerProfileHref(performer.playerId, performer.playerName) : null;

  return (
    <div className="w-[10rem] rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-3 text-center dark:border-white/10 dark:bg-slate-950/40 sm:w-full sm:max-w-[19rem] sm:p-4">
      <p className="text-[0.55rem] uppercase tracking-[0.16em] text-[color:var(--color-app-foreground-muted)] dark:text-white/45 sm:text-[0.65rem] sm:tracking-[0.28em]">
        {team.team_abbreviation ?? team.team_name ?? "Team"} Top Performer
      </p>
      {performer ? (
        <>
          {headshot && playerHref ? (
            <Link
              href={playerHref}
              aria-label={`Open ${performer.playerName} profile`}
              className="mx-auto mt-2 block h-[64px] w-[88px] overflow-hidden rounded-xl border border-[color:var(--color-app-border)] bg-white/60 transition hover:border-[color:var(--color-app-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-app-primary-soft)] dark:border-white/10 dark:bg-white/5 dark:hover:border-white/25 dark:focus-visible:ring-white/35 sm:mt-3 sm:h-[95px] sm:w-[130px]"
            >
              <div className="h-full w-full bg-cover bg-top bg-no-repeat" style={{ backgroundImage: `url(${headshot})` }} />
            </Link>
          ) : headshot ? (
            <div className="mx-auto mt-2 h-[64px] w-[88px] overflow-hidden rounded-xl border border-[color:var(--color-app-border)] bg-white/60 dark:border-white/10 dark:bg-white/5 sm:mt-3 sm:h-[95px] sm:w-[130px]">
              <div className="h-full w-full bg-cover bg-top bg-no-repeat" style={{ backgroundImage: `url(${headshot})` }} />
            </div>
          ) : null}
          <p className="mt-1 text-sm font-semibold text-[color:var(--color-app-foreground)] dark:text-white sm:mt-2 sm:text-base">
            <PlayerNameLink playerId={performer.playerId} playerName={performer.playerName} />
          </p>
          <p className="mt-1 text-[0.65rem] text-[color:var(--color-app-foreground-muted)] dark:text-white/60 sm:text-xs">
            {formatNumber(performer.points)} PTS • {formatNumber(performer.rebounds)} REB • {formatNumber(performer.assists)} AST
          </p>
          <p className="mt-1 text-[0.65rem] font-medium text-[color:var(--color-app-foreground)] dark:text-white sm:mt-2 sm:text-xs">
            Impact Score: {formatNumber(performer.impact)}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-[color:var(--color-app-foreground-muted)] dark:text-white/60 sm:mt-2 sm:text-sm">No player statline available.</p>
      )}
    </div>
  );
}

function TeamTraditionalSection({
  team,
  players,
  totals,
}: {
  team: BoxScoreTeamInfo;
  players: BoxScoreTraditionalPlayer[];
  totals?: BoxScoreTeamTotals;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-3 dark:border-white/10 dark:bg-slate-900/40 sm:p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 sm:mb-3">
        <p className="text-base font-semibold text-[color:var(--color-app-foreground)] dark:text-white sm:text-lg">{team.team_name ?? team.team_abbreviation ?? "Team"}</p>
        {team.record ? <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">{team.record}</p> : null}
      </div>
      <TraditionalTable team={team} players={players} totals={totals} />
    </div>
  );
}

function formatAdvancedMetric(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }
  return formatNumber(value, digits);
}

function formatAdvancedPercentMetric(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }
  const normalized = value > 1.5 ? value / 100 : value;
  return formatPercent(normalized);
}

function formatAdvancedMinutes(primary?: string | null, fallback?: string | null) {
  if (primary) {
    return didNotPlay(primary) ? "DNP" : primary;
  }
  if (fallback) {
    return didNotPlay(fallback) ? "DNP" : fallback;
  }
  return "N/A";
}

function playerLookupKey(name?: string | null) {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function AdvancedBoxScoreTeamTable({
  team,
  players,
  advancedPlayers,
}: {
  team: BoxScoreTeamInfo;
  players: BoxScoreTraditionalPlayer[];
  advancedPlayers: BoxScoreAdvancedPlayer[];
}) {
  const observedPlayers = players.filter((player) => advancedPlayers.some((row) =>
    (row.player_id === player.player_id || playerLookupKey(row.player_name) === playerLookupKey(player.player_name)) &&
    [row.offensive_rating, row.defensive_rating, row.net_rating, row.usage_pct,
      row.true_shooting_pct, row.assist_pct, row.rebound_pct, row.pace, row.pie]
      .some((value) => value !== null && value !== undefined),
  ));
  if (!observedPlayers.length) {
    return (
      <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-4 text-xs text-[color:var(--color-app-foreground-muted)] dark:border-white/10 dark:bg-slate-950/40 dark:text-white/60 sm:p-6 sm:text-sm">
        No advanced box score data available for {team.team_name ?? team.team_abbreviation ?? "this team"}.
      </div>
    );
  }

  const { starters, bench } = splitTraditionalPlayers(observedPlayers);
  const advancedByPlayer = advancedPlayers.reduce((acc, row) => {
    if (row.player_id > 0) {
      acc[row.player_id] = row;
    }
    return acc;
  }, {} as Record<number, BoxScoreAdvancedPlayer>);
  const advancedByName = advancedPlayers.reduce((acc, row) => {
    const key = playerLookupKey(row.player_name);
    if (key && !acc[key]) {
      acc[key] = row;
    }
    return acc;
  }, {} as Record<string, BoxScoreAdvancedPlayer>);

  const renderRow = (player: BoxScoreTraditionalPlayer) => {
    const advanced =
      advancedByPlayer[player.player_id] ??
      advancedByName[playerLookupKey(player.player_name)];
    return (
      <tr
        key={`${team.team_id}-adv-box-${player.player_id}-${player.player_name}`}
        className="border-t border-[color:var(--color-app-border)] transition-colors hover:bg-[color:rgba(var(--color-app-foreground-rgb),0.04)] dark:border-white/10 dark:hover:bg-white/[0.04]"
      >
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-left text-[color:var(--color-app-foreground)] dark:text-white">
          <div className="flex items-center gap-2">
            <PlayerNameLink playerId={player.player_id} playerName={player.player_name} className="font-medium" />
            {player.start_position ? (
              <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40">{player.start_position}</span>
            ) : null}
          </div>
        </td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedMinutes(player.minutes, advanced?.minutes)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedMetric(advanced?.offensive_rating, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedMetric(advanced?.defensive_rating, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedMetric(advanced?.net_rating, 1)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedPercentMetric(advanced?.usage_pct)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedPercentMetric(advanced?.true_shooting_pct)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedPercentMetric(advanced?.assist_pct)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedPercentMetric(advanced?.rebound_pct)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedMetric(advanced?.pace, 2)}</td>
        <td className="px-2 py-1 sm:px-3 sm:py-2 text-center">{formatAdvancedMetric(advanced?.pie, 3)}</td>
      </tr>
    );
  };

  return (
    <div className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-3 dark:border-white/10 dark:bg-slate-900/40 sm:p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 sm:mb-3">
        <p className="text-base font-semibold text-[color:var(--color-app-foreground)] dark:text-white sm:text-lg">{team.team_name ?? team.team_abbreviation ?? "Team"}</p>
        {team.record ? <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">{team.record}</p> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs text-[color:var(--color-app-foreground)] dark:text-white/80 sm:text-sm">
          <thead className="text-[0.55rem] uppercase tracking-[0.2em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40 sm:text-[0.65rem] sm:tracking-[0.3em]">
            <tr>
              <th className="px-2 py-1 sm:px-3 sm:py-2 text-left">Player</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">Min</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">OffRtg</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">DefRtg</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">Net</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">USG%</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">TS%</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">AST%</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">REB%</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">PACE</th>
              <th className="px-2 py-1 sm:px-3 sm:py-2">PIE</th>
            </tr>
          </thead>
          <tbody>
            {[...starters, ...bench].map((player) => renderRow(player))}
          </tbody>
        </table>
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

  let boxscore: BoxScoreGame | null = null;
  let meta: Envelope<BoxScoreGame>["meta"] | undefined;
  try {
    const response = await nbaFetchEnvelope<BoxScoreGame>(`/v1/boxscores/${id}`);
    boxscore = response.data;
    meta = response.meta;
  } catch (error) {
    if (!(error instanceof NbaApiError && error.status === 404)) {
      console.warn("Failed to load boxscore", error);
      return (
        <div className="space-y-4">
          <Link href="/scores">Back to scores</Link>
          <p role="alert">Box score data is unavailable. Please try again later.</p>
        </div>
      );
    }
  }

  if (!boxscore) return <div className="space-y-4"><Link href="/scores">Back to scores</Link><DataFreshness meta={meta} /><p>No box score is available for this game yet.</p></div>;

  const traditionalPlayers = boxscore.traditional_players ?? [];
  const advancedPlayers = boxscore.advanced_players ?? [];
  const teamTotals = boxscore.team_totals ?? [];
  const starterBench = boxscore.starter_bench ?? [];

  const traditionalByTeam = groupByTeam(traditionalPlayers);
  const advancedByTeam = groupByTeam(advancedPlayers.filter((player) => player.team_id > 0));
  const totalsByTeam = teamTotals.reduce((acc, row) => {
    acc[row.team_id] = row;
    return acc;
  }, {} as Record<number, BoxScoreTeamTotals>);

  const homePlayers = traditionalByTeam[boxscore.home_team.team_id] ?? [];
  const awayPlayers = traditionalByTeam[boxscore.away_team.team_id] ?? [];
  const homeAdvanced = advancedByTeam[boxscore.home_team.team_id] ?? [];
  const awayAdvanced = advancedByTeam[boxscore.away_team.team_id] ?? [];
  const homeAdvancedForLineup = homeAdvanced.length ? homeAdvanced : advancedPlayers;
  const awayAdvancedForLineup = awayAdvanced.length ? awayAdvanced : advancedPlayers;
  const awayTopPerformer = resolveTopPerformer(boxscore.away_team, awayPlayers);
  const homeTopPerformer = resolveTopPerformer(boxscore.home_team, homePlayers);
  const attendanceLabel = formatAttendance(boxscore.attendance);
  const venueLabel = boxscore.arena ?? boxscore.home_team.team_city ?? boxscore.home_team.team_name;

  return (
    <div className="relative left-1/2 w-[min(88rem,calc(100vw-0.75rem))] -translate-x-1/2 space-y-4 text-[color:var(--color-app-foreground)] dark:text-white sm:w-[min(88rem,calc(100vw-3rem))] sm:space-y-8">
      <DataFreshness meta={meta} />
      <Link
        href="/scores"
        className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-app-foreground-muted)] transition hover:text-[color:var(--color-app-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-app-primary-soft)] dark:text-white/70 dark:hover:text-white dark:focus-visible:ring-white/40 sm:gap-2 sm:text-sm"
      >
        <span aria-hidden="true">←</span>
        Back to scores
      </Link>

      <section className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-3 shadow-lg shadow-[0_14px_40px_-18px_rgba(0,0,0,0.2)] dark:border-white/10 dark:bg-slate-950/60 dark:shadow-black/30 sm:p-6">
        <div className="flex flex-wrap items-start justify-center gap-2 text-center sm:gap-4">
          <div className="mx-auto">
            <p className="text-[0.65rem] uppercase tracking-[0.28em] text-[color:var(--color-app-foreground-muted)] dark:text-white/45">{boxscore.status ?? "Final"}</p>
            <p className="mt-1 flex items-baseline justify-center gap-2 text-xl font-semibold text-[color:var(--color-app-foreground)] dark:text-white sm:gap-3 sm:text-3xl">
              <span>{boxscore.away_team.team_abbreviation ?? "Away"} {boxscore.away_team.score}</span>
              <span className="text-sm text-[color:var(--color-app-foreground-muted)] dark:text-white/50 sm:text-base">-</span>
              <span>{boxscore.home_team.team_abbreviation ?? "Home"} {boxscore.home_team.score}</span>
            </p>
            <p className="mt-1 text-xs text-[color:var(--color-app-foreground-muted)] dark:text-white/60 sm:text-sm">{formatTipoff(boxscore.start_time)}</p>
            {venueLabel || attendanceLabel ? (
              <p className="mt-1 text-xs text-[color:var(--color-app-foreground-muted)] dark:text-white/60 sm:text-sm">
                {venueLabel ? <span>{venueLabel}</span> : null}
                {venueLabel && attendanceLabel ? <span className="px-1.5 sm:px-2">•</span> : null}
                {attendanceLabel ? <span>{attendanceLabel}</span> : null}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap justify-center gap-1 sm:mt-4">
          <TopPerformerCard team={boxscore.away_team} performer={awayTopPerformer} />
          <TopPerformerCard team={boxscore.home_team} performer={homeTopPerformer} />
        </div>

        {boxscore.officials.length ? (
          <div className="mt-2 border-t border-[color:var(--color-app-border)] pt-2 dark:border-white/10 sm:mt-4 sm:pt-4">
            <p className="text-center text-[0.65rem] uppercase tracking-[0.28em] text-[color:var(--color-app-foreground-muted)] dark:text-white/45">Officials</p>
            <ul className="mt-1 flex flex-wrap justify-center gap-1 text-xs text-[color:var(--color-app-foreground-muted)] dark:text-white/65 sm:mt-2 sm:gap-2 sm:text-sm">
              {boxscore.officials.map((name) => (
                <li key={name} className="rounded-full border border-[color:var(--color-app-border)] px-2 py-0.5 text-[color:var(--color-app-foreground)] dark:border-white/10 dark:text-white sm:px-3 sm:py-1">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-3 dark:border-white/10 dark:bg-slate-950/60 sm:p-6">
        <p className="text-[0.65rem] uppercase tracking-[0.25em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40 sm:text-xs sm:tracking-[0.35em]">Line score</p>
        <div className="mt-2 overflow-auto sm:mt-4">
          <table className="min-w-full text-center text-xs text-[color:var(--color-app-foreground)] dark:text-white/80 sm:text-sm">
            <thead className="text-[0.6rem] uppercase tracking-[0.18em] text-[color:var(--color-app-foreground-muted)] dark:text-white/50 sm:text-xs sm:tracking-[0.25em]">
              <tr>
                <th className="px-2 py-1 sm:px-3 sm:py-2 text-left">Team</th>
                {boxscore.line_score.map((period) => (
                  <th key={period.label} className="px-2 py-1 sm:px-3 sm:py-2">
                    {period.label}
                  </th>
                ))}
                <th className="px-2 py-1 sm:px-3 sm:py-2">Final</th>
              </tr>
            </thead>
            <tbody>
              {[boxscore.away_team, boxscore.home_team].map((team) => (
                <tr
                  key={`${team.team_id}-line`}
                  className="border-t border-[color:var(--color-app-border)] transition-colors hover:bg-[color:rgba(var(--color-app-foreground-rgb),0.04)] dark:border-white/10 dark:hover:bg-white/[0.04]"
                >
                  <td className="px-2 py-1 sm:px-3 sm:py-2 text-left font-semibold text-[color:var(--color-app-foreground)] dark:text-white">{team.team_name ?? team.team_abbreviation ?? "Team"}</td>
                  {boxscore.line_score.map((period) => (
                    <td key={`${team.team_id}-${period.label}`} className="px-2 py-1 sm:px-3 sm:py-2">
                      {team.team_id === boxscore.home_team.team_id ? period.home : period.away}
                    </td>
                  ))}
                  <td className="px-2 py-1 sm:px-3 sm:py-2 font-semibold text-[color:var(--color-app-foreground)] dark:text-white">{team.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-3 dark:border-white/10 dark:bg-slate-950/60 sm:space-y-6 sm:p-6">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40 sm:text-xs sm:tracking-[0.35em]">Traditional box score</p>
        </div>
        <div className="space-y-2 sm:space-y-4">
          <TeamTraditionalSection team={boxscore.away_team} players={awayPlayers} totals={totalsByTeam[boxscore.away_team.team_id]} />
          <TeamTraditionalSection team={boxscore.home_team} players={homePlayers} totals={totalsByTeam[boxscore.home_team.team_id]} />
        </div>
      </section>

      {starterBench.length ? (
        <section className="rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-3 dark:border-white/10 dark:bg-slate-950/60 sm:p-6">
          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40 sm:text-xs sm:tracking-[0.35em]">Rotation splits</p>
          <div className="mt-2 grid gap-2 sm:mt-4 sm:gap-4 md:grid-cols-2">
            {starterBench.map((row) => (
              <div
                key={`${row.team_id}-${row.label}`}
                className="rounded-2xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-soft)] p-3 text-xs text-[color:var(--color-app-foreground)] dark:border-white/10 dark:bg-white/5 dark:text-white/80 sm:p-4 sm:text-sm"
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-[color:var(--color-app-foreground)] dark:text-white">{row.team_name ?? row.team_abbreviation ?? "Team"}</p>
                  <span className="text-xs uppercase tracking-[0.3em] text-[color:var(--color-app-foreground-muted)] dark:text-white/50">{row.label}</span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-[0.7rem] sm:mt-3 sm:gap-3 sm:text-[0.75rem]">
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

      <section className="space-y-3 rounded-3xl border border-[color:var(--color-app-border)] bg-[color:var(--color-app-surface-elevated)] p-3 dark:border-white/10 dark:bg-slate-950/60 sm:space-y-6 sm:p-6">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.25em] text-[color:var(--color-app-foreground-muted)] dark:text-white/40 sm:text-xs sm:tracking-[0.35em]">Advanced Box Score</p>
        </div>
        <div className="space-y-2 sm:space-y-4">
          <AdvancedBoxScoreTeamTable team={boxscore.away_team} players={awayPlayers} advancedPlayers={awayAdvancedForLineup} />
          <AdvancedBoxScoreTeamTable team={boxscore.home_team} players={homePlayers} advancedPlayers={homeAdvancedForLineup} />
        </div>
      </section>
    </div>
  );
}
