/**
 * Calculate the cost for upgrading a building
 * @param {string} buildingType - Type of building
 * @param {number} currentLevel - Current level of building
 * @param {Object} config - Game configuration
 * @returns {number} Upgrade cost
 */
function calculateUpgradeCost(buildingType, currentLevel, config) {
    let baseCost;
    if (buildingType === 'port') {
        baseCost = config.buildings?.port_base_cost || 10000;
    } else {
        baseCost = config.infrastructure.upgrade_cost_gold_base;
    }

    return baseCost * Math.pow(2, currentLevel);
}

/**
 * Validate if a building can be upgraded in a specific territory
 * @param {string} buildingType - Type of building
 * @param {Object} territory - Territory details
 * @returns {string|null} Error message or null if valid
 */
function validateUpgrade(buildingType, territory) {
    if (buildingType === 'farm') {
        if (!territory.food_output || territory.food_output <= 0) {
            return 'Este terreno no es apto para granjas. No tiene producción de alimentos.';
        }
    } else if (buildingType === 'lumber') {
        if (!territory.wood_output || territory.wood_output <= 0) {
            return 'No hay bosques en esta casilla. El aserradero requiere terreno forestal.';
        }
    } else if (buildingType === 'mine') {
        if (!territory.discovered_resource || territory.discovered_resource === 'none') {
            return 'No se han descubierto recursos mineros en este territorio. Debes explorarlo primero.';
        }
    } else if (buildingType === 'port') {
        if (!territory.is_coast && territory.terrain_type !== 'Coast') {
            return 'Los puertos solo pueden construirse en territorios costeros.';
        }
    }

    return null;
}

module.exports = {
    calculateUpgradeCost,
    validateUpgrade
};
