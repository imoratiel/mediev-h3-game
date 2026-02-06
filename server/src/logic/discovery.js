/**
 * Determine resource discovery based on terrain and a random roll
 * @param {string} terrainName - Name of the terrain
 * @returns {string} Discovered resource ('gold', 'iron', 'stone', or 'none')
 */
function determineDiscoveredResource(terrainName) {
    if (terrainName === 'Mountains' || terrainName === 'Hills') {
        const roll = Math.random();

        if (roll < 0.02) return 'gold';
        if (roll < 0.05) return 'iron';
        if (roll < 0.25) return 'stone';
    }

    return 'none';
}

module.exports = {
    determineDiscoveredResource
};
