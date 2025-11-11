"""
Model factory utilities.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import ElasticNet
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def create_model(
    model_type: str,
    random_state: int = 7,
    model_params: Optional[Dict[str, Any]] = None,
):
    """
    Return a configured sklearn estimator for the requested type.
    """

    model_params = model_params or {}
    model_type = model_type.lower()

    if model_type == "elasticnet":
        base = ElasticNet(random_state=random_state, **model_params)
        return Pipeline([("scaler", StandardScaler()), ("model", base)])

    if model_type in {"rf", "random_forest"}:
        return RandomForestRegressor(random_state=random_state, **model_params)

    if model_type in {"hist_gbrt", "gbrt"}:
        return HistGradientBoostingRegressor(random_state=random_state, **model_params)

    raise ValueError(f"Unsupported model type: {model_type}")

