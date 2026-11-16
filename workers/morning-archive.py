"""Normalize the latest completed hoopR slates to the NBA worker's source format."""

import csv
import gzip
import importlib.util
import io
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.request import urlopen

BASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/"
FILES = {
    "schedule": "espn_nba_schedules/nba_schedule",
    "player_boxes": "espn_nba_player_boxscores/player_box",
    "team_boxes": "espn_nba_team_boxscores/team_box",
    "nba_schedule": "nba_stats_schedules/nba_schedule",
    "player_ids": "nba_crosswalk/nba_player_crosswalk",
    "standings": "nba_stats_standings/standings",
    "player_stats": "nba_stats_player_season_stats/player_season_stats",
}

spec = importlib.util.spec_from_file_location("overnight", Path(__file__).with_name("import-hoopr.py"))
overnight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overnight)


def download(key, year):
    extension = ".csv.gz" if key == "nba_schedule" else ".csv"
    with urlopen(f"{BASE}{FILES[key]}_{year}{extension}", timeout=15) as response:
        raw = response.read()
        observed = parsedate_to_datetime(response.headers["Last-Modified"])
    if extension.endswith(".gz"):
        raw = gzip.decompress(raw)
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))), observed


def crosswalk(rows, source, target, year):
    ids = defaultdict(set)
    for row in rows:
        if (row["season"] == str(year) and row[source].isdigit()
                and row[target].isdigit() and float(row["match_confidence"] or 0) >= 0.95):
            ids[row[source]].add(int(row[target]))
    return {source_id: next(iter(targets)) for source_id, targets in ids.items() if len(targets) == 1}


ESPN_TEAM_CODES = {"WSH": "WAS", "GS": "GSW", "SA": "SAS", "NY": "NYK", "UTAH": "UTA", "NO": "NOP"}


COUNT_FIELDS = {
    "field_goals_made": "field_goals_made",
    "field_goals_attempted": "field_goals_attempted",
    "three_point_made": "three_point_field_goals_made",
    "three_point_attempted": "three_point_field_goals_attempted",
    "free_throws_made": "free_throws_made",
    "free_throws_attempted": "free_throws_attempted",
    "offensive_rebounds": "offensive_rebounds",
    "defensive_rebounds": "defensive_rebounds",
    "assists": "assists",
    "steals": "steals",
    "blocks": "blocks",
    "turnovers": "turnovers",
    "fouls": "fouls",
}


def counting_stats(row):
    result = {field: int(row[key]) for field, key in COUNT_FIELDS.items() if row.get(key)}
    for prefix, output in [("field_goals", "field_goal_pct"), ("three_point", "three_point_pct"),
                           ("free_throws", "free_throw_pct")]:
        attempts = result.get(f"{prefix}_attempted")
        if attempts:
            result[output] = result[f"{prefix}_made"] / attempts
        elif attempts == 0:
            result[output] = 0
    return result


def make_archive(files, observations, today, year):
    schedule = files["schedule"]
    valid = overnight.build_snapshot(
        schedule, files["player_boxes"], files["team_boxes"], today, observations["schedule"]
    )
    schedule_by_id = {row["game_id"]: row for row in schedule}
    nba_games = defaultdict(list)
    for row in files["nba_schedule"]:
        if row["season"] == str(year) and row["season_type"] == "regular-season":
            key = row["game_date"], row["home_team_abbreviation"], row["away_team_abbreviation"]
            nba_games[key].append(row)
    player_ids = crosswalk(files["player_ids"], "espn_athlete_id", "nba_player_id", year)
    player_rows = overnight.group_by_game(files["player_boxes"])
    team_rows = overnight.group_by_game(files["team_boxes"])
    box_observed = min(observations[k] for k in ("schedule", "player_boxes", "team_boxes"))
    boxes = []
    for slate in valid["slates"]:
        for game in slate["games"]:
            espn = schedule_by_id[game["id"]]
            day = slate["date"]
            home, away = (espn[f"{side}_abbreviation"] for side in ("home", "away"))
            matches = nba_games[day, ESPN_TEAM_CODES.get(home, home), ESPN_TEAM_CODES.get(away, away)]
            if len(matches) != 1:
                raise ValueError(f"Expected one NBA schedule match for ESPN game {game['id']}")
            nba = matches[0]
            if not nba["game_id"].startswith(f"002{(year - 1) % 100:02d}"):
                raise ValueError("Unexpected NBA game ID in regular-season schedule")
            start = datetime.fromisoformat(espn["date"].replace("Z", "+00:00"))
            if box_observed <= start:
                raise ValueError(f"Box-score files predate ESPN game {game['id']}")

            cards = {}
            totals = []
            players = []
            for side in ("home", "away"):
                team_key = espn[f"{side}_id"]
                team_id = int(nba[f"{side}_team_id"])
                tricode = nba[f"{side}_team_abbreviation"]
                total = next(row for row in team_rows[game["id"]] if row["team_id"] == team_key)
                card = {
                    "team_id": team_id, "team_name": total["team_name"],
                    "team_city": total["team_location"], "team_abbreviation": tricode,
                    "score": game[f"{side}Score"], "is_home": side == "home",
                }
                cards[f"{side}_team"] = card
                totals.append({
                    "team_id": team_id, "team_name": total["team_name"], "team_abbreviation": tricode,
                    **counting_stats(total), "points": card["score"],
                    "rebounds": int(total["total_rebounds"]), "turnovers": int(total["total_turnovers"]),
                })
                for row in player_rows[game["id"]]:
                    if row["team_id"] != team_key or row["did_not_play"] == "true":
                        continue
                    players.append({
                        "player_id": player_ids[row["athlete_id"]],
                        "player_name": row["athlete_display_name"], "team_id": team_id,
                        "team_abbreviation": tricode, "minutes": float(row["minutes"]),
                        "points": int(row["points"]), "rebounds": int(row["rebounds"]),
                        "plus_minus": int(row["plus_minus"]) if row["plus_minus"] else None,
                        "start_position": row["athlete_position_abbreviation"] if row["starter"] == "true" else None,
                        **counting_stats(row),
                    })
            boxes.append({
                "game_id": nba["game_id"], "game_date": day, "observed_at": box_observed.isoformat(),
                "start_time": start.isoformat(), "status": "Final", "arena": espn["venue_full_name"] or None,
                **cards, "traditional_players": players, "team_totals": totals,
            })
    if len({box["game_id"] for box in boxes}) != len(boxes):
        raise ValueError("Several ESPN games map to the same NBA game")

    standings = []
    for row in files["standings"]:
        if row["season"] == str(year) and row["season_type"] == "regular-season":
            standings.append({
                **row, "conference_rank": row["playoff_rank"],
                "games_back": row["conference_games_back"], "home_record": row["home"],
                "road_record": row["road"], "last_ten": row["l10"], "streak": row["str_current_streak"],
            })
    latest_slate = max(box["game_date"] for box in boxes)
    finals = [row for row in schedule if row["season_type"] == "2"
              and row["game_date"] <= latest_slate and row["status_type_name"] == "STATUS_FINAL"]
    if sum(int(row["wins"]) + int(row["losses"]) for row in standings) < 2 * len(finals):
        raise ValueError("NBA standings archive trails the latest completed ESPN slate")
    stats = []
    for row in files["player_stats"]:
        if (row["season"], row["season_type"], row["measure_type"], row["per_mode"]) == (
                str(year), "regular-season", "base", "pergame"):
            stats.append({key.upper(): value for key, value in row.items() if value})
    latest_start = max(datetime.fromisoformat(box["start_time"]) for box in boxes)
    if min(observations["standings"], observations["player_stats"]) <= latest_start:
        raise ValueError("NBA season archives predate the latest completed slate")
    return {"boxes": boxes, "standings": standings, "playerStats": stats}


if __name__ == "__main__":
    today = date.fromisoformat(sys.argv[1])
    year = int(sys.argv[2])
    with ThreadPoolExecutor(max_workers=4) as pool:
        downloaded = dict(zip(FILES, pool.map(lambda key: download(key, year), FILES)))
    print(json.dumps(make_archive(
        {key: data[0] for key, data in downloaded.items()},
        {key: data[1] for key, data in downloaded.items()}, today, year
    ), allow_nan=False))
