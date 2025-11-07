# ML — Player Ratings (Season & Single-Game)

Design doc + quickstart for training a **float player rating** model from either **season averages** or **single‑game** stat lines. Opinionated but lightweight; swap components as you grow.

---

## What we're building (TL;DR)
- A supervised regression model `rating ∈ ℝ` that scores an NBA player’s performance:
  - **Season mode:** per‑player‑per‑season row → season rating.
  - **Game mode:** per‑player‑per‑game row → game rating.
- Ratings are **relative & continuous** (e.g., 0–100 scale), not an Elo. You can normalize by season if wanted.

---

## Repo layout (proposed)

```
ml/
  data/
    raw/              # immutable source csv/parquet (kaggle + your patches)
    interim/          # cleaned, joined, with IDs resolved
    processed/        # train/val/test tables with features/labels
  experiments/        # notebooks, one-offs (exploration only)
  training/
    configs/
      train.yaml      # entrypoint config (hyperparams, paths, features)
    src/
      io.py           # load/save helpers
      synth.py        # synthetic data generator (optional)
      features.py     # feature building (season + game)
      target.py       # rating target contruction/normalization
      model.py        # model factory (xgboost/sklearn/lightgbm)
      train.py        # CLI: train/eval/export
      eval.py         # CLI: offline eval & reports
      metrics.py      # MAE/RMSE/Spearman/Calib
  inference/
    loader.py         # load model artifact + feature signature
    serve.py          # minimal FastAPI service (optional)
models/
  player_ratings/
    <run_id>/
      model.bin
      feature_schema.json
      metrics.json
      config_used.yaml
      version.txt
```

---

## Data assumptions

You can train from either **season tables** or **game logs** (or both, switchable by config).

### Minimum schema (season rows)
| column                 | type      | notes |
|------------------------|-----------|------|
| `player_id`            | int/str   | canonical ID |
| `season`               | str       | 'YYYY-YY' |
| `team_id`              | int/str   | |
| `gp`, `mpg`            | int,float | games played, minutes per game |
| `pts`, `reb`, `ast`    | float     | per‑game or totals (be consistent) |
| `ts_pct`, `usg_pct`    | float     | advanced ok if available |
| `tov`, `stl`, `blk`    | float     | |
| `oreb`, `dreb`         | float     | |
| `ft_rate`, `3pa`, `fg3_pct` | float | |

### Minimum schema (single‑game rows)
Add: `game_id`, `game_date`, `home_away`, `wl`, `min`, `plus_minus`, opponent features (e.g., opp_def_rating).

> Tip: Store **per-minute** features alongside raw counts to avoid minutes confounding.

---

## Target: what is the “rating”?

Pick one (config‑controlled):

1) **Heuristic composite** (no labels needed):  
   - Weighted z‑scores of (PTS, AST, REB, STL, BLK, TOV−, TS%, …) with minutes scaling + position priors.  
   - Pros: fast bootstrap target. Cons: bakes in your biases.

2) **Distant supervision**:  
   - Train the model to predict a proxy like **BPM**, **RAPM**, **Game Score**, **Player Impact Estimate**, or **Stathead Game Score**.  
   - Pros: grounded; Cons: inherits proxy’s flaws; watch licensing.

3) **Human‑annotated synthetic labels**:  
   - Create a rubric (0–100) and generate labels from rules + noise (see `synth.py`).  
   - Pros: easy; Cons: not “true.” Good for pipeline bring‑up.

> Whatever you choose, **document it** in `target.py`. The model predicts *your* target definition.

---

## Feature engineering (starter set)

- **Rate stats:** PTS/36, AST/36, REB/36, STL/36, BLK/36, TOV/36
- **Efficiency:** TS%, eFG%, FT rate, 3PAr, AST/TOV
- **Shooting splits:** Rim/Mid/3P accuracy if available; else FG3% + 2P%
- **Role proxies:** USG%, potential AST (if present), %FGA 3PT
- **On/Off-lite:** PLUS_MINUS per minute (guard against noise)
- **Context:** Opponent DEF rating (rolling), pace, garbage‑time guard
- **Recency:** Rolling means over last N games (game mode)
- **Stability controls:** Minutes played, games played (season mode)

Normalize numerics (StandardScaler or per‑season z‑score). One‑hot team/position if used. Clip outliers (winsorize).

---

## Models

Start simple, upgrade later:

- **Linear/ElasticNet** — transparent baseline
- **Gradient Boosting**: XGBoost/LightGBM/CatBoost
- **TabNet/MLP** (optional)

Use **Spearman ρ** (rank quality) + **MAE/RMSE**. Keep a **simple baseline** (Game Score) to avoid regressions.

---

## Training pipeline

### CLI
```bash
# Dry run on synthetic data
python -m ml.training.train --config ml/training/configs/train.yaml --synthetic 1

# Real run on processed season table
python -m ml.training.train --config ml/training/configs/train.yaml
```

### `train.yaml` (template)
```yaml
seed: 42
mode: "season"        # or "game"
paths:
  raw: "ml/data/raw"
  interim: "ml/data/interim"
  processed: "ml/data/processed"
  out_dir: "models/player_ratings"
features:
  numeric: ["pts_per36","ast_per36","reb_per36","ts_pct","tov_per36","stl_per36","blk_per36","usg_pct","plus_minus_per36","pace"]
  categorical: ["position"]
target:
  kind: "heuristic"   # heuristic | proxy | synthetic
  scale: "0_100"      # rescale to 0-100 for UX
split:
  method: "time"      # time | season | random
  val_seasons: ["2023-24"]
  test_seasons: ["2024-25"]
model:
  type: "xgboost"
  params:
    n_estimators: 600
    max_depth: 6
    learning_rate: 0.05
    subsample: 0.8
    colsample_bytree: 0.8
evaluation:
  metrics: ["rmse","mae","spearman"]
export:
  save_schema: true
  save_metrics: true
```

### Outputs
- `models/player_ratings/<run_id>/model.bin`
- `feature_schema.json` (names, dtypes, normalization)
- `metrics.json` (train/val/test)
- `config_used.yaml` (for reproducibility)

---

## Synthetic data (optional bootstrap)

When you have no labels: generate a toy dataset to wire everything up.

`ml/training/src/synth.py` should:
1) Sample base skills per player (`scoring`, `passing`, `rebounding`, `defense`) ~ Normal(0,1)
2) Generate observed box‑score stats from those skills + minutes + noise
3) Construct a **synthetic target**:
   ```
   rating = 40*scoring + 25*passing + 20*defense + 15*rebounding + ε
   → rescale to 0–100
   ```
4) Export to `ml/data/processed/`

This lets you validate: features, training loop, metrics, export.

---

## Evaluation

Report at least:
- **RMSE / MAE**
- **Spearman ρ** (rank correlation) — season and game modes
- **Error vs Minutes** (calibration by playing time)
- **Leakage checks** (don’t use future stats when splitting by time)
- **Ablations** (drop feature groups: shooting, role, context)

Store plots in `models/<run_id>/reports/`.

---

## Inference contract

**Input** (JSON):
```json
{
  "mode": "game",
  "features": {
    "pts_per36": 28.4,
    "ast_per36": 6.9,
    "reb_per36": 7.2,
    "ts_pct": 0.618,
    "tov_per36": 3.4,
    "stl_per36": 1.4,
    "blk_per36": 0.8,
    "usg_pct": 31.2,
    "plus_minus_per36": 4.1,
    "pace": 100.8,
    "position": "F"
  }
}
```

**Output**:
```json
{
  "rating": 87.3,
  "version": "player_ratings@2025-11-08",
  "explanations": { "ts_pct": 0.31, "usg_pct": 0.22, "ast_per36": 0.18 }
}
```

> Keep the feature order and types identical to `feature_schema.json`.

---

## Reproducibility & tracking

- Fix seeds; save `config_used.yaml` per run.
- Log to **MLflow** or a minimal `metrics.json`.
- Version artifacts by date + git short SHA.

---

## Deployment notes

- Embed the model in your API process (simple) or serve via a small `inference/serve.py` FastAPI microservice.
- Don’t train inside the API process. Export → load.
- Put a **model registry pointer** (env var) so you can flip versions without redeploy.

---

## Licensing & ethics

- If you use NBA data: respect provider ToS; don’t redistribute bulk proprietary data.
- For Unsplash or other images: follow license + attribution rules.
- Be transparent: document what “rating” means and its limitations.

---

## Roadmap (nice-to-haves)
- SHAP/Permutation importances in reports
- Per‑position normalization
- Uncertainty estimates (conformal intervals)
- Live updating with Bayesian smoothing
- Leaderboards UI + time‑series charts

---

## Make it go (quickstart)

```bash
# 1) Create/prepare data (or generate synthetic)
python -m ml.training.train --config ml/training/configs/train.yaml --synthetic 1

# 2) Train real model (season mode)
python -m ml.training.train --config ml/training/configs/train.yaml

# 3) Evaluate saved artifact
python -m ml.training.eval --model models/player_ratings/<run_id>/model.bin
```

Questions to lock down in config:
- Which target (heuristic vs proxy)?
- Season vs game mode split policy?
- Per‑36 vs raw? Normalize per season?
- Do we include context (opponent, pace)?

Footnote: keep it simple first, then iterate.
