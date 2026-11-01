# ClinVar research baseline training

This workflow creates a reproducible **research-only baseline**, not a clinical-grade
pathogenicity predictor. It downloads the public NCBI ClinVar tab-delimited summary at
run time; the source artifact and checksum are recorded in the output metadata.

## Run

1. Review the NCBI ClinVar data-use terms and the workflow source.
2. In GitHub Actions, manually run **ClinVar research baseline training** and confirm
   the public-data input.
3. Download the workflow artifact and inspect `metadata.json`, `metrics.json`, and
   the model checksum. Do not treat an unexecuted workflow as a trained model.

Equivalent local command:

```bash
pip install -e '.[ml]'
curl -fL https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz \
  -o /secure/variant_summary.txt.gz
PYTHONPATH=backend python -m app.ml.clinvar_train \
  --input /secure/variant_summary.txt.gz \
  --output-dir ./artifacts/clinvar-baseline
```

## Scientific safeguards and limits

- GRCh38 rows only; criteria-provided review status required; conflict statuses excluded.
- Only unambiguous Pathogenic/Likely pathogenic and Benign/Likely benign labels are used.
- Features are derived from REF/ALT sequence only. Clinical labels, coordinates,
  gene identity, phenotypes, and submitter metadata are not model inputs.
- Duplicate chromosome/REF/ALT records are removed.
- The holdout is gene-disjoint to reduce within-gene leakage. It is **not** an external
  cohort validation and does not establish ancestry-specific performance.
- Metrics include AUROC, average precision, sensitivity/recall, specificity via the
  confusion matrix, precision, F1, balanced accuracy, and Brier score.
- This deliberately simple sequence baseline may have weak predictive performance.
  Report the metrics honestly; do not tune on the holdout or present it as clinical evidence.
- The model is not wired into patient-facing decisions, diagnoses, or clinical workflows.
- Do not commit downloaded source data, private data, or generated model artifacts.
