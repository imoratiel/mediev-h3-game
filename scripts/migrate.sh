#!/bin/sh
# migrate.sh — aplica los scripts SQL pendientes en orden.
# Se ejecuta dentro del contenedor db:
#   docker compose exec -T db sh /scripts/migrate.sh
#
# Lógica:
#   - Recorre todos los .sql de /docker-entrypoint-initdb.d/ en orden
#   - Comprueba si ya está registrado en schema_migrations
#   - Si no, lo aplica y lo registra

set -e

DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}"

echo "=== Migraciones pendientes ==="

for f in $(ls /docker-entrypoint-initdb.d/*.sql | sort); do
    name=$(basename "$f")

    exists=$(psql "$DB_URL" -tAc \
        "SELECT 1 FROM schema_migrations WHERE script_name='$name'" 2>/dev/null || echo "")

    if [ "$exists" = "1" ]; then
        echo "  ✓ $name (ya aplicado)"
    else
        echo "  → Aplicando: $name"
        psql "$DB_URL" -f "$f"
        psql "$DB_URL" -c \
            "INSERT INTO schema_migrations(script_name) VALUES('$name') ON CONFLICT DO NOTHING"
        echo "  ✓ $name aplicado"
    fi
done

echo "=== Migraciones completadas ==="
