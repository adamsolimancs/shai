"""
Target construction helpers for the rating model.
"""

from __future__ import annotations

from typing import Tuple

import numpy as np
import pandas as pd

from .config import TargetConfig


def build_game_target(
    raw_df: pd.DataFrame, feature_df: pd.DataFrame, config: TargetConfig
) -> pd.Series:
    """
    Return the regression target, using an existing label column if present
    otherwise falling back to the heuristic recipe.
    """

    if config.label_column and config.label_column in raw_df.columns:
        return raw_df[config.label_column].astype(float)

    if config.type == "heuristic":
        return _heuristic_target(feature_df, config)

    raise ValueError(f"Unsupported target type: {config.type}")


def _heuristic_target(features: pd.DataFrame, config: TargetConfig) -> pd.Series:
    """
    Weighted sum of the configured feature columns with scale normalization.
    """

    weight_columns = {col: weight for col, weight in config.weights.items()}
    missing = [col for col in weight_columns if col not in features.columns]
    if missing:
        raise KeyError(
            f"Heuristic target expects columns {missing}, "
            "but they were not found in the feature matrix."
        )

    weighted = sum(features[col].astype(float) * weight for col, weight in weight_columns.items())
    min_val = weighted.min()
    max_val = weighted.max()
    if np.isclose(max_val, min_val):
        return pd.Series(
            (config.scale_min + config.scale_max) / 2.0,
            index=features.index,
        )

    normalized = (weighted - min_val) / (max_val - min_val)
    scaled = normalized * (config.scale_max - config.scale_min) + config.scale_min
    return scaled

