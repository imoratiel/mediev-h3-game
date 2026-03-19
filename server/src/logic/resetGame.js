const pool = require('../../db.js');

/**
 * Resetea completamente una partida en curso manteniendo las cuentas de jugadores.
 *
 * Operaciones (en una sola transacción):
 *  1. Elimina ejércitos y tropas (CASCADE)
 *  2. Elimina trabajadores
 *  3. Elimina construcciones activas
 *  4. Restaura terreno original en hexes de puentes y elimina puentes
 *  5. Elimina edificios de feudos
 *  6. Resetea metadatos de territorios (preserva oro, comida, recursos y población) y elimina divisiones políticas
 *  7. Libera todos los hexes del mapa (player_id = NULL)
 *  8. Elimina mensajes y notificaciones
 *  9. Elimina bots (is_ai = TRUE)
 * 10. Reinicia jugadores humanos: oro, capital, impuestos y diezmo a valores por defecto
 * 11. Reinicia el contador de turnos y la fecha del calendario de juego
 */
async function resetGame() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Adquirir locks exclusivos en todas las tablas afectadas ANTES de cualquier DML.
        // Esto evita deadlocks: si otra conexión tiene un lock activo, esta transacción
        // esperará a que termine en lugar de competir por locks en orden diferente.
        await client.query(`
            LOCK TABLE armies, troops, workers, active_constructions, bridges,
                       fief_buildings, territory_details, h3_map,
                       messages, notifications, players, world_state,
                       political_divisions, characters
            IN ACCESS EXCLUSIVE MODE
        `);

        // 1. Armies (troops cascade via FK)
        await client.query('DELETE FROM armies');

        // 2. Workers
        await client.query('DELETE FROM workers');

        // 3. In-progress bridge constructions
        await client.query('DELETE FROM active_constructions');

        // 4. Restore bridge hexes terrain to River, then remove bridge records
        await client.query(`
            UPDATE h3_map
            SET terrain_type_id = (
                SELECT terrain_type_id FROM terrain_types
                WHERE LOWER(name) IN ('río', 'rio', 'river')
                LIMIT 1
            )
            WHERE h3_index IN (SELECT h3_index FROM bridges)
              AND (SELECT terrain_type_id FROM terrain_types WHERE LOWER(name) IN ('río', 'rio', 'river') LIMIT 1) IS NOT NULL
        `);
        await client.query('DELETE FROM bridges');

        // 5. Buildings in fiefs
        await client.query('DELETE FROM fief_buildings');

        // 6. Reset territory metadata, preserve economic state (gold, food, resources, population)
        await client.query(`
            UPDATE territory_details SET
                custom_name          = NULL,
                discovered_resource  = NULL,
                exploration_end_turn = NULL,
                grace_turns          = 0,
                farm_level           = 0,
                mine_level           = 0,
                lumber_level         = 0,
                port_level           = 0,
                defense_level        = 0,
                division_id          = NULL
        `);

        // 6b. Delete political divisions (señoríos y otras divisiones)
        await client.query('DELETE FROM political_divisions');

        // 7. Release hex ownership
        await client.query('UPDATE h3_map SET player_id = NULL');

        // 8. Messages and notifications
        await client.query('DELETE FROM messages');
        await client.query('DELETE FROM notifications');

        // 9. Remove all characters, then AI bots
        await client.query('DELETE FROM characters');
        await client.query('DELETE FROM players WHERE is_ai = TRUE');

        // 10. Reset human players (keep accounts, reset game state)
        await client.query(`
            UPDATE players
            SET gold = 50000, capital_h3 = NULL,
                tax_percentage = 10.00, tithe_active = FALSE,
                is_initialized = FALSE
            WHERE is_ai = FALSE AND deleted = FALSE
        `);

        // 11. Reset world date and turn counter
        await client.query(`UPDATE world_state SET current_turn = 0, game_date = '0210-01-01 BC' WHERE id = 1`);

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { resetGame };
