"""Prepare NBA-ID player season stats for a one-time backfill."""

import argparse
import csv
import io
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

BASE = (
    "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/"
    "nba_stats_player_season_stats"
)
SEASON_TYPES = {"regular-season": "Regular Season", "playoffs": "Playoffs"}
PER_GAME = {
    "min": "minutes_pg",
    "pts": "points_pg",
    "reb": "rebounds_pg",
    "ast": "assists_pg",
    "stl": "steals_pg",
    "blk": "blocks_pg",
    "fg_pct": "field_goal_pct_pg",
    "fg3_pct": "three_point_pct_pg",
    "ft_pct": "free_throw_pct_pg",
}


def number(value):
    if not value:
        return None
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError(f"Unexpected season stat: {value}")
    return result


def read_season(year, directory):
    if directory:
        data = (directory / f"{year}.csv").read_bytes()
    else:
        with urlopen(f"{BASE}/player_season_stats_{year}.csv", timeout=30) as response:
            data = response.read()

    base = {}
    advanced = {}
    for row in csv.DictReader(io.StringIO(data.decode("utf-8-sig"))):
        season_type = SEASON_TYPES.get(row["season_type"])
        if season_type is None or row["per_mode"] != "pergame":
            continue
        if row["measure_type"] not in {"base", "advanced"}:
            continue
        if row["season"] != str(year) or not row["player_id"].isdigit():
            raise ValueError(f"Unexpected season or player ID in {year}")
        key = (season_type, row["player_id"])
        target = base if row["measure_type"] == "base" else advanced
        if key in target:
            raise ValueError(
                f"Duplicate {row['measure_type']} season row for {year} {key}"
            )
        target[key] = row

    if len([key for key in base if key[0] == "Regular Season"]) < 300:
        raise ValueError(f"{year}: regular-season archive looks incomplete")
    if set(base) != set(advanced):
        raise ValueError(f"{year}: base and advanced player coverage differs")

    stats = []
    for (season_type, player_id), row in base.items():
        gp = int(row["gp"])
        fields = {column: number(row[source]) for source, column in PER_GAME.items()}
        name = row["player_name"].strip()
        if (
            not name
            or gp < 1
            or any(fields[field] is None for field in ("minutes_pg", "points_pg"))
        ):
            raise ValueError(f"{year}: incomplete stat row for player {player_id}")
        stats.append(
            {
                "season": f"{year - 1}-{year % 100:02d}",
                "season_type": season_type,
                "player_id": player_id,
                "name": name,
                "team_id": int(row["team_id"]) or None,
                "games_played": gp,
                "games_started": int(row["gs"]) if row.get("gs") else None,
                **fields,
                "true_shooting_pct_pg": number(
                    advanced[(season_type, player_id)]["ts_pct"]
                ),
            }
        )

    print(f"{year}: {len(stats)} player season rows", file=sys.stderr)
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("first", type=int, help="First season's ending year")
    parser.add_argument("last", type=int, help="Last season's ending year")
    parser.add_argument(
        "--csv-dir", type=Path, help="Replay local files named YEAR.csv"
    )
    args = parser.parse_args()
    if not 1997 <= args.first <= args.last:
        parser.error("Use ascending ending years starting in 1997 or later")
    with ThreadPoolExecutor(max_workers=4) as pool:
        seasons = list(
            pool.map(
                lambda year: read_season(year, args.csv_dir),
                range(args.first, args.last + 1),
            )
        )
    print(json.dumps([row for season in seasons for row in season], allow_nan=False))
