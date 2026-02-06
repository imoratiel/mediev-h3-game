/**
 * Global game configuration
 */
const CONFIG = {
    exploration: {
        turns_required: 5,
        gold_cost: 100
    },
    infrastructure: {
        prod_multiplier_per_level: 0.20,
        upgrade_cost_gold_base: 100
    },
    buildings: {
        port_base_cost: 10000
    }
};

/**
 * Load game configuration from database
 * @param {Object} pool - PostgreSQL pool
 * @param {Function} logGameEvent - Function to log game events
 */
async function loadGameConfig(pool, logGameEvent) {
    try {
        const result = await pool.query('SELECT "group", "key", "value" FROM game_config');

        result.rows.forEach(row => {
            const { group, key, value } = row;

            if (!CONFIG[group]) {
                CONFIG[group] = {};
            }

            // Parse numeric values
            if (!isNaN(value)) {
                CONFIG[group][key] = Number(value);
            } else {
                CONFIG[group][key] = value;
            }
        });

        console.log('✓ Game configuration loaded:', CONFIG);
        if (logGameEvent) logGameEvent(`[CONFIG] Configuration loaded: ${JSON.stringify(CONFIG)}`);
        return CONFIG;
    } catch (error) {
        console.error('⚠️ Warning: Could not load game_config from database, using defaults:', error.message);
        return CONFIG;
    }
}

module.exports = {
    CONFIG,
    loadGameConfig
};
