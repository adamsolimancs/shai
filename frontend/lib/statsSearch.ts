export type PlayerLine = {
  id: string;
  name: string;
  team: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fg: [number, number];
  three: [number, number];
  ft: [number, number];
  previousGames: number;
  previousPoints: number | null;
};

export type Game = {
  id: string;
  away: string;
  awayScore: number;
  home: string;
  homeScore: number;
  players: PlayerLine[];
  didNotPlay: Pick<PlayerLine, "id" | "name" | "team">[];
};

export type OvernightSnapshot = {
  observed_at: string;
  slates: { date: string; games: Game[] }[];
};

export const EXAMPLES = [
  { label: "Scoring jumps", question: "Who beat their scoring average by the most?" },
  { label: "Under 30 minutes", question: "Only include players who played under 30 minutes" },
  { label: "Top scorers", question: "Who scored the most points?" },
  { label: "Final scores", question: "What were the final scores?" },
];

export function parseQuestion(question: string) {
  const text = question.toLowerCase().replace(/[?.!]+$/, "").trim();
  if (/^(?:what were the )?(?:final )?scores(?: last night)?$/.test(text)) {
    return { kind: "scores" } as const;
  }

  const minutes = /\b(?:under|less than) (\d+) minutes\b/.exec(text);
  const maxMinutes = minutes ? Number(minutes[1]) : undefined;
  const relative = /\b(?:scoring average|season average)\b/.test(text);
  const top = /\b(?:most points|top scorers|scored the most)\b/.test(text);
  const filterOnly = /^(?:now )?(?:only )?include players who played (?:under|less than) \d+ minutes$/.test(text);
  if ((!relative && !top && !filterOnly)
    || /\b(?:assists?|rebounds?|steals?|blocks?|turnovers?)\b/.test(text)
    || (/\bminutes\b/.test(text) && maxMinutes === undefined)) return null;
  return { kind: top && !relative ? "points" : "relative", maxMinutes } as const;
}

export function rankScorers(
  games: Game[],
  kind: "relative" | "points",
  maxMinutes?: number,
) {
  return games
    .flatMap(game => game.players.map(player => {
      const average = player.previousPoints === null || player.previousGames === 0
        ? null
        : player.previousPoints / player.previousGames;
      return {
        ...player,
        gameId: game.id,
        average,
        delta: average === null ? null : player.points - average,
      };
    }))
    .filter(player => (maxMinutes === undefined || player.minutes < maxMinutes)
      && (kind === "points" || player.delta !== null))
    .sort((a, b) => {
      if (kind === "relative") return (b.delta ?? 0) - (a.delta ?? 0) || b.points - a.points;
      return b.points - a.points;
    })
    .slice(0, 10);
}
