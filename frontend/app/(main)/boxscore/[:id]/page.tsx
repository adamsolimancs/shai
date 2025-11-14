import Link from "next/link";
import { notFound } from "next/navigation";

import { unslugifySegment } from "@/lib/utils";

type PlayerLine = {
  name: string;
  role: string;
  statLine: string;
};

type BoxScoreTeam = {
  name: string;
  abbreviation: string;
  record: string;
  score: number;
  leaders: PlayerLine[];
};

type LineScore = {
  label: string;
  home: number;
  away: number;
};

type BoxScore = {
  id: string;
  status: string;
  arena: string;
  startTime: string;
  attendance: number;
  summary: string;
  home: BoxScoreTeam;
  away: BoxScoreTeam;
  lineScore: LineScore[];
};

const MOCK_BOX_SCORES: Record<string, BoxScore> = {
  "test": {
    id: "test",
    status: "Final",
    arena: "Footprint Center — Phoenix, AZ",
    startTime: "2024-03-29T22:00:00Z",
    attendance: 18032,
    summary:
      "Los Angeles outscored Phoenix 36-24 in the fourth behind a 14-3 run sparked by LeBron James and a swarming transition defense.",
    away: {
      name: "Los Angeles Lakers",
      abbreviation: "LAL",
      record: "44-33",
      score: 129,
      leaders: [
        { name: "LeBron James", role: "Forward", statLine: "34 PTS • 12 AST • 8 REB" },
        { name: "Anthony Davis", role: "Center", statLine: "28 PTS • 14 REB • 4 BLK" },
        { name: "Austin Reaves", role: "Guard", statLine: "16 PTS • 7 AST" },
      ],
    },
    home: {
      name: "Phoenix Suns",
      abbreviation: "PHX",
      record: "45-31",
      score: 125,
      leaders: [
        { name: "Kevin Durant", role: "Forward", statLine: "38 PTS • 7 REB" },
        { name: "Devin Booker", role: "Guard", statLine: "31 PTS • 9 AST" },
        { name: "Jusuf Nurkić", role: "Center", statLine: "12 PTS • 15 REB" },
      ],
    },
    lineScore: [
      { label: "Q1", away: 33, home: 31 },
      { label: "Q2", away: 30, home: 35 },
      { label: "Q3", away: 30, home: 35 },
      { label: "Q4", away: 36, home: 24 },
    ],
  },
  "celtics-at-knicks-2024-03-30": {
    id: "celtics-at-knicks-2024-03-30",
    status: "Final",
    arena: "Madison Square Garden — New York, NY",
    startTime: "2024-03-30T23:30:00Z",
    attendance: 19812,
    summary:
      "Boston’s bench flipped the game with a 17-2 burst bridging the third and fourth quarters, while the defense held New York to 5-of-21 from deep.",
    away: {
      name: "Boston Celtics",
      abbreviation: "BOS",
      record: "55-20",
      score: 118,
      leaders: [
        { name: "Jayson Tatum", role: "Forward", statLine: "29 PTS • 9 REB • 5 AST" },
        { name: "Jaylen Brown", role: "Wing", statLine: "24 PTS • 6 REB" },
        { name: "Derrick White", role: "Guard", statLine: "16 PTS • 7 AST" },
      ],
    },
    home: {
      name: "New York Knicks",
      abbreviation: "NYK",
      record: "47-28",
      score: 108,
      leaders: [
        { name: "Jalen Brunson", role: "Guard", statLine: "32 PTS • 8 AST" },
        { name: "Josh Hart", role: "Wing", statLine: "14 PTS • 11 REB" },
        { name: "Isaiah Hartenstein", role: "Center", statLine: "10 PTS • 13 REB" },
      ],
    },
    lineScore: [
      { label: "Q1", away: 28, home: 24 },
      { label: "Q2", away: 30, home: 27 },
      { label: "Q3", away: 25, home: 28 },
      { label: "Q4", away: 35, home: 29 },
    ],
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildFallbackBoxScore(id: string): BoxScore | null {
  if (!id) {
    return null;
  }
  const readable = unslugifySegment(id) || id.toUpperCase();
  return {
    id,
    status: "Final",
    arena: "League Arena",
    startTime: new Date().toISOString(),
    attendance: 17000,
    summary: `${readable} placeholder summary. Live data will populate this page once the real API endpoint is connected.`,
    away: {
      name: "Away Team",
      abbreviation: "AWY",
      record: "0-0",
      score: 100,
      leaders: [
        { name: "Top Scorer", role: "Guard", statLine: "20 PTS • 5 AST" },
        { name: "Glass Cleaner", role: "Forward", statLine: "14 PTS • 12 REB" },
        { name: "Two-Way Anchor", role: "Wing", statLine: "12 PTS • 4 STL" },
      ],
    },
    home: {
      name: "Home Team",
      abbreviation: "HME",
      record: "0-0",
      score: 96,
      leaders: [
        { name: "Closer", role: "Forward", statLine: "22 PTS • 6 REB" },
        { name: "Playmaker", role: "Guard", statLine: "11 PTS • 9 AST" },
        { name: "Anchor", role: "Center", statLine: "10 PTS • 11 REB" },
      ],
    },
    lineScore: [
      { label: "Q1", away: 24, home: 20 },
      { label: "Q2", away: 23, home: 25 },
      { label: "Q3", away: 28, home: 24 },
      { label: "Q4", away: 25, home: 27 },
    ],
  };
}

async function fetchMockBoxScore(id: string): Promise<BoxScore | null> {
  await sleep(180);
  const normalized = id.toLowerCase();
  return MOCK_BOX_SCORES[normalized] ?? buildFallbackBoxScore(normalized);
}

function formatTipoff(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(date));
}

function TeamScoreCard({ team }: { team: BoxScoreTeam }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-white">
      <p className="text-xs uppercase tracking-[0.25em] text-white/50">{team.abbreviation}</p>
      <p className="mt-2 text-xl font-semibold">{team.name}</p>
      <p className="text-xs text-white/60">{team.record}</p>
      <p className="mt-4 text-5xl font-bold">{team.score}</p>
      <div className="mt-4 space-y-2 text-sm text-white/70">
        {team.leaders.map((leader) => (
          <div key={leader.name} className="rounded-xl bg-black/20 px-3 py-2">
            <p className="font-semibold text-white">{leader.name}</p>
            <p className="text-xs text-white/60">{leader.role}</p>
            <p className="text-sm text-white/80">{leader.statLine}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function BoxscorePage({ params }: { params: { id?: string | string[] } }) {
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!id) {
    notFound();
  }

  const boxscore = await fetchMockBoxScore(id);
  if (!boxscore) {
    notFound();
  }

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
          <p>{boxscore.status}</p>
          <p>{formatTipoff(boxscore.startTime)}</p>
        </div>
        <p className="mt-2 text-xs uppercase tracking-[0.35em] text-white/40">{boxscore.arena}</p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <TeamScoreCard team={boxscore.away} />
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 p-5 text-center text-white/70">
            <p className="text-xs uppercase tracking-[0.35em] text-white/40">Attendance</p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {boxscore.attendance.toLocaleString("en-US")}
            </p>
            <p className="mt-4 text-sm">{boxscore.summary}</p>
          </div>
          <TeamScoreCard team={boxscore.home} />
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <p className="text-xs uppercase tracking-[0.35em] text-white/40">Line score</p>
        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-center text-sm text-white/80">
            <thead className="text-xs uppercase tracking-[0.25em] text-white/50">
              <tr>
                <th className="px-3 py-2 text-left">Team</th>
                {boxscore.lineScore.map((period) => (
                  <th key={period.label} className="px-3 py-2">
                    {period.label}
                  </th>
                ))}
                <th className="px-3 py-2">Final</th>
              </tr>
            </thead>
            <tbody>
              {[boxscore.away, boxscore.home].map((team) => (
                <tr key={team.abbreviation} className="border-t border-white/10">
                  <td className="px-3 py-2 text-left font-semibold text-white">{team.name}</td>
                  {boxscore.lineScore.map((period) => (
                    <td key={`${team.abbreviation}-${period.label}`} className="px-3 py-2">
                      {team === boxscore.away ? period.away : period.home}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-white">{team.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <p className="text-xs uppercase tracking-[0.35em] text-white/40">Impact performers</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[boxscore.away, boxscore.home].map((team) => (
            <article key={`${team.abbreviation}-leaders`} className="rounded-2xl bg-white/5 p-4">
              <p className="text-sm font-semibold text-white">{team.name}</p>
              <ul className="mt-3 space-y-2 text-sm text-white/80">
                {team.leaders.map((leader) => (
                  <li key={leader.name} className="rounded-xl border border-white/10 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-white">{leader.name}</p>
                        <p className="text-xs uppercase tracking-[0.25em] text-white/50">{leader.role}</p>
                      </div>
                      <span className="text-sm text-white/70">{leader.statLine}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
