-- Read-only application access to aggregate public population-reference frequencies.
-- Participant calls and governance release tables are intentionally not covered by this role.
CREATE INDEX IF NOT EXISTS population_variant_frequency_locus_idx
  ON genomeguard.population_variant_frequency
  (chromosome, position, reference_allele, alternate_allele, dataset_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genomeguard_reference_reader') THEN
    CREATE ROLE genomeguard_reference_reader NOLOGIN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT genomeguard_reference_reader TO service_role';
  END IF;
END
$$;

DROP POLICY IF EXISTS population_reference_manifest_reader_select
  ON genomeguard.population_reference_manifest;
CREATE POLICY population_reference_manifest_reader_select
  ON genomeguard.population_reference_manifest
  FOR SELECT TO genomeguard_reference_reader
  USING (data_use_review = 'approved_public_research' AND import_status = 'loaded');

DROP POLICY IF EXISTS population_variant_frequency_reader_select
  ON genomeguard.population_variant_frequency;
CREATE POLICY population_variant_frequency_reader_select
  ON genomeguard.population_variant_frequency
  FOR SELECT TO genomeguard_reference_reader
  USING (EXISTS (
    SELECT 1
    FROM genomeguard.population_reference_manifest AS m
    WHERE m.id = dataset_id
      AND m.data_use_review = 'approved_public_research'
      AND m.import_status = 'loaded'
  ));

GRANT USAGE ON SCHEMA genomeguard TO genomeguard_reference_reader;
GRANT SELECT ON genomeguard.population_reference_manifest TO genomeguard_reference_reader;
GRANT SELECT ON genomeguard.population_variant_frequency TO genomeguard_reference_reader;
