from app.ml.clinvar_train import features, normalized_label


def test_label_policy_accepts_only_binary_unambiguous_labels():
    assert normalized_label("Pathogenic") == 1
    assert normalized_label("Likely pathogenic") == 1
    assert normalized_label("Benign") == 0
    assert normalized_label("Likely benign") == 0
    assert normalized_label("Uncertain significance") is None
    assert normalized_label("Pathogenic|Benign") is None
    assert normalized_label("Conflicting classifications of pathogenicity") is None


def test_features_use_only_ref_alt_sequence():
    result = features("A", "G")
    assert result["transition"] == 1
    assert result["transversion"] == 0
    assert result["is_snv"] == 1
    assert result["variant_class"] == "SNV"


def test_indel_features():
    result = features("A", "ATG")
    assert result["length_delta"] == 2
    assert result["is_indel"] == 1
    assert result["variant_class"] == "INDEL"
