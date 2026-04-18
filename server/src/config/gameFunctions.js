/**
 * Funciones derivadas de GAME_CONFIG.
 * Cálculos que dependen de las constantes de balanceo pero no son constantes en sí.
 */
const GAME_CONFIG = require('./constants.js');

/**
 * Calcula el límite máximo de población de un feudo.
 * @param {string}  terrainName - Valor de terrain_types.name
 * @param {boolean} isCapital   - true si este hex es la capital del jugador
 * @returns {number} Límite de población (hard cap)
 */
function getPopulationCap(terrainName, isCapital) {
    if (isCapital) return GAME_CONFIG.POPULATION.CAP_CAPITAL;
    const t = (terrainName || '').toLowerCase();
    const { PLAINS_COAST_TERRAINS, CAP_PLAINS_COAST, CAP_DEFAULT } = GAME_CONFIG.POPULATION;
    return PLAINS_COAST_TERRAINS.some(n => t.includes(n)) ? CAP_PLAINS_COAST : CAP_DEFAULT;
}

/**
 * Calcula el límite máximo de ejércitos de un jugador.
 * @param {number} numFiefs - Número de feudos que posee el jugador
 * @returns {number} Límite de ejércitos
 */
function getArmyLimit(numFiefs) {
    const { BASE, RATIO } = GAME_CONFIG.ARMY_LIMITS;
    return Math.max(BASE, Math.floor((numFiefs || 0) / RATIO));
}

/**
 * Calcula el límite máximo de flotas navales de un jugador.
 * Usa FLEET_LIMITS (RATIO 20) — más restrictivo que ejércitos terrestres.
 * @param {number} numFiefs - Número de feudos que posee el jugador
 * @returns {number} Límite de flotas
 */
function getFleetLimit(numFiefs) {
    const { BASE, RATIO } = GAME_CONFIG.FLEET_LIMITS;
    return Math.max(BASE, Math.floor((numFiefs || 0) / RATIO));
}

/**
 * Genera valores económicos aleatorios para un feudo recién colonizado.
 * Usa los multiplicadores de GAME_CONFIG.ECONOMY para consistencia con resetGame y populate_economy.
 * @param {'capital'|'fief'} type - 'capital' para la capital del jugador, 'fief' para el resto
 * @returns {{ population, happiness, food, wood, stone, gold }}
 */
function generateFiefEconomy(type = 'fief') {
    const { RESOURCE_MULTIPLIER: rm, POPULATION_MULTIPLIER: pm } = GAME_CONFIG.ECONOMY;
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    if (type === 'capital') {
        return {
            population: rand(400 * pm, 600 * pm),
            happiness:  rand(60, 80),
            food:       rand(1000 * rm, 3000 * rm),
            wood:       rand(500,  2500),
            stone:      rand(500,  2500),
            gold:       rand(300 * rm, 800 * rm),
        };
    }
    return {
        population: rand(200 * pm, 400 * pm),
        happiness:  rand(50, 70),
        food:       rand(0, 2000 * rm),
        wood:       rand(0, 2000),
        stone:      rand(0, 2000),
        gold:       rand(50 * rm, 250 * rm),
    };
}

module.exports = { getPopulationCap, getArmyLimit, getFleetLimit, generateFiefEconomy };
