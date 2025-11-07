"""
nba_quickpeek.py

Tiny, single-file demo for exploring live NBA Stats data using `nba_api`.

Usage:
    python nba_quickpeek.py            # fetches 2024-25 season team-game rows + LeBron sample
    python nba_quickpeek.py 2024-25    # specify a season explicitly

Requirements (install once):
    pip install nba_api pandas

Notes:
- This script reads live JSON from NBA Stats endpoints via the `nba_api` client.
- It prints a preview to stdout and writes two CSVs to the current directory.
"""

import sys
import os

try:
    import pandas as pd
    from nba_api.stats.endpoints import leaguegamefinder, playergamelog
except Exception as e:
    print("Import error. Make sure dependencies are installed:\n    pip install nba_api pandas")
    raise

DEFAULT_SEASON = "2024-25"  # format: 'YYYY-YY'

def fetch_team_games(season: str) -> pd.DataFrame:
    """Return per-team per-game rows for a given season."""
    result = leaguegamefinder.LeagueGameFinder(season_nullable=season)
    dfs = result.get_data_frames()
    if not dfs:
        raise RuntimeError("No data frames returned from LeagueGameFinder.")
    return dfs[0]

def fetch_player_gamelog(player_id: int, season: str) -> pd.DataFrame:
    """Return a player's game log for a given season."""
    result = playergamelog.PlayerGameLog(player_id=player_id, season=season)
    dfs = result.get_data_frames()
    if not dfs:
        raise RuntimeError("No data frames returned from PlayerGameLog.")
    return dfs[0]

def main():
    season = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SEASON

    print(f"=== NBA Stats quick peek for season {season} ===")

    # 1) Team-game rows (every game appears twice—once per team)
    games_df = fetch_team_games(season)
    print(f"[Team Games] Rows: {len(games_df)}  |  Columns: {len(games_df.columns)}")
    # Show a compact preview
    preview_cols = ["SEASON_ID","TEAM_ABBREVIATION","GAME_ID","GAME_DATE","MATCHUP","WL","MIN","PTS","REB","AST","PLUS_MINUS"]
    show_cols = [c for c in preview_cols if c in games_df.columns]
    print(games_df[show_cols].head(10).to_string(index=False))
    print("\nAll columns (first 25):")
    print(", ".join(games_df.columns[:25]) + (" ..." if len(games_df.columns) > 25 else ""))
    print()

    # 2) Player sample: LeBron James (player_id = 2544)
    lebron_id = 2544
    plog = fetch_player_gamelog(lebron_id, season)
    print(f"[Player Game Log] LeBron James ({lebron_id}) — {len(plog)} games")
    pcols = ["GAME_DATE","MATCHUP","WL","MIN","PTS","REB","AST","STL","BLK","TOV","PLUS_MINUS"]
    pshow = [c for c in pcols if c in plog.columns]
    print(plog[pshow].head(10).to_string(index=False))
    print()

    # 3) Save outputs as CSVs (so you can poke around in Pandas/Excel)
    season_tag = season.replace("-", "_")
    games_csv = f"team_game_rows_{season_tag}.csv"
    plog_csv = f"lebron_gamelog_{season_tag}.csv"
    games_df.to_csv(games_csv, index=False)
    plog.to_csv(plog_csv, index=False)
    print(f"Saved CSVs:\n  - {os.path.abspath(games_csv)}\n  - {os.path.abspath(plog_csv)}")

    print("\nDone. Tip: to explore schema quickly, try:")
    print("  python - <<'PY'\n"
          "import pandas as pd\n"
          f"print(pd.read_csv('{games_csv}').columns.tolist())\n"
          "PY")

if __name__ == "__main__":
    main()
