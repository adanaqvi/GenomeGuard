"""Train a conservative ClinVar-derived research baseline.

This is not a clinical classifier. It uses only allele-sequence features; clinical
significance is the target, never an input feature. Evaluation holds out genes.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

LABELS = {
    "pathogenic": 1,
    "likely pathogenic": 1,
    "benign": 0,
    "likely benign": 0,
}
DNA = re.compile(r"^[ACGTN]+$", re.IGNORECASE)
NUMERIC = [
    "ref_length", "alt_length", "length_delta", "gc_ref", "gc_alt",
    "transition", "transversion", "is_indel", "is_snv",
]
CATEGORICAL = ["variant_class"]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def open_text(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8-sig", newline="")
    return path.open("r", encoding="utf-8-sig", newline="")


def normalized_label(value: str) -> int | None:
    terms = {part.strip().lower() for part in re.split(r"[,|/]", value)}
    if terms & {"conflicting classifications of pathogenicity", "conflicting data from submitters"}:
        return None
    positive = terms & {"pathogenic", "likely pathogenic"}
    negative = terms & {"benign", "likely benign"}
    if positive and not negative:
        return 1
    if negative and not positive:
        return 0
    return None


def gc_fraction(allele: str) -> float:
    return sum(base in "GC" for base in allele.upper()) / len(allele) if allele else 0.0


def features(ref: str, alt: str) -> dict:
    ref, alt = ref.upper(), alt.upper()
    pair = (ref, alt)
    transitions = {("A", "G"), ("G", "A"), ("C", "T"), ("T", "C")}
    transversions = {
        ("A", "C"), ("A", "T"), ("C", "A"), ("C", "G"),
        ("G", "C"), ("G", "T"), ("T", "A"), ("T", "G"),
    }
    is_snv = len(ref) == len(alt) == 1
    return {
        "ref_length": len(ref),
        "alt_length": len(alt),
        "length_delta": len(alt) - len(ref),
        "gc_ref": gc_fraction(ref),
        "gc_alt": gc_fraction(alt),
        "transition": int(is_snv and pair in transitions),
        "transversion": int(is_snv and pair in transversions),
        "is_indel": int(len(ref) != len(alt)),
        "is_snv": int(is_snv),
        "variant_class": "SNV" if is_snv else ("MNV" if len(ref) == len(alt) else "INDEL"),
    }


def load_rows(path: Path) -> tuple[list[dict], list[int], list[str], Counter]:
    rows: list[dict] = []
    labels: list[int] = []
    groups: list[str] = []
    counts: Counter = Counter()
    seen: set[tuple[str, str, str, str]] = set()
    with open_text(path) as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        required = {
            "Assembly", "Chromosome", "ReferenceAllele", "AlternateAllele",
            "ClinicalSignificance", "ReviewStatus", "GeneSymbol",
        }
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError("ClinVar file missing columns: " + ", ".join(sorted(missing)))
        for row in reader:
            counts["source_rows"] += 1
            if row["Assembly"] != "GRCh38":
                counts["wrong_assembly"] += 1
                continue
            if "conflict" in (row["ReviewStatus"] or "").lower():
                counts["conflicting_review"] += 1
                continue
            if "criteria provided" not in (row["ReviewStatus"] or "").lower():
                counts["insufficient_review"] += 1
                continue
            label = normalized_label(row["ClinicalSignificance"] or "")
            if label is None:
                counts["excluded_label"] += 1
                continue
            ref = (row["ReferenceAllele"] or "").strip()
            alt = (row["AlternateAllele"] or "").strip()
            gene = (row["GeneSymbol"] or "").strip()
            chrom = (row["Chromosome"] or "").strip()
            if not gene or not chrom or not DNA.fullmatch(ref) or not DNA.fullmatch(alt):
                counts["unsupported_allele_or_missing_gene"] += 1
                continue
            key = (chrom, (row.get("Start") or "").strip(), ref, alt)
            if key in seen:
                counts["duplicate_allele"] += 1
                continue
            seen.add(key)
            rows.append(features(ref, alt))
            labels.append(label)
            groups.append(gene)
            counts["included"] += 1
    return rows, labels, groups, counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True, help="ClinVar variant_summary.txt[.gz]")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--random-state", type=int, default=2026)
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()
    if not 0.1 <= args.test_size <= 0.4:
        parser.error("--test-size must be between 0.1 and 0.4")
    if not args.input.is_file() or args.input.stat().st_size == 0:
        parser.error("input file is missing or empty")

    X_rows, y, groups, counts = load_rows(args.input)
    X = pd.DataFrame(X_rows, columns=NUMERIC + CATEGORICAL)
    if len(X) < 100 or len(set(groups)) < 10 or len(set(y)) != 2:
        raise SystemExit(
            f"Insufficient eligible data: rows={len(X)}, genes={len(set(groups))}, "
            f"classes={sorted(set(y))}. Need >=100 rows, >=10 genes, and both classes."
        )

    splitter = GroupShuffleSplit(
        n_splits=1, test_size=args.test_size, random_state=args.random_state
    )
    train_idx, test_idx = next(splitter.split(X, y, groups))
    X_train = X.iloc[train_idx]
    X_test = X.iloc[test_idx]
    y_train = np.asarray([y[i] for i in train_idx])
    y_test = np.asarray([y[i] for i in test_idx])
    train_genes = {groups[i] for i in train_idx}
    test_genes = {groups[i] for i in test_idx}
    if train_genes & test_genes or len(set(y_train)) != 2 or len(set(y_test)) != 2:
        raise SystemExit("Group split did not produce disjoint genes and both classes; refusing to train.")

    preprocess = ColumnTransformer([
        ("numeric", Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]), NUMERIC),
        ("categorical", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
    ])
    model = Pipeline([
        ("features", preprocess),
        ("classifier", LogisticRegression(
            class_weight="balanced", max_iter=3000, random_state=args.random_state
        )),
    ])
    model.fit(X_train, y_train)
    probabilities = model.predict_proba(X_test)[:, 1]
    predictions = (probabilities >= 0.5).astype(int)
    metrics = {
        "accuracy": float(accuracy_score(y_test, predictions)),
        "balanced_accuracy": float(balanced_accuracy_score(y_test, predictions)),
        "precision": float(precision_score(y_test, predictions, zero_division=0)),
        "recall": float(recall_score(y_test, predictions, zero_division=0)),
        "f1": float(f1_score(y_test, predictions, zero_division=0)),
        "auroc": float(roc_auc_score(y_test, probabilities)),
        "average_precision": float(average_precision_score(y_test, probabilities)),
        "brier_score": float(brier_score_loss(y_test, probabilities)),
        "confusion_matrix_tn_fp_fn_tp": confusion_matrix(y_test, predictions).ravel().tolist(),
        "classification_report": classification_report(
            y_test, predictions, target_names=["benign_or_likely_benign", "pathogenic_or_likely_pathogenic"],
            output_dict=True, zero_division=0
        ),
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    model_path = args.output_dir / "clinvar_sequence_baseline.joblib"
    metrics_path = args.output_dir / "metrics.json"
    metadata_path = args.output_dir / "metadata.json"
    joblib.dump(model, model_path)
    metadata = {
        "model_name": "clinvar_sequence_baseline",
        "model_version": "0.1.0",
        "task": "research-only binary ClinVar label baseline",
        "source": "NCBI ClinVar variant_summary",
        "source_file": args.input.name,
        "source_sha256": sha256(args.input),
        "assembly": "GRCh38",
        "label_policy": "Pathogenic/Likely pathogenic vs Benign/Likely benign; exclude uncertain, conflicting, and other labels",
        "review_policy": "Require criteria provided; exclude review statuses containing conflict",
        "feature_policy": "Allele-sequence features only; no clinical label, genomic coordinate, gene identity, phenotype, or submitter fields",
        "split_policy": "Single gene-disjoint GroupShuffleSplit holdout; this is not external cohort validation",
        "random_state": args.random_state,
        "train_rows": len(train_idx),
        "test_rows": len(test_idx),
        "train_gene_count": len(train_genes),
        "test_gene_count": len(test_genes),
        "scikit_learn_version": sklearn.__version__,
        "counts": dict(counts),
    }
    metrics_path.write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n")
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "model": str(model_path),
        "model_sha256": sha256(model_path),
        "metrics": str(metrics_path),
        "metadata": str(metadata_path),
        "summary": {k: v for k, v in metrics.items() if isinstance(v, float)},
        "metadata": metadata,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
