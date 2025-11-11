"""
Regression metrics for the rating model.
"""

from __future__ import annotations

from typing import Dict

import numpy as np
from scipy import stats
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def regression_metrics(y_true, y_pred) -> Dict[str, float]:
    """
    Compute MAE, RMSE, R^2, and Spearman correlation.
    """

    mae = mean_absolute_error(y_true, y_pred)
    mse = mean_squared_error(y_true, y_pred)
    rmse = float(np.sqrt(mse))
    r2 = r2_score(y_true, y_pred)
    spearman = stats.spearmanr(y_true, y_pred).correlation
    if np.isnan(spearman):
        spearman = 0.0

    return {
        "mae": float(mae),
        "rmse": rmse,
        "r2": float(r2),
        "spearman": float(spearman),
    }
