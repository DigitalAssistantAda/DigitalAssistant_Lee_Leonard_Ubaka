#!/usr/bin/env python3
"""
Train a multinomial LogisticRegression on sentence-transformer embeddings for reminder types.

  cd backend && python scripts/train_reminder_classifier.py
  python scripts/train_reminder_classifier.py --data data/extra_labels.jsonl

Output: REMINDER_CLASSIFIER_PATH (default data/reminder_classifier_bundle.joblib)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Project root = parent of scripts/
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import LabelEncoder

from config import settings
from utils.embeddings import embeddings_service


def load_jsonl(paths: list[Path]) -> tuple[list[str], list[str]]:
    texts: list[str] = []
    labels: list[str] = []
    for path in paths:
        if not path.is_file():
            print(f"Skip missing: {path}", file=sys.stderr)
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                t = (row.get("text") or "").strip()
                lab = (row.get("label") or "").strip()
                if len(t) < 12 or not lab:
                    continue
                texts.append(t[:2000])
                labels.append(lab)
    return texts, labels


def main() -> int:
    parser = argparse.ArgumentParser(description="Train reminder type classifier on embeddings.")
    parser.add_argument(
        "--data",
        action="append",
        type=Path,
        help="Additional JSONL file(s) with {text, label}. Can repeat.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output joblib path (default: REMINDER_CLASSIFIER_PATH from settings)",
    )
    args = parser.parse_args()

    default_data = BACKEND_ROOT / "data" / "reminder_training_samples.jsonl"
    data_files = [default_data]
    if args.data:
        data_files.extend(Path(p).resolve() for p in args.data)

    texts, labels = load_jsonl(data_files)
    if len(texts) < 20:
        print("Need at least ~20 labeled rows; check JSONL paths.", file=sys.stderr)
        return 1

    le = LabelEncoder()
    y = le.fit_transform(labels)

    print(f"Samples: {len(texts)}  Classes: {list(le.classes_)}")
    print(f"Embedding model: {embeddings_service.model_name}")

    X = np.asarray(
        embeddings_service.generate_batch_embeddings(texts, input_type="document"),
        dtype=np.float32,
    )

    clf = LogisticRegression(
        max_iter=2000,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X, y)

    out_path = args.output
    if out_path is None:
        out_path = Path(settings.reminder_classifier_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    import joblib

    bundle = {
        "clf": clf,
        "label_encoder": le,
        "classes": list(le.classes_),
        "embedding_service": embeddings_service.model_name,
        "n_samples": len(texts),
    }
    joblib.dump(bundle, out_path)
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
