-- 084_noble_rank_required_counts.sql
-- Reajusta required_count de noble_ranks para que level 1 requiera 1 pagus.
-- Elimina el uso de max_fiefs_limit (se deja a NULL en todos los rangos).

UPDATE noble_ranks SET required_count = 0,  max_fiefs_limit = NULL WHERE level_order = 1;
UPDATE noble_ranks SET required_count = 3,  max_fiefs_limit = NULL WHERE level_order = 2;
UPDATE noble_ranks SET required_count = 6,  max_fiefs_limit = NULL WHERE level_order = 3;
UPDATE noble_ranks SET required_count = 9,  max_fiefs_limit = NULL WHERE level_order = 4;
UPDATE noble_ranks SET required_count = 14, max_fiefs_limit = NULL WHERE level_order = 5;
UPDATE noble_ranks SET required_count = 20, max_fiefs_limit = NULL WHERE level_order = 6;

INSERT INTO schema_migrations (script_name)
VALUES ('084_noble_rank_required_counts.sql')
ON CONFLICT DO NOTHING;
