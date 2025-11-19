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
      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 text-sm text-white/60">
        No traditional box score data available for {team.team_name ?? team.team_abbreviation ?? "this team"}.
      </div>
    );
  }

  const sortedPlayers = [...players].sort((a, b) => {
    const aMinutes = a.comment ? -1 : minutesToSeconds(a.minutes);
    const bMinutes = b.comment ? -1 : minutesToSeconds(b.minutes);
    return bMinutes - aMinutes;
  });

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm text-white/80">
        <thead className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
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
          {sortedPlayers.map((player) => (
            <tr key={`${team.team_id}-${player.player_id}-${player.player_name}`} className="border-t border-white/10">
              <td className="px-3 py-2 text-left text-white">
                <div className="flex items-center gap-2">
                  <span>{player.player_name}</span>
                  {player.start_position ? (
                    <span className="text-xs uppercase tracking-[0.3em] text-white/40">{player.start_position}</span>
                  ) : null}
                </div>
                {player.comment ? <p className="text-[0.7rem] text-white/50">{player.comment}</p> : null}
              </td>
              <td className="px-3 py-2 text-center">{player.minutes ?? "—"}</td>
              {player.comment ? (
                <td colSpan={11} className="px-3 py-2 text-center text-white/50">
                  DNP — {player.comment}
                </td>
              ) : (
                <>
                  <td className="px-3 py-2 text-center">{`${formatNumber(player.field_goals_made, 1)}/${formatNumber(player.field_goals_attempted, 1)}`}</td>
                  <td className="px-3 py-2 text-center">{`${formatNumber(player.three_point_made, 1)}/${formatNumber(player.three_point_attempted, 1)}`}</td>
                  <td className="px-3 py-2 text-center">{`${formatNumber(player.free_throws_made, 1)}/${formatNumber(player.free_throws_attempted, 1)}`}</td>
                  <td className="px-3 py-2 text-center">{formatNumber(player.rebounds, 1)}</td>
                  <td className="px-3 py-2 text-center">{formatNumber(player.assists, 1)}</td>
                  <td className="px-3 py-2 text-center">{formatNumber(player.steals, 1)}</td>
                  <td className="px-3 py-2 text-center">{formatNumber(player.blocks, 1)}</td>
                  <td className="px-3 py-2 text-center">{formatNumber(player.turnovers, 1)}</td>
                  <td className="px-3 py-2 text-center">{formatNumber(player.fouls, 1)}</td>
                  <td className="px-3 py-2 text-center">{formatNumber(player.points, 1)}</td>
                  <td className="px-3 py-2 text-center">{formatNumber(player.plus_minus, 1)}</td>
                </>
              )}
            </tr>
          ))}
          {totals ? (
            <tr className="border-t border-white/20 bg-white/5 text-white">
              <td className="px-3 py-2 text-left font-semibold">Totals</td>
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
      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 text-sm text-white/60">
        No advanced metrics have been published yet for {team.team_name ?? team.team_abbreviation ?? "this team"}.
      </div>
    );
  }
  const sortedPlayers = [...players].sort((a, b) => minutesToSeconds(b.minutes) - minutesToSeconds(a.minutes));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm text-white/80">
        <thead className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
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
            <tr key={`${team.team_id}-adv-${player.player_id}-${player.player_name}`} className="border-t border-white/10">
              <td className="px-3 py-2 text-left text-white">{player.player_name}</td>
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

function TeamScoreCard({ team }: { team: BoxScoreTeamInfo }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-white">
      <p className="text-xs uppercase tracking-[0.25em] text-white/50">{team.team_abbreviation ?? "TEAM"}</p>
      <p className="mt-2 text-xl font-semibold">{team.team_name ?? team.team_abbreviation ?? "Team"}</p>
      <p className="text-xs text-white/60">{team.record ?? "Record pending"}</p>
      <p className="mt-4 text-5xl font-bold">{team.score}</p>
      <div className="mt-4 space-y-2 text-sm text-white/70">
        {team.leaders.length === 0 ? (
          <p className="text-xs text-white/50">Leaders will populate shortly.</p>
        ) : (
          team.leaders.map((leader) => (
            <div key={`${team.team_id}-${leader.player_id}-${leader.player_name}`} className="rounded-xl bg-black/20 px-3 py-2">
              <p className="font-semibold text-white">{leader.player_name}</p>
              <p className="text-xs text-white/60">{statLineFromLeader(leader)}</p>
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

  const traditionalByTeam = groupByTeam(boxscore.traditional_players);
  const advancedByTeam = groupByTeam(boxscore.advanced_players);
  const totalsByTeam = boxscore.team_totals.reduce((acc, row) => {
    acc[row.team_id] = row;
    return acc;
  }, {} as Record<number, BoxScoreTeamTotals>);

  const homePlayers = traditionalByTeam[boxscore.home_team.team_id] ?? [];
  const awayPlayers = traditionalByTeam[boxscore.away_team.team_id] ?? [];
  const homeAdvanced = advancedByTeam[boxscore.home_team.team_id] ?? [];
  const awayAdvanced = advancedByTeam[boxscore.away_team.team_id] ?? [];

  return (
    <div className="space-y-10">
      <Link
        href="/scores"
        className="inline-flex items-center gap-2 text-sm text-white/70 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <span aria-hidden="true">←</span>
        Back to scores
      </Link>

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-black/30">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/60">
          <p>{boxscore.status ?? "Final"}</p>
          <p>{formatTipoff(boxscore.start_time)}</p>
        </div>
        <p className="mt-2 text-xs uppercase tracking-[0.35em] text-white/40">
          {boxscore.arena ?? `${boxscore.home_team.team_city ?? "Home"}`}
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <TeamScoreCard team={boxscore.away_team} />
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 p-5 text-center text-white/70">
            <p className="text-xs uppercase tracking-[0.35em] text-white/40">Attendance</p>
            <p className="mt-2 text-3xl font-semibold text-white">{formatAttendance(boxscore.attendance)}</p>
            <p className="mt-4 text-sm text-white/70">
              {boxscore.summary ?? `Detailed recap not available yet for ${boxscore.home_team.team_name ?? "this game"}.`}
            </p>
          </div>
          <TeamScoreCard team={boxscore.home_team} />
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <p className="text-xs uppercase tracking-[0.35em] text-white/40">Line score</p>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-center text-sm text-white/80">
            <thead className="text-xs uppercase tracking-[0.25em] text-white/50">
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
                <tr key={`${team.team_id}-line`} className="border-t border-white/10">
                  <td className="px-3 py-2 text-left font-semibold text-white">{team.team_name ?? team.team_abbreviation ?? "Team"}</td>
                  {boxscore.line_score.map((period) => (
                    <td key={`${team.team_id}-${period.label}`} className="px-3 py-2">
                      {team.team_id === boxscore.home_team.team_id ? period.home : period.away}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-white">{team.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-white/40">Traditional box score</p>
          <p className="text-sm text-white/60">Field goals, usage, and hustle numbers pulled directly from stats.nba.com.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <TraditionalTable team={boxscore.away_team} players={awayPlayers} totals={totalsByTeam[boxscore.away_team.team_id]} />
          <TraditionalTable team={boxscore.home_team} players={homePlayers} totals={totalsByTeam[boxscore.home_team.team_id]} />
        </div>
      </section>

      <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-white/40">Advanced impact</p>
          <p className="text-sm text-white/60">Offensive rating, usage, and possession efficiency for every player.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <AdvancedTable team={boxscore.away_team} players={awayAdvanced} />
          <AdvancedTable team={boxscore.home_team} players={homeAdvanced} />
        </div>
      </section>

      {boxscore.starter_bench.length ? (
        <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-white/40">Rotation splits</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {boxscore.starter_bench.map((row) => (
              <div key={`${row.team_id}-${row.label}`} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-white">{row.team_name ?? row.team_abbreviation ?? "Team"}</p>
                  <span className="text-xs uppercase tracking-[0.3em] text-white/50">{row.label}</span>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-[0.75rem]">
                  <div>
                    <dt className="text-white/50">PTS</dt>
                    <dd className="text-white">{formatNumber(row.points, 1)}</dd>
                  </div>
                  <div>
                    <dt className="text-white/50">REB</dt>
                    <dd className="text-white">{formatNumber(row.rebounds, 1)}</dd>
                  </div>
                  <div>
                    <dt className="text-white/50">AST</dt>
                    <dd className="text-white">{formatNumber(row.assists, 1)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {boxscore.officials.length ? (
        <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-white/40">Officials</p>
          <ul className="mt-3 flex flex-wrap gap-3 text-sm text-white/70">
            {boxscore.officials.map((name) => (
              <li key={name} className="rounded-full border border-white/10 px-3 py-1">
                {name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
