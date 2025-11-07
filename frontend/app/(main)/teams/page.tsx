import { DEFAULT_SEASON, nbaFetch } from "@/lib/nbaApi";

type Team = {
  id: number;
  city: string;
  name: string;
  abbreviation: string;
  conference: string | null;
  division: string | null;
};

type Grouped<T> = {
  key: string;
  items: T[];
};

function formatTeamName(team: Team) {
  const fullName = `${team.city} ${team.name}`.trim();
  return fullName || team.abbreviation;
}

function groupByConference(teams: Team[]): Grouped<Team>[] {
  const map = new Map<string, Team[]>();
  teams.forEach((team) => {
    const key = team.conference ?? "Independent";
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(team);
  });
  return [...map.entries()]
    .map(([key, items]) => ({ key, items: items.sort((a, b) => formatTeamName(a).localeCompare(formatTeamName(b))) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function groupByDivision(teams: Team[]): Grouped<Team>[] {
  const map = new Map<string, Team[]>();
  teams.forEach((team) => {
    const division = team.division ?? "No Division";
    if (!map.has(division)) {
      map.set(division, []);
    }
    map.get(division)!.push(team);
  });
  return [...map.entries()]
    .map(([key, items]) => ({ key, items: items.sort((a, b) => formatTeamName(a).localeCompare(formatTeamName(b))) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export default async function TeamsPage() {
  const teams = await nbaFetch<Team[]>(`/v1/teams?season=${DEFAULT_SEASON}`);
  const sortedTeams = [...teams].sort((a, b) => formatTeamName(a).localeCompare(formatTeamName(b)));
  const conferences = groupByConference(teams);
  const divisions = groupByDivision(teams);
  const uniqueConfs = new Set(teams.map((team) => team.conference ?? "Independent"));
  const uniqueDivisions = new Set(divisions.map((division) => division.key));

  const metrics = [
    { label: "Franchises", value: sortedTeams.length.toString(), subtext: `${DEFAULT_SEASON} season sample` },
    { label: "Conferences", value: uniqueConfs.size.toString(), subtext: "East and West stay balanced" },
    { label: "Divisions", value: uniqueDivisions.size.toString(), subtext: "Regional pods" },
  ];

  return (
    <div className="space-y-12">
      <header className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.5em] text-blue-300/80">Team atlas</p>
          <h1 className="mt-3 text-4xl font-semibold text-white">Every NBA franchise, organized</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/70">
            Browse the entire league by conference, division, or at a glance via quick cards. Data syncs directly from the nba_data_api
            directory endpoint and refreshes nightly.
          </p>
        </div>
        <dl className="grid gap-4 rounded-3xl border border-white/10 bg-slate-950/40 p-6 text-center sm:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="space-y-2">
              <dt className="text-xs uppercase tracking-[0.4em] text-white/40">{metric.label}</dt>
              <dd className="text-3xl font-semibold text-white">{metric.value}</dd>
              <p className="text-xs text-white/60">{metric.subtext}</p>
            </div>
          ))}
        </dl>
      </header>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Conference snapshot</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">East vs West breakdown</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {conferences.map((conference) => (
            <article key={conference.key} className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-white">{conference.key} Conference</h3>
                <span className="text-xs uppercase text-white/60">{conference.items.length} teams</span>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-white/80">
                {conference.items.map((team) => (
                  <li key={team.id} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                    <span className="font-medium text-white">{formatTeamName(team)}</span>
                    <span className="text-white/60">{team.division ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Divisional pods</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">The six-pack overview</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {divisions.map((division) => (
            <article key={division.key} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{division.key}</h3>
                <span className="text-xs uppercase text-white/60">{division.items[0]?.conference ?? "—"}</span>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-white/80">
                {division.items.map((team) => (
                  <li key={team.id} className="flex items-center justify-between">
                    <span>{team.abbreviation}</span>
                    <span className="text-white/60">{formatTeamName(team)}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Team directory</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Quick-reference cards</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedTeams.map((team) => (
            <article key={team.id} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-white/50">{team.abbreviation}</p>
                  <h3 className="mt-1 text-xl font-semibold text-white">{formatTeamName(team)}</h3>
                </div>
                <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70">{team.conference ?? "—"}</div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs uppercase tracking-[0.2em] text-white/50">
                <div>
                  <dt>City</dt>
                  <dd className="mt-1 text-sm font-medium text-white">{team.city || "—"}</dd>
                </div>
                <div>
                  <dt>Division</dt>
                  <dd className="mt-1 text-sm font-medium text-white">{team.division ?? "—"}</dd>
                </div>
                <div>
                  <dt>Identifier</dt>
                  <dd className="mt-1 text-sm font-medium text-white">{team.id}</dd>
                </div>
                <div>
                  <dt>Conference</dt>
                  <dd className="mt-1 text-sm font-medium text-white">{team.conference ?? "—"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
