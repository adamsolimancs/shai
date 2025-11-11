"""
Synthetic dataset generator for bootstrapping the training pipeline.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import pandas as pd

LOGGER = logging.getLogger(__name__)


def generate_synthetic_game_data(
    num_players: int = 40,
    games_per_player: int = 12,
    seed: int = 7,
    output_path: Optional[str | Path] = None,
) -> Tuple[pd.DataFrame, Optional[Path]]:
    """
    Create a toy dataset that mimics single-game box scores with ratings.
    Returns the DataFrame and the path it was written to (if any).
    """

    rng = np.random.default_rng(seed)
    base_skills = rng.normal(loc=0.0, scale=1.0, size=(num_players, 4))
    positions = rng.choice(["G", "F", "C"], size=num_players, p=[0.4, 0.4, 0.2])

    rows = []
    start_date = pd.Timestamp("2024-01-01")

    for player_idx in range(num_players):
        player_id = f"P{player_idx:03d}"
        skill_scoring, skill_passing, skill_rebounding, skill_defense = base_skills[
            player_idx
        ]
        position = positions[player_idx]
        for game_idx in range(games_per_player):
            minutes = np.clip(rng.normal(30, 6), 8, 42)
            pace = np.clip(rng.normal(99, 2), 92, 105)
            usage = np.clip(20 + skill_scoring * 5 + rng.normal(0, 2), 12, 34)
            pts = np.clip(
                minutes / 36 * (18 + skill_scoring * 5 + rng.normal(0, 4)), 0, 60
            )
            ast = np.clip(
                minutes / 36 * (4 + skill_passing * 4 + rng.normal(0, 2)), 0, 20
            )
            reb = np.clip(
                minutes / 36 * (6 + skill_rebounding * 4 + rng.normal(0, 2)), 0, 20
            )
            stl = np.clip(
                minutes / 36 * (1.2 + skill_defense * 0.8 + rng.normal(0, 0.4)), 0, 5
            )
            blk = np.clip(
                minutes / 36 * (0.6 + skill_defense * 1.2 + rng.normal(0, 0.3)),
                0,
                6,
            )
            tov = np.clip(
                minutes / 36 * (2.0 - skill_passing * 0.3 + rng.normal(0, 0.4)), 0, 8
            )
            plus_minus = np.clip(
                rng.normal(loc=skill_scoring * 4 + skill_defense * 3, scale=8), -30, 30
            )
            ts_pct = np.clip(
                0.5 + skill_scoring * 0.05 + rng.normal(0, 0.03), 0.45, 0.75
            )

            rating = (
                40 * skill_scoring
                + 25 * skill_passing
                + 20 * skill_defense
                + 15 * skill_rebounding
                + rng.normal(0, 5)
            )
            rating = np.interp(rating, (-100, 100), (0, 100))

            rows.append(
                {
                    "player_id": player_id,
                    "game_id": f"G{player_idx:03d}-{game_idx:03d}",
                    "game_date": start_date + pd.Timedelta(days=int(game_idx)),
                    "team_id": f"T{player_idx % 5}",
                    "opponent_id": f"T{(player_idx + 1) % 5}",
                    "home_away": rng.choice(["H", "A"]),
                    "wl": rng.choice(["W", "L"]),
                    "minutes": minutes,
                    "pace": pace,
                    "pts": pts,
                    "ast": ast,
                    "reb": reb,
                    "stl": stl,
                    "blk": blk,
                    "tov": tov,
                    "plus_minus": plus_minus,
                    "ts_pct": ts_pct,
                    "usg_pct": usage,
                    "position": position,
                    "rating": rating,
                }
            )

    df = pd.DataFrame(rows)
    written_path: Optional[Path] = None

    if output_path:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            if output_path.suffix == ".csv":
                df.to_csv(output_path, index=False)
                written_path = output_path
            else:
                df.to_parquet(output_path, index=False)
                written_path = output_path
        except ImportError:
            fallback = output_path.with_suffix(".csv")
            LOGGER.warning(
                "Parquet engine missing; writing synthetic data to %s instead.", fallback
            )
            df.to_csv(fallback, index=False)
            written_path = fallback

    return df, written_path
