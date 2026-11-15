"""Build an audited, source-isolated snapshot for the overnight demo."""

import argparse
import csv
import io
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen
from zoneinfo import ZoneInfo

FILES = {
    "nba_schedule": "schedules",
    "player_box": "player_boxscores",
    "team_box": "team_boxscores",
}
BASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
MATCHED_STATS = (
    "field_goals_made",
    "field_goals_attempted",
    "three_point_field_goals_made",
    "three_point_field_goals_attempted",
    "free_throws_made",
    "free_throws_attempted",
    "assists",
    "steals",
    "blocks",
)


def load(name, year, directory):
    if directory:
        with (directory / f"{name}.csv").open(encoding="utf-8-sig", newline="") as file:
            return list(csv.DictReader(file))
    url = f"{BASE}/espn_nba_{FILES[name]}/{name}_{year}.csv"
    with urlopen(url, timeout=30) as response:
        return list(
            csv.DictReader(io.TextIOWrapper(response, encoding="utf-8-sig", newline=""))
        )


def group_by_game(rows):
    games = defaultdict(list)
    for row in rows:
        games[row["game_id"]].append(row)
    return games


def reconcile(game, player_rows, team_rows):
    players = []
    did_not_play = []
    for side in ("away", "home"):
        team_id = game[f"{side}_id"]
        team = [row for row in team_rows if row["team_id"] == team_id]
        roster = [row for row in player_rows if row["team_id"] == team_id]
        played = [row for row in roster if row["did_not_play"] == "false"]
        stats = ("points", *MATCHED_STATS)
        if (
            len(team) != 1
            or len(played) < 5
            or len({row["athlete_id"] for row in roster}) != len(roster)
            or not all(
                row["athlete_id"]
                and row["athlete_display_name"]
                and row["did_not_play"] in {"true", "false"}
                for row in roster
            )
            or int(team[0]["team_score"]) != int(game[f"{side}_score"])
            or any(
                sum(int(row[key]) for row in played) != int(team[0][reference])
                for key, reference in zip(stats, ("team_score", *MATCHED_STATS))
            )
        ):
            raise ValueError(f"Incomplete player box for {game['game_id']} ({side})")
        for row in roster:
            if row["did_not_play"] == "true":
                did_not_play.append(
                    {
                        "id": row["athlete_id"],
                        "name": row["athlete_display_name"],
                        "team": game[f"{side}_abbreviation"],
                    }
                )
        for row in played:
            players.append(
                {
                    "id": row["athlete_id"],
                    "name": row["athlete_display_name"],
                    "team": game[f"{side}_abbreviation"],
                    "minutes": float(row["minutes"]),
                    "points": int(row["points"]),
                    "rebounds": int(row["rebounds"]),
                    "assists": int(row["assists"]),
                    "steals": int(row["steals"]),
                    "blocks": int(row["blocks"]),
                    "fg": [int(row[key]) for key in MATCHED_STATS[:2]],
                    "three": [int(row[key]) for key in MATCHED_STATS[2:4]],
                    "ft": [int(row[key]) for key in MATCHED_STATS[4:6]],
                }
            )
    if (
        len(team_rows) != 2
        or {row["team_id"] for row in player_rows} != {game["home_id"], game["away_id"]}
        or len({row["athlete_id"] for row in player_rows}) != len(player_rows)
    ):
        raise ValueError(f"Unexpected teams or player IDs for {game['game_id']}")
    return players, did_not_play


def build_snapshot(schedule, player_rows, team_rows, today, observed):
    players = group_by_game(player_rows)
    teams = group_by_game(team_rows)
    schedule = [game for game in schedule if game["season_type"] == "2"]
    if len({game["game_id"] for game in schedule}) != len(schedule):
        raise ValueError("Duplicate regular-season game in the schedule export")
    dates = sorted(
        {
            game["game_date"]
            for game in schedule
            if game["game_date"] < today.isoformat()
        }
    )
    if not dates or date.fromisoformat(dates[-1]) < today - timedelta(days=3):
        raise ValueError("No recent regular-season slate in the schedule export")

    games_by_date = defaultdict(list)
    for game in schedule:
        games_by_date[game["game_date"]].append(game)
    target_dates = dates[-3:]
    appearances = Counter()
    points = Counter()
    slates = []
    for day in dates:
        games = []
        pending = []
        for game in games_by_date[day]:
            game_id = game["game_id"]
            if game["status_type_name"] in {"STATUS_POSTPONED", "STATUS_CANCELED"}:
                continue
            if game["status_type_name"] != "STATUS_FINAL":
                if day in target_dates:
                    raise ValueError(
                        f"Game {game_id} on {day} is still unresolved in the schedule"
                    )
                continue
            if day in target_dates:
                lines, did_not_play = reconcile(game, players[game_id], teams[game_id])
                for line in lines:
                    count = appearances[line["id"]]
                    line["previousGames"] = count
                    line["previousPoints"] = points[line["id"]] if count else None
                games.append(
                    {
                        "id": game_id,
                        "away": game["away_display_name"],
                        "awayScore": int(game["away_score"]),
                        "home": game["home_display_name"],
                        "homeScore": int(game["home_score"]),
                        "players": lines,
                        "didNotPlay": did_not_play,
                    }
                )
            pending.extend(
                row for row in players[game_id] if row["did_not_play"] == "false"
            )
        if games:
            slates.append({"date": day, "games": games})
        for row in pending:
            appearances[row["athlete_id"]] += 1
            points[row["athlete_id"]] += int(row["points"])

    if not slates:
        raise ValueError("No recent slate with validated box scores")
    return {"observed_at": observed.isoformat(), "slates": slates[::-1]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv-dir", type=Path, help="Use local copies of the three source files"
    )
    parser.add_argument(
        "--today", type=date.fromisoformat, help="Override the New York date for replay"
    )
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    eastern = now.astimezone(ZoneInfo("America/New_York")).date()
    today = args.today or eastern
    year = today.year + (today.month >= 10)
    data = build_snapshot(
        *(load(file, year, args.csv_dir) for file in FILES), today, now
    )
    print(json.dumps(data, allow_nan=False))
