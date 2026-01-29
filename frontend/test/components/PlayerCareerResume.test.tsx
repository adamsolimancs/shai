import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PlayerCareerResume from "@/components/PlayerCareerResume";

type Season = {
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

const regularSeasons: Season[] = [
  {
    season_id: "2022-23",
    team_id: 1,
    team_abbreviation: "NYK",
    player_age: 26,
    games_played: 10,
    games_started: 10,
    minutes: 300,
    points: 100,
    rebounds: 50,
    assists: 40,
    steals: 10,
    blocks: 5,
    field_goal_pct: 0.5,
    three_point_pct: 0.35,
    free_throw_pct: 0.8,
    true_shooting_pct: 0.58,
  },
  {
    season_id: "2023-24",
    team_id: 1,
    team_abbreviation: "NYK",
    player_age: 27,
    games_played: 20,
    games_started: 20,
    minutes: 600,
    points: 400,
    rebounds: 100,
    assists: 80,
    steals: 20,
    blocks: 10,
    field_goal_pct: 0.4,
    three_point_pct: 0.32,
    free_throw_pct: 0.85,
    true_shooting_pct: 0.55,
  },
];

const playoffSeasons: Season[] = [
  {
    season_id: "2023-24",
    team_id: 1,
    team_abbreviation: "NYK",
    player_age: 27,
    games_played: 6,
    games_started: 6,
    minutes: 210,
    points: 120,
    rebounds: 30,
    assists: 36,
    steals: 6,
    blocks: 2,
    field_goal_pct: 0.45,
    three_point_pct: 0.38,
    free_throw_pct: 0.88,
    true_shooting_pct: 0.6,
  },
];

const renderComponent = (regular = regularSeasons, playoffs = playoffSeasons) =>
  render(
    <PlayerCareerResume
      regularSeasons={regular}
      playoffSeasons={playoffs}
      allStarSeasons={["2023-24"]}
    />,
  );

describe("PlayerCareerResume", () => {
  it("renders summary rows with computed averages", () => {
    renderComponent();

    expect(screen.getAllByText("Career").length).toBe(2);
    expect(screen.getAllByText("30").length).toBeGreaterThan(0);
    expect(screen.getByText("16.7")).toBeInTheDocument();
    expect(screen.getByText("43.3%")).toBeInTheDocument();
    expect(screen.getAllByText("TS%").length).toBeGreaterThan(0);
  });

  it("disables playoffs toggle when no playoff seasons", () => {
    renderComponent(regularSeasons, []);
    const playoffsButton = screen.getByRole("button", { name: "Playoffs" });
    expect(playoffsButton).toBeDisabled();
  });

  it("switches to playoffs view when toggled", () => {
    renderComponent();
    fireEvent.click(screen.getByRole("button", { name: "Playoffs" }));

    expect(screen.getAllByText("2023-24").length).toBeGreaterThan(0);
    expect(screen.queryByText(/No playoffs averages available/i)).not.toBeInTheDocument();
  });

  it("renders empty state when no seasons", () => {
    renderComponent([], []);
    expect(screen.getByText(/No regular season averages available/i)).toBeInTheDocument();
    expect(screen.getByText(/No regular season totals available/i)).toBeInTheDocument();
  });
});
