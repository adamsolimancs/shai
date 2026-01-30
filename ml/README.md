# ML

Experimental player rating training pipeline. This folder is for offline experimentation and is not wired into production.

## Stack
- Python 3.11
- pandas, numpy, scikit-learn, pyyaml, joblib, scipy

## Architecture
- Config-driven CLI loads data, builds features/targets, trains a model, and writes artifacts.

## Structure
- `ml/training/src/` training CLI and helpers
- `ml/training/configs/train.yaml` default config
- `ml/data/` raw/interim/processed datasets (includes a small synthetic sample)

## Setup
```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run training
```bash
# generate synthetic data then train
python -m ml.training.src.train --config ml/training/configs/train.yaml --synthetic
```
Artifacts are written to `models/player_ratings/...` by default (see the config for overrides).
