const fs = require('fs');
const path = require('path');

const ECONOMY_LOG_FILE = path.join(__dirname, '..', '..', 'logs', 'economy.log');

/**
 * Log economy events to logs/economy.log file
 * @param {number} turnNumber - Current turn number
 * @param {string} eventType - Type of economic event (WOOD_REGEN, MINING, DEPLETION, STARVATION)
 * @param {string} details - Details about the event
 */
function logEconomyEvent(turnNumber, eventType, details) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [TURN ${turnNumber}] [${eventType}] ${details}\n`;

    try {
        fs.appendFileSync(ECONOMY_LOG_FILE, logEntry, 'utf8');
    } catch (error) {
        console.error('Error writing to economy log file:', error);
    }
}

/**
 * Calculate resource production for a territory based on infrastructure levels
 * @param {Object} territory - Territory data
 * @param {Object} config - Game configuration
 * @returns {Object} Produced resources
 */
// [DEAD_CODE] TODO: Sin referencias de uso en el proyecto; revisar y eliminar si no se reutiliza.
function calculateProduction(territory, config) {
    const prodMultiplier = config.infrastructure.prod_multiplier_per_level;

    const BASE_PRODUCTION = {
        wood: 50,
        stone: 30,
        iron: 20,
        gold: 5,
        food: 100
    };

    const {
        discovered_resource, farm_level, mine_level, lumber_level,
        wood_output, food_output
    } = territory;

    let woodProduced = 0, stoneProduced = 0, ironProduced = 0, goldProduced = 0, foodProduced = 0;

    if (wood_output > 0 && lumber_level > 0) {
        woodProduced = BASE_PRODUCTION.wood * (1 + (lumber_level * prodMultiplier));
    }

    if (discovered_resource && discovered_resource !== 'none' && mine_level > 0) {
        if (discovered_resource === 'stone') {
            stoneProduced = BASE_PRODUCTION.stone * (1 + (mine_level * prodMultiplier));
        } else if (discovered_resource === 'iron') {
            ironProduced = BASE_PRODUCTION.iron * (1 + (mine_level * prodMultiplier));
        } else if (discovered_resource === 'gold') {
            goldProduced = BASE_PRODUCTION.gold * (1 + (mine_level * prodMultiplier));
        }
    }

    if (food_output > 0 && farm_level > 0) {
        foodProduced = BASE_PRODUCTION.food * (1 + (farm_level * prodMultiplier));
    }

    return {
        woodProduced,
        stoneProduced,
        ironProduced,
        goldProduced,
        foodProduced
    };
}

/**
 * Calculate food consumption based on population
 * @param {number} population - Current population
 * @returns {number} Food consumption
 */
// [DEAD_CODE] TODO: Sin referencias de uso en el proyecto; revisar y eliminar si no se reutiliza.
function calculateFoodConsumption(population) {
    return Math.floor(population / 100.0) * 0.01;
}

module.exports = {
    logEconomyEvent,
    calculateProduction,
    calculateFoodConsumption
};
