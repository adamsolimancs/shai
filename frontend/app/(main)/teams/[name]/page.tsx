import Link from "next/link";
import { notFound } from "next/navigation";

import { nbaFetch } from "@/lib/nbaApi";
import { unslugifySegment } from "@/lib/utils";

type ResolutionPayload = {
  id: number;
  name: string;
  abbreviation?: string | null;
  confidence: number;
};

type ResolveResult = {
  team?: ResolutionPayload | null;
};

type TeamDetail = {
  team_id: number;
  abbreviation?: string | null;
  nickname?: string | null;
  city?: string | null;
  year_founded?: number | null;
  arena?: string | null;
  arena_capacity?: number | null;
  owner?: string | null;
  general_manager?: string | null;
  head_coach?: string | null;
  dleague_affiliation?: string | null;
  championships: string[];
  conference_titles: string[];
  division_titles: string[];
  hall_of_famers: string[];
  retired_numbers: string[];
  social_sites: Record<string, string>;
};

type TeamMetric = {
  label: string;
  value: string;
  helper?: string;
};

type TeamLeader = {
  name: string;
  role: string;
  statLine: string;
};

type TeamScheduleEntry = {
  opponent: string;
  result: string;
  date: string;
};

type TeamProfile = {
  slug: string;
  teamId: number;
  name: string;
  location: string;
  record: string;
  conferenceRank: string;
  division: string;
  coach: string;
  lastTen: string;
  streak: string;
  summary: string;
  metrics: TeamMetric[];
  leaders: TeamLeader[];
  schedule: TeamScheduleEntry[];
  details: TeamDetail | null;
};

const formatListPreview = (items: string[], limit = 5) => {
  if (!items.length) return "—";
  if (items.length <= limit) return items.join(", ");
  return `${items.slice(0, limit).join(", ")} +${items.length - limit} more`;
};

const MOCK_TEAM_DATA: Record<string, TeamProfile> = {
  "boston-celtics": {
    slug: "boston-celtics",
    teamId: 1610612738,
    name: "Boston Celtics",
    location: "Boston, MA",
    record: "55-20",
    conferenceRank: "1st East",
    division: "Atlantic Division",
    coach: "Joe Mazzulla",
    lastTen: "8-2",
    streak: "W3",
    summary:
      "The Celtics continue to lean on elite perimeter defense, balanced scoring, and a deep rotation that overwhelms teams in the second half.",
    metrics: [
      { label: "PPG", value: "118.4", helper: "3rd in NBA" },
      { label: "OPP PPG", value: "110.2", helper: "5th in NBA" },
      { label: "Net Rating", value: "+8.2", helper: "2nd in NBA" },
      { label: "Assist %", value: "63.1%", helper: "7th in NBA" },
    ],
    leaders: [
      { name: "Jayson Tatum", role: "Forward", statLine: "27.1 PTS • 8.8 REB • 4.4 AST" },
      { name: "Jaylen Brown", role: "Wing", statLine: "24.6 PTS • 6.2 REB • 3.5 AST" },
      { name: "Jrue Holiday", role: "Guard", statLine: "15.1 PTS • 6.4 AST • 1.4 STL" },
    ],
    schedule: [
      { opponent: "vs. PHI", result: "W 108-101", date: "Mar 24" },
      { opponent: "@ MIL", result: "L 112-120", date: "Mar 26" },
      { opponent: "@ TOR", result: "W 124-113", date: "Mar 28" },
      { opponent: "vs. NYK", result: "Tip 7:30 PM", date: "Mar 30" },
    ],
    details: null,
  },
  "los-angeles-lakers": {
    slug: "los-angeles-lakers",
    teamId: 1610612747,
    name: "Los Angeles Lakers",
    location: "Los Angeles, CA",
    record: "44-33",
    conferenceRank: "7th West",
    division: "Pacific Division",
    coach: "Darvin Ham",
    lastTen: "6-4",
    streak: "W2",
    summary:
      "L.A. has leaned into a faster pace and lineups built around LeBron’s playmaking and Davis’ rim protection. Health will dictate their ceiling.",
    metrics: [
      { label: "PPG", value: "116.0", helper: "9th in NBA" },
      { label: "OPP PPG", value: "114.9", helper: "20th in NBA" },
      { label: "Net Rating", value: "+1.4", helper: "14th in NBA" },
      { label: "Paint PTS", value: "55.2", helper: "2nd in NBA" },
    ],
    leaders: [
      { name: "LeBron James", role: "Forward", statLine: "25.2 PTS • 8.2 AST • 7.4 REB" },
      { name: "Anthony Davis", role: "Center", statLine: "24.6 PTS • 12.3 REB • 2.5 BLK" },
      { name: "Austin Reaves", role: "Guard", statLine: "15.4 PTS • 5.6 AST • 4.3 REB" },
    ],
    schedule: [
      { opponent: "vs. DEN", result: "L 115-121", date: "Mar 24" },
      { opponent: "@ PHX", result: "W 129-125", date: "Mar 26" },
      { opponent: "@ SAC", result: "W 118-111", date: "Mar 28" },
      { opponent: "vs. MIN", result: "Tip 8:00 PM", date: "Mar 30" },
    ],
    details: null,
  },
  "oklahoma-city-thunder": {
    slug: "oklahoma-city-thunder",
    teamId: 1610612760,
    name: "Oklahoma City Thunder",
    location: "Oklahoma City, OK",
    record: "52-23",
    conferenceRank: "2nd West",
    division: "Northwest Division",
    coach: "Mark Daigneault",
    lastTen: "7-3",
    streak: "W2",
    summary:
      "The Thunder’s young core keeps stacking efficient offense on top of relentless length and pace, making them one of the league’s toughest outs.",
    metrics: [
      { label: "PPG", value: "119.1", helper: "2nd in NBA" },
      { label: "OPP PPG", value: "111.5", helper: "8th in NBA" },
      { label: "Net Rating", value: "+7.4", helper: "4th in NBA" },
      { label: "Pace", value: "101.5", helper: "6th in NBA" },
    ],
    leaders: [
      { name: "Shai Gilgeous-Alexander", role: "Guard", statLine: "30.9 PTS • 6.3 AST • 2.1 STL" },
      { name: "Chet Holmgren", role: "Center", statLine: "17.4 PTS • 8.1 REB • 2.6 BLK" },
      { name: "Jalen Williams", role: "Wing", statLine: "19.4 PTS • 4.5 REB • 4.4 AST" },
    ],
    schedule: [
      { opponent: "@ DAL", result: "L 118-123", date: "Mar 23" },
      { opponent: "@ HOU", result: "W 111-102", date: "Mar 25" },
      { opponent: "vs. UTA", result: "W 127-108", date: "Mar 27" },
      { opponent: "vs. DEN", result: "Tip 8:00 PM", date: "Mar 29" },
    ],
    details: null,
  },
};

function buildFallbackTeam(slug: string): TeamProfile | null {
  const name = unslugifySegment(slug) || slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!name) {
    return null;
  }
  return {
    slug,
    teamId: 0,
    name,
    location: "City, ST",
    record: "0-0",
    conferenceRank: "—",
    division: "—",
    coach: "TBD",
    lastTen: "—",
    streak: "—",
    summary: `${name} scouting capsule will appear here once the live API is wired up.`,
    metrics: [
      { label: "PPG", value: "—" },
      { label: "OPP PPG", value: "—" },
      { label: "Net Rating", value: "—" },
      { label: "Pace", value: "—" },
    ],
    leaders: [
      { name: "TBD", role: "Scoring", statLine: "—" },
      { name: "TBD", role: "Playmaking", statLine: "—" },
      { name: "TBD", role: "Defense", statLine: "—" },
    ],
    schedule: [
      { opponent: "To be announced", result: "—", date: "—" },
      { opponent: "To be announced", result: "—", date: "—" },
      { opponent: "To be announced", result: "—", date: "—" },
      { opponent: "To be announced", result: "—", date: "—" },
    ],
    details: null,
  };
}

async function fetchTeamProfile(slug: string): Promise<TeamProfile | null> {
  const normalized = decodeURIComponent(slug).toLowerCase();
  const fallback = MOCK_TEAM_DATA[normalized] ?? buildFallbackTeam(normalized);
  if (!fallback) {
    return null;
  }

  const friendlyName = unslugifySegment(normalized);
  if (!friendlyName) {
    return fallback;
  }

  try {
    const resolution = await nbaFetch<ResolveResult>(`/v1/resolve?team=${encodeURIComponent(friendlyName)}`);
    const teamId = resolution.team?.id;
    if (!teamId) {
      return fallback;
    }
    const details = await nbaFetch<TeamDetail>(`/v1/teams/${teamId}/details`, { next: { revalidate: 1800 } });
    const derivedName = fallback.name || `${details.city ?? ""} ${details.nickname ?? ""}`.trim() || friendlyName;
    const derivedLocation =
      fallback.location === "City, ST" && details.city ? details.city : fallback.location;
    const derivedCoach = fallback.coach === "TBD" && details.head_coach ? details.head_coach : fallback.coach;

    return {
      ...fallback,
      teamId,
      name: derivedName,
      location: derivedLocation,
      coach: derivedCoach,
      details,
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Failed to load team details", error);
    }
    return fallback;
  }
}

export default async function TeamDetailPage({ params }: { params: Promise<{ name?: string | string[] }> | { name?: string | string[] } }) {
  const resolvedParams = await Promise.resolve(params);
  const slug = Array.isArray(resolvedParams.name) ? resolvedParams.name[0] : resolvedParams.name;
  if (!slug) {
    notFound();
  }

  const team = await fetchTeamProfile(slug);

  if (!team) {
    notFound();
  }

  const detail = team.details;
  const detailFacts = detail
    ? [
        { label: "Founded", value: detail.year_founded ? detail.year_founded.toString() : "—" },
        { label: "Arena", value: detail.arena ?? "—" },
        {
          label: "Capacity",
          value: detail.arena_capacity ? detail.arena_capacity.toLocaleString() : "—",
        },
        { label: "Owner", value: detail.owner ?? "—" },
        { label: "General Manager", value: detail.general_manager ?? "—" },
        { label: "Head Coach", value: detail.head_coach ?? team.coach },
        { label: "Affiliate", value: detail.dleague_affiliation ?? "—" },
      ]
    : [];
  const trophyFacts = detail
    ? [
        { label: "Championships", value: formatListPreview(detail.championships, 4) },
        { label: "Conference Titles", value: formatListPreview(detail.conference_titles, 4) },
        { label: "Division Titles", value: formatListPreview(detail.division_titles, 4) },
        { label: "Hall of Famers", value: formatListPreview(detail.hall_of_famers, 4) },
        { label: "Retired Numbers", value: formatListPreview(detail.retired_numbers, 4) },
      ]
    : [];
  const socialEntries = detail ? Object.entries(detail.social_sites ?? {}) : [];

  return (
    <div className="space-y-10">
      <Link
        href="/teams"
        className="inline-flex items-center gap-2 text-sm text-white/70 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <span aria-hidden="true">←</span>
        Back to teams
      </Link>

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-8 shadow-2xl shadow-black/20">
        <p className="text-xs uppercase tracking-[0.35em] text-white/40">{team.conferenceRank}</p>
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <div>
            <h1 className="text-4xl font-semibold text-white">{team.name}</h1>
            <p className="text-base text-white/70">{team.location}</p>
          </div>
          <div className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white">
            {team.record}
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-base text-white/70">{team.summary}</p>
        <dl className="mt-6 grid gap-4 text-sm text-white/70 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Division</dt>
            <dd className="mt-1 text-white">{team.division}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Head Coach</dt>
            <dd className="mt-1 text-white">{team.coach}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Last 10</dt>
            <dd className="mt-1 text-white">{team.lastTen}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Next tip</dt>
            <dd className="mt-1 text-white">{team.schedule.at(-1)?.date ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.3em] text-white/40">Streak</dt>
            <dd className="mt-1 text-white">{team.streak}</dd>
          </div>
        </dl>
        {detail ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-slate-950/60 p-5 text-white/80">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Franchise details</p>
            <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {detailFacts.map((fact) => (
                <div key={fact.label}>
                  <p className="text-xs uppercase tracking-[0.25em] text-white/40">{fact.label}</p>
                  <p className="mt-1 text-white">{fact.value || "—"}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {trophyFacts.map((item) => (
                <div key={item.label}>
                  <p className="text-xs uppercase tracking-[0.25em] text-white/40">{item.label}</p>
                  <p className="mt-1 text-white/90">{item.value}</p>
                </div>
              ))}
            </div>
            {socialEntries.length > 0 ? (
              <div className="mt-6 flex flex-wrap gap-3 text-sm">
                {socialEntries.map(([platform, url]) => (
                  <a
                    key={platform}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1 text-white/80 transition hover:border-white/40 hover:text-white"
                  >
                    <span className="text-xs uppercase tracking-[0.3em]">{platform.toUpperCase()}</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-white/40">Team metrics</p>
          <ul className="mt-4 space-y-4">
            {team.metrics.map((metric) => (
              <li key={metric.label} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{metric.label}</p>
                  {metric.helper ? <p className="text-xs text-white/50">{metric.helper}</p> : null}
                </div>
                <span className="text-xl font-semibold text-white">{metric.value}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-white/40">Impact leaders</p>
          <ul className="mt-4 space-y-4">
            {team.leaders.map((leader) => (
              <li key={leader.name} className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{leader.name}</p>
                    <p className="text-xs uppercase tracking-[0.25em] text-white/50">{leader.role}</p>
                  </div>
                  <p className="text-sm text-white/70">{leader.statLine}</p>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-white/40">Upcoming</p>
            <h2 className="text-2xl font-semibold text-white">Schedule snapshot</h2>
          </div>
          <span className="text-xs uppercase tracking-[0.25em] text-white/60">{team.record} overall</span>
        </div>
        <ul className="mt-4 divide-y divide-white/10 text-sm">
          {team.schedule.map((game, index) => (
            <li key={`${game.date}-${index}`} className="flex items-center justify-between py-3">
              <div>
                <p className="font-semibold text-white">{game.opponent}</p>
                <p className="text-xs text-white/60">{game.date}</p>
              </div>
              <span className="text-sm font-medium text-white/70">{game.result}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
