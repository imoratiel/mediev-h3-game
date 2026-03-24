/**
 * Culture-specific nautical fleet names.
 * Each list contains historically inspired names relevant to that culture's
 * maritime traditions and mythology.
 */
const FLEET_NAMES_BY_CULTURE = {
    1: [ // Romanos — dioses del mar, virtudes militares, nombres de trirremes famosos
        'Neptunia', 'Tritonia', 'Aquila', 'Victoria Maris', 'Delfinus',
        'Fidelis', 'Invicta', 'Fortis', 'Audax', 'Fulmen',
        'Tridens', 'Maris Stella', 'Thetis', 'Amphitrite', 'Aeolus',
        'Gloriosa', 'Aeterna', 'Draconis', 'Poseidon', 'Oceanus',
        'Classis Prima', 'Legio Maris', 'Rostrum', 'Corvus',
        'Navis Longa', 'Ira Neptuni', 'Fulgur', 'Libertas',
    ],
    2: [ // Cartagineses — dioses púnicos, almirantes, ciudades fenicas
        'Hannón', 'Amílcar', 'Magón', 'Asdrúbal', 'Bostar',
        'Tanit', 'Melqart', 'Eshmún', 'Baal Hammon', 'Astarte',
        'Gaulos', 'Hippus', 'Furia de Tanit', 'Ira de Melqart',
        'Espada de Baal', 'Sombra de Cartago', 'Gadir',
        'Mahón', 'Qart-Hadast', 'Mar de Fenicia',
        'Brazo de Melqart', 'Cetro de Hannón', 'Lanza de Baal',
    ],
    3: [ // Íberos — ríos, divinidades y tribus costeras ibéricas
        'Iberus', 'Anas', 'Tagus', 'Tader', 'Sucro',
        'Ataecina', 'Neton', 'Endovelico', 'Brigantia',
        'Turdetania', 'Contestania', 'Edetania', 'Oretania',
        'Vela del Iberus', 'Remos de Gadir', 'Flecha de Ataecina',
        'Galeón Celtíbero', 'Falcata del Mar', 'Lanza Turdetana',
        'Trueno de Neton', 'Mar Íbero', 'Costa de Levante',
    ],
    4: [ // Celtas — deidades del mar céltico, términos gaélicos
        'Manannán', 'Lugh Mara', 'Boann', 'Lir', 'Bran',
        'Tonn Tuile', 'Sruth Mara', 'Draoi Farraige',
        'Danu', 'Nechtan', 'Morrigan Mara', 'Ériu',
        'Sionnach Mara', 'Taibhse Tonn', 'Cú Mara',
        'Coracle de Brigid', 'Espíritu del Atlántico',
        'Grito de Lir', 'Ola de Danu', 'Niebla del Norte',
    ],
};

const DEFAULT_NAMES = [
    'Flota del Mar', 'Viento del Norte', 'Marea Alta',
    'Horizonte', 'Tempestad', 'Vigía',
];

/**
 * Generate a unique fleet name for a player based on their culture.
 * Picks a random name from the culture list and appends a Roman numeral
 * suffix if the player already has a fleet with that base name.
 *
 * @param {object} client  - pg client (for transaction)
 * @param {number} player_id
 * @param {number} culture_id
 * @returns {Promise<string>}
 */
async function generateFleetName(client, player_id, culture_id) {
    const pool_or_client = client;
    const nameList = FLEET_NAMES_BY_CULTURE[culture_id] || DEFAULT_NAMES;

    // Fetch existing fleet names for this player
    const existingRes = await pool_or_client.query(
        `SELECT name FROM armies WHERE player_id = $1 AND is_naval = TRUE`,
        [player_id]
    );
    const existingNames = new Set(existingRes.rows.map(r => r.name));

    // Shuffle and try each candidate
    const shuffled = [...nameList].sort(() => Math.random() - 0.5);

    for (const base of shuffled) {
        if (!existingNames.has(base)) return base;

        // Try Roman numeral suffixes II–X
        const numerals = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
        for (const num of numerals) {
            const candidate = `${base} ${num}`;
            if (!existingNames.has(candidate)) return candidate;
        }
    }

    // Last resort
    return `Flota ${Date.now()}`;
}

module.exports = { generateFleetName };