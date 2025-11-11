"""
Feature engineering for single-game player stat lines.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd

from .config import FeatureConfig

MINUTES_CANDIDATES = ("minutes", "minute", "min", "mp", "time_played")


def _resolve_minutes_column(df: pd.DataFrame) -> str:
    for candidate in MINUTES_CANDIDATES:
        if candidate in df.columns:
            return candidate
    raise KeyError(
        "Could not find a minutes column. Expected one of "
        f"{', '.join(MINUTES_CANDIDATES)}."
    )


def build_game_features(
    df: pd.DataFrame, config: FeatureConfig
) -> Tuple[pd.DataFrame, Dict[str, str]]:
    """
    Generate per-36 features, retain selected raw stats, and one-hot categoricals.
    """

    df = df.copy()
    minutes_col = _resolve_minutes_column(df)
    minutes = (
        df[minutes_col]
        .astype(float)
        .clip(lower=config.minimum_minutes)
        .replace(0.0, config.minimum_minutes)
    )
    per36_factor = 36.0 / minutes

    feature_parts: List[pd.DataFrame] = []
    schema: Dict[str, str] = {}

    for stat in config.per36_base_stats:
        if stat not in df.columns:
            continue
        per36_col = f"{stat}_per36"
        feature_parts.append(pd.DataFrame({per36_col: df[stat].fillna(0) * per36_factor}))
        schema[per36_col] = "float"

    for stat in config.retain_raw_stats:
        if stat not in df.columns:
            continue
        feature_parts.append(pd.DataFrame({stat: df[stat].fillna(0)}))
        schema[stat] = "float"

    # Derived ratios that are useful regardless of availability.
    if "ast" in df.columns and "tov" in df.columns:
        ast_tov = (df["ast"].fillna(0) + 1e-3) / (df["tov"].fillna(0) + 1e-3)
        feature_parts.append(pd.DataFrame({"ast_to_ratio": ast_tov}))
        schema["ast_to_ratio"] = "float"

    categorical_source = []
    for col in config.categorical:
        if col in df.columns:
            categorical_source.append(col)

    if categorical_source:
        cat_features = pd.get_dummies(
            df[categorical_source].fillna("unknown"), prefix=categorical_source
        ).astype(float)
        feature_parts.append(cat_features)
        for name in cat_features.columns:
            schema[name] = "float"

    if not feature_parts:
        raise ValueError("No features constructed; check feature configuration.")

    features = pd.concat(feature_parts, axis=1)
    return features, schema
