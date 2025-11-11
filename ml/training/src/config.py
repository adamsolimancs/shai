"""
YAML-backed configuration objects for the player rating trainer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Mapping, MutableMapping, Optional

import yaml


@dataclass
class DataConfig:
    """Input/output paths for training data."""

    input_path: str = "ml/data/processed/game_logs.parquet"
    synthetic_output_path: str = "ml/data/processed/synth_game_logs.parquet"
    timestamp_column: Optional[str] = "game_date"
    target_column: Optional[str] = None
    id_columns: List[str] = field(default_factory=lambda: ["player_id", "game_id"])


@dataclass
class FeatureConfig:
    """Feature-engineering options."""

    per36_base_stats: List[str] = field(
        default_factory=lambda: ["pts", "ast", "reb", "stl", "blk", "tov", "plus_minus"]
    )
    retain_raw_stats: List[str] = field(
        default_factory=lambda: ["plus_minus", "ts_pct", "usg_pct"]
    )
    categorical: List[str] = field(default_factory=lambda: ["position"])
    minimum_minutes: float = 6.0


@dataclass
class TargetConfig:
    """Target-building controls."""

    type: str = "heuristic"
    label_column: str = "rating"
    scale_min: float = 0.0
    scale_max: float = 100.0
    weights: Dict[str, float] = field(
        default_factory=lambda: {
            "pts_per36": 0.35,
            "ast_per36": 0.2,
            "reb_per36": 0.2,
            "stl_per36": 0.1,
            "blk_per36": 0.1,
            "tov_per36": -0.1,
            "ts_pct": 0.2,
            "plus_minus_per36": 0.15,
        }
    )


@dataclass
class TrainingSettings:
    """Model training hyper-parameters."""

    test_size: float = 0.2
    random_state: int = 7
    model_type: str = "elasticnet"
    model_params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class OutputSettings:
    """Artifact persistence controls."""

    dir: str = "models/player_ratings"
    tag: str = "dev"


@dataclass
class TrainingConfig:
    """Top-level configuration aggregate."""

    mode: str = "game"
    data: DataConfig = field(default_factory=DataConfig)
    features: FeatureConfig = field(default_factory=FeatureConfig)
    target: TargetConfig = field(default_factory=TargetConfig)
    training: TrainingSettings = field(default_factory=TrainingSettings)
    output: OutputSettings = field(default_factory=OutputSettings)


def _merge_dict(default: MutableMapping[str, Any], override: Mapping[str, Any]) -> None:
    for key, val in override.items():
        if (
            key in default
            and isinstance(default[key], MutableMapping)
            and isinstance(val, Mapping)
        ):
            _merge_dict(default[key], val)
        else:
            default[key] = val


def load_config(path: str | Path) -> TrainingConfig:
    """
    Load a YAML config file and convert it into a strongly-typed TrainingConfig.
    """

    path = Path(path)
    with path.open("r", encoding="utf-8") as fp:
        raw: Dict[str, Any] = yaml.safe_load(fp) or {}

    default = TrainingConfig()
    merged: Dict[str, Any] = {
        "mode": default.mode,
        "data": dict(default.data.__dict__),
        "features": dict(default.features.__dict__),
        "target": dict(default.target.__dict__),
        "training": dict(default.training.__dict__),
        "output": dict(default.output.__dict__),
    }
    _merge_dict(merged, raw)

    return TrainingConfig(
        mode=merged["mode"],
        data=DataConfig(**merged["data"]),
        features=FeatureConfig(**merged["features"]),
        target=TargetConfig(**merged["target"]),
        training=TrainingSettings(**merged["training"]),
        output=OutputSettings(**merged["output"]),
    )
