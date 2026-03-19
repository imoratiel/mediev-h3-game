-- sql/049_audit_events.sql
-- Crea la tabla para almacenar de forma persistente los eventos de auditoría leídos desde Kafka.

CREATE TABLE IF NOT EXISTS audit_events (
    id SERIAL PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    topic VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    partition INT NOT NULL,
    offset_val BIGINT NOT NULL,
    payload JSONB NOT NULL
);
