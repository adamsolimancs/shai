"""
I/O helpers for loading tabular data and saving training artifacts.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import joblib
import pandas as pd


def load_table(path: str | Path) -> pd.DataFrame:
    """
    Read a CSV or Parquet file into a DataFrame.
    """

    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Data file not found: {path}")

    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    if path.suffix.lower() in {".parquet", ".pq"}:
        return pd.read_parquet(path)

    raise ValueError(f"Unsupported file extension for {path}")


def ensure_dir(path: str | Path) -> Path:
    """
    Create the directory if it doesn't exist and return the Path.
    """

    directory = Path(path)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def save_artifacts(
    model: Any,
    feature_schema: Dict[str, Any],
    metrics: Dict[str, float],
    config: Dict[str, Any],
    output_dir: str | Path,
) -> Path:
    """
    Persist model + metadata artifacts under a timestamped run directory.
    """

    root = ensure_dir(output_dir)
    run_id = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    run_dir = ensure_dir(root / run_id)

    model_path = run_dir / "model.joblib"
    joblib.dump(model, model_path)

    schema_path = run_dir / "feature_schema.json"
    schema_path.write_text(json.dumps(feature_schema, indent=2), encoding="utf-8")

    metrics_path = run_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    config_path = run_dir / "config_used.json"
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")

    (run_dir / "version.txt").write_text(run_id, encoding="utf-8")

    return run_dir

