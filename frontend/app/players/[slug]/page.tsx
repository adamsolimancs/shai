import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PlayerProfile = {
  slug: string;
  name: string;
  team: string;
  number: number;
  position: string;
  age: number;
  experience: string;
  headshot: string;
  rating: number;
  scoutingReport: string;
  currentSeason: {
    season: string;
    teamRecord: string;
    accolades: string[];
    averages: {
      pts: number;
      reb: number;
      ast: number;
      stl: number;
      blk: number;
      mins: number;
    };
    advanced: { label: string; value: string }[];
    splits: { label: string; value: string }[];
  };
  pastSeasons: {
    season: string;
    team: string;
    ppg: number;
    rpg: number;
    apg: number;
    fg: string;
    three: string;
    per: number;
  }[];
};

const playerDirectory: Record<string, PlayerProfile> = {
  "luka-doncic": {
    slug: "luka-doncic",
    name: "Luka Dončić",
    team: "Dallas Mavericks",
    number: 77,
    position: "Guard",
    age: 25,
    experience: "6th season",
    headshot: "https://images.unsplash.com/photo-1512070679279-8988d32161be?auto=format&fit=crop&w=1200&q=80",
    rating: 96,
    scoutingReport: "Heliocentric engine who bends defenses with live-dribble passing and step-back gravity. Conditioning leap fuels late-game control.",
    currentSeason: {
      season: "2024-25",
      teamRecord: "48-23",
      accolades: ["MVP favorite", "All-NBA lock", "Player of the Month ×3"],
      averages: {
        pts: 33.8,
        reb: 9.4,
        ast: 10.1,
        stl: 1.4,
        blk: 0.5,
        mins: 36.7,
      },
      advanced: [
        { label: "Usage", value: "34.6%" },
        { label: "TS%", value: "63.2%" },
        { label: "Assist%", value: "46.1%" },
        { label: "Luka Rating", value: "+11.2" },
      ],
      splits: [
        { label: "Step-back 3", value: "36.7%" },
        { label: "Paint FG", value: "69.3%" },
        { label: "Transition PPG", value: "5.1" },
        { label: "PACE w/ Luka", value: "101.4" },
      ],
    },
    pastSeasons: [
      { season: "2023-24", team: "DAL", ppg: 33.9, rpg: 9.2, apg: 9.8, fg: "48.7%", three: "38.2%", per: 30.8 },
      { season: "2022-23", team: "DAL", ppg: 32.4, rpg: 8.6, apg: 8.0, fg: "49.6%", three: "34.2%", per: 29.1 },
      { season: "2021-22", team: "DAL", ppg: 28.4, rpg: 9.1, apg: 8.7, fg: "45.7%", three: "35.3%", per: 25.1 },
    ],
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchPlayerProfile = async (slug: string): Promise<PlayerProfile | null> => {
  await wait(120);
  return playerDirectory[slug] ?? null;
};

const samplePlayer: PlayerProfile = {
  slug: "lamelo-ball",
  name: "LaMelo Ball",
  team: "Charlotte Hornets",
  number: 1,
  position: "Guard",
  age: 23,
  experience: "5th season",
  headshot: "https://images.unsplash.com/photo-1584050663620-2645ae358211?auto=format&fit=crop&w=1200&q=80",
  rating: 91,
  scoutingReport:
    "Creative lead guard with deep shooting range, audacious passing windows, and improved rim pressure. Tempo control keeps Charlotte in the fast lane.",
  currentSeason: {
    season: "2024-25",
    teamRecord: "39-33",
    accolades: ["All-Star", "Skill Challenge champion", "Top-10 in assists"],
    averages: {
      pts: 24.6,
      reb: 6.1,
      ast: 8.9,
      stl: 1.6,
      blk: 0.4,
      mins: 34.8,
    },
    advanced: [
      { label: "Usage", value: "27.5%" },
      { label: "TS%", value: "58.9%" },
      { label: "Assist%", value: "41.7%" },
      { label: "On/Off", value: "+7.4" },
    ],
    splits: [
      { label: "Catch & Shoot 3", value: "40.1%" },
      { label: "Pull-up 3", value: "35.8%" },
      { label: "Drives Per Game", value: "16.4" },
      { label: "Clutch FG", value: "46.2%" },
    ],
  },
  pastSeasons: [
    { season: "2023-24", team: "CHA", ppg: 23.9, rpg: 5.1, apg: 8.8, fg: "42.9%", three: "38.5%", per: 20.1 },
    { season: "2022-23", team: "CHA", ppg: 23.3, rpg: 6.4, apg: 8.4, fg: "41.1%", three: "37.6%", per: 19.5 },
    { season: "2021-22", team: "CHA", ppg: 20.1, rpg: 6.7, apg: 7.6, fg: "42.9%", three: "38.9%", per: 19.4 },
  ],
};

export async function generateStaticParams() {
  return Object.keys(playerDirectory).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  // Replace with fetching logic
  const player = playerDirectory[params.slug];
  if (!player) {
    return {
      title: "LaMelo Ball · NBAI",
    };
  }

  return {
    title: `${player.name} · NBAI`,
    description: `${player.name} scouting card, current season breakdown, and history.`,
  };
}

export default async function PlayerPage({ params }: { params: { slug: string } }) {
  // Fetch player data based on slug
  // comment out for testing
  // const player = await fetchPlayerProfile(params.slug);

  // if (!player) {
  //   notFound();
  // }

  const profile = samplePlayer;

  return (
    <>
      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-blue-600/40 via-slate-900/80 to-slate-950/80 px-8 py-10 shadow-2xl shadow-blue-500/40">
        <div className="flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
          <div className="space-y-6 text-white">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-blue-200/70">{profile.team}</p>
              <h1 className="mt-4 text-4xl font-semibold md:text-5xl">
                {profile.name}
                <span className="ml-3 text-base font-normal text-white/70">#{profile.number} · {profile.position}</span>
              </h1>
            </div>
            <p className="text-sm text-white/70 md:max-w-2xl">{profile.scoutingReport}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <InfoPill label="Age" value={`${profile.age}`} />
              <InfoPill label="Experience" value={profile.experience} />
              <InfoPill label="Team Record" value={profile.currentSeason.teamRecord} />
            </div>
            <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 md:flex-row md:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-white/60">Impact Rating</p>
                <p className="text-5xl font-semibold text-white">{profile.rating}</p>
              </div>
              <div className="flex-1">
                <div className="h-2 rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-blue-400"
                    style={{ width: `${Math.min(profile.rating, 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-white/60">Per NBAI model · percentile {Math.round(profile.rating)}</p>
              </div>
            </div>
          </div>
          <div className="mx-auto w-full max-w-sm md:mx-0 md:max-w-md">
            <div className="rounded-[40px] border border-white/20 bg-white/10 p-4 backdrop-blur">
              <div
                className="h-72 rounded-[32px] border border-white/30 bg-cover bg-center shadow-inner shadow-black/40"
                style={{ backgroundImage: `url(${profile.headshot})` }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-16">
        <SectionHeading eyebrow="Current season" title={`${profile.currentSeason.season} production profile`} />
        <div className="grid gap-5 md:grid-cols-3">
          <StatCard label="Points" value={profile.currentSeason.averages.pts} suffix="PPG" />
          <StatCard label="Rebounds" value={profile.currentSeason.averages.reb} suffix="RPG" />
          <StatCard label="Assists" value={profile.currentSeason.averages.ast} suffix="APG" />
          <StatCard label="Steals" value={profile.currentSeason.averages.stl} suffix="SPG" />
          <StatCard label="Blocks" value={profile.currentSeason.averages.blk} suffix="BPG" />
          <StatCard label="Minutes" value={profile.currentSeason.averages.mins} suffix="MPG" />
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <p className="text-xs uppercase tracking-[0.4em] text-white/50">Accolades & notes</p>
            <ul className="mt-4 space-y-3 text-sm text-white/80">
              {profile.currentSeason.accolades.map((note) => (
                <li key={note} className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-blue-400" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {profile.currentSeason.advanced.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">{metric.label}</p>
                  <p className="text-2xl font-semibold text-white">{metric.value}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <p className="text-xs uppercase tracking-[0.4em] text-white/50">Situational splits</p>
            <div className="mt-4 space-y-4">
              {profile.currentSeason.splits.map((split) => (
                <div key={split.label}>
                  <div className="flex items-center justify-between text-sm text-white/70">
                    <span>{split.label}</span>
                    <span className="font-semibold text-white">{split.value}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-400 to-sky-400"
                      style={{ width: deriveBarWidth(split.value) }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-20">
        <SectionHeading eyebrow="Season context" title="Year-over-year production" />
        <div className="overflow-x-auto rounded-3xl border border-white/10 bg-slate-950/60">
          <table className="min-w-full divide-y divide-white/5 text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.3em] text-white/40">
              <tr>
                <th className="px-6 py-3">Season</th>
                <th className="px-6 py-3">Team</th>
                <th className="px-6 py-3">PPG</th>
                <th className="px-6 py-3">RPG</th>
                <th className="px-6 py-3">APG</th>
                <th className="px-6 py-3">FG%</th>
                <th className="px-6 py-3">3P%</th>
                <th className="px-6 py-3">PER</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/80">
              {profile.pastSeasons.map((year) => (
                <tr key={year.season} className="hover:bg-white/5">
                  <td className="px-6 py-4 font-semibold text-white">{year.season}</td>
                  <td className="px-6 py-4">{year.team}</td>
                  <td className="px-6 py-4">{year.ppg.toFixed(1)}</td>
                  <td className="px-6 py-4">{year.rpg.toFixed(1)}</td>
                  <td className="px-6 py-4">{year.apg.toFixed(1)}</td>
                  <td className="px-6 py-4">{year.fg}</td>
                  <td className="px-6 py-4">{year.three}</td>
                  <td className="px-6 py-4">{year.per.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const SectionHeading = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div className="mb-8">
    <p className="text-xs uppercase tracking-[0.35em] text-blue-300/80">{eyebrow}</p>
    <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
  </div>
);

const StatCard = ({ label, value, suffix }: { label: string; value: number; suffix: string }) => (
  <article className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/30">
    <p className="text-xs uppercase tracking-[0.3em] text-white/50">{label}</p>
    <p className="mt-3 text-3xl font-semibold text-white">
      {value.toFixed(1)}
      <span className="ml-1 text-sm text-white/60">{suffix}</span>
    </p>
  </article>
);

const InfoPill = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
    <p className="text-xs uppercase tracking-[0.3em] text-white/50">{label}</p>
    <p className="mt-1 text-base font-semibold text-white">{value}</p>
  </div>
);

const deriveBarWidth = (value: string) => {
  const numeric = parseFloat(value);
  if (!Number.isNaN(numeric)) {
    const normalized = Math.max(0, Math.min(100, numeric));
    return `${normalized}%`;
  }
  if (value.toLowerCase().includes("pace")) {
    const pace = parseFloat(value.replace(/[^\d.]/g, ""));
    return `${Math.min(100, (pace / 110) * 100)}%`;
  }
  return "60%";
};
