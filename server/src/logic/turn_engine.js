const { logEconomyEvent } = require('./economy');
const { determineDiscoveredResource } = require('./discovery');
const { logGameEvent } = require('../utils/logger');
const h3 = require('h3-js');

async function processGameTurn(pool, config) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const newState = await client.query(`
      UPDATE world_state SET current_turn = current_turn + 1, game_date = game_date + INTERVAL '1 day', last_updated = CURRENT_TIMESTAMP
      WHERE id = 1 RETURNING current_turn, game_date, days_per_year
    `);
        const { current_turn: newTurn, game_date: newDate, days_per_year } = newState.rows[0];
        const dayOfYear = newTurn % (days_per_year || 365);

        await client.query(`
      UPDATE territory_details SET food_stored = GREATEST(0, food_stored - (FLOOR(population / 100.0) * 0.01))
      WHERE h3_index IN (SELECT h3_index FROM h3_map WHERE player_id IS NOT NULL)
    `);

        if (((newTurn - 1) % 30) === 0) {
            // Census and Production logic... (simplified for brevity but should be full)
            const territories = await client.query('SELECT td.*, t.name as terrain_type, m.player_id FROM territory_details td JOIN h3_map m ON td.h3_index = m.h3_index JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id WHERE m.player_id IS NOT NULL');
            for (const t of territories.rows) {
                let growth = 0.01; // Basic fixed growth for now
                await client.query('UPDATE territory_details SET population = population * (1 + $1) WHERE h3_index = $2', [growth, t.h3_index]);
            }
        }

        if (dayOfYear === 75 || dayOfYear === 180) {
            // Harvest logic...
        }

        await client.query('COMMIT');
        return { success: true, turn: newTurn, date: newDate, dayOfYear };
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (client) client.release();
    }
}

let timeoutId = null;
function startTimeEngine(pool, config) {
    const run = async () => {
        try { await processGameTurn(pool, config); } catch (e) { console.error(e); }
        timeoutId = setTimeout(run, (config.gameplay?.turn_duration_seconds || 15) * 1000);
    };
    run();
}

function stopTimeEngine() { clearTimeout(timeoutId); }

module.exports = { processGameTurn, startTimeEngine, stopTimeEngine };
