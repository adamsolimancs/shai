"""
CLI entry-point for training the player rating regression model.
"""

from __future__ import annotations

import argparse
import logging
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict

import pandas as pd
from sklearn.model_selection import train_test_split

from . import features, io, metrics, model, synth, target
from .config import TrainingConfig, load_config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
LOGGER = logging.getLogger("player_ratings.train")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the player rating model.")
    parser.add_argument(
        "--config",
        default="ml/training/configs/train.yaml",
        help="Path to YAML config.",
    )
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="Generate a synthetic dataset before training.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional row cap for fast local experiments.",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Override for artifact output directory.",
    )
    return parser.parse_args()


def config_to_dict(config: TrainingConfig) -> Dict[str, Any]:
    return asdict(config)


def main() -> None:
    args = parse_args()
    config = load_config(args.config)

    if args.output_dir:
        config.output.dir = args.output_dir

    if args.synthetic:
        LOGGER.info("Generating synthetic data...")
        df, saved_path = synth.generate_synthetic_game_data(
            output_path=config.data.synthetic_output_path
        )
        if saved_path:
            LOGGER.info("Synthetic dataset written to %s", saved_path)
            config.data.input_path = str(saved_path)
    else:
        df = io.load_table(config.data.input_path)

    if args.limit:
        df = df.head(args.limit)
    LOGGER.info("Loaded %d rows for training.", len(df))

    feature_df, feature_schema = features.build_game_features(df, config.features)
    target_series = target.build_game_target(df, feature_df, config.target)
    if target_series.name is None:
        target_series.name = config.target.label_column or "rating"

    dataset = feature_df.join(target_series)
    dataset = dataset.dropna()
    feature_cols = feature_df.columns.tolist()

    X = dataset[feature_cols]
    y = dataset[target_series.name]

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=config.training.test_size,
        random_state=config.training.random_state,
    )

    estimator = model.create_model(
        config.training.model_type,
        random_state=config.training.random_state,
        model_params=config.training.model_params,
    )
    estimator.fit(X_train, y_train)
    LOGGER.info("Model type %s trained on %d examples.", config.training.model_type, len(X_train))

    predictions = estimator.predict(X_test)
    metric_summary = metrics.regression_metrics(y_test, predictions)
    LOGGER.info("Validation metrics: %s", metric_summary)

    run_dir = io.save_artifacts(
        estimator,
        feature_schema={
            "features": [{"name": name, "dtype": str(feature_df[name].dtype)} for name in feature_cols]
        },
        metrics=metric_summary,
        config=config_to_dict(config),
        output_dir=config.output.dir,
    )
    LOGGER.info("Artifacts saved to %s", run_dir)


if __name__ == "__main__":
    main()
