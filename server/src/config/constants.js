/**
 * CONFIGURACIÓN GLOBAL DEL MOTOR DE JUEGO (Hex-Engine)
 * Todos los valores de equilibrio (balancing) se centralizan aquí.
 */

const GAME_CONFIG = {
    // 🌍 Configuración del Mapa y Navegación
    MAP: {
        MAX_MOVEMENT_DISTANCE: 100,      // Máximo de hexágonos para seleccionar destino (radio)
        H3_RESOLUTION: 8,               // Resolución de celdas H3 usada en el sistema
    },

    // ⚔️ Atributos de Ejércitos y Unidades
    MILITARY: {
        STAMINA_RECOVERY_PER_TURN: 4,   // Recuperación de stamina si la tropa no se mueve
        STAMINA_MAX: 100,               // Valor máximo de stamina (techo)
        FORCE_REST_THRESHOLD: 25,       // % de stamina necesario para salir de 'force_rest'
        STAMINA_MIN_FOR_MOVE: 0.1,      // Stamina mínima para intentar el "Último Esfuerzo"
        STAMINA_COST_PER_HEX: 10,       // Coste de stamina por hexágono recorrido
        MAX_CELLS_PER_TURN: 4,          // Máximo de hexágonos que puede recorrer un ejército por turno
        FIEF_DETECTION_RANGE: 2,        // Hexágonos visibles desde cada feudo propio (niebla de guerra)
        // 🎖️ Experiencia de Combate
        COMBAT_XP_MULTIPLIER: 15,       // Multiplicador aplicado a la XP ganada por unidades tras combate
        // 🔭 Espionaje
        EXPLORE_COST: 100,              // Coste en provisiones del ejército para espionaje
        EXPLORE_COST_PLAYER: 1000,      // Coste en oro del jugador si el ejército no tiene provisiones
        UNIT_TYPE_EXPLORER: 'Explorador', // Nombre del tipo de unidad exploradora
    },

    // ⏱️ Sistema de Turnos y Recuperación
    TURNS: {
        RECOVERING_TURNS_PENALTY: 1,    // Cuántos turnos dura el estado 'recovering' tras esfuerzo extra
    },

    // 🏘️ Economía y Población
    ECONOMY: {
        MIN_FIEF_POPULATION: 200,       // Población mínima garantizada por feudo (reclutamiento y hambruna no pueden reducirla más)
    },

    // 🌾 Producción y Cosecha
    HARVEST: {
        FOOD_PRODUCTION_MULTIPLIER: 2.5,    // Balance test: multiplicador sobre producción agrícola de cosecha (restaurar a 1 para comportamiento normal)
        GOLD_PRODUCTION_MULTIPLIER: 100,   // Balance test: multiplicador sobre producción de oro en cosecha (restaurar a 1 para comportamiento normal)
        EMERGENCY_HARVEST_MIN: 2.0,       // Multiplicador mínimo de Cosecha Milagrosa (emergencia alimentaria)
        EMERGENCY_HARVEST_MAX: 4.0,       // Multiplicador máximo de Cosecha Milagrosa (exclusivo, rango [MIN, MAX))
    },

    // 🏰 Límite de Ejércitos por Jugador
    ARMY_LIMITS: {
        BASE: 2,            // Ejércitos garantizados sin importar los feudos
        FIEFS_PER_SLOT: 10, // Feudos adicionales necesarios para desbloquear cada ejército extra
    },

    // 👥 Límites de Población por Tipo de Terreno
    POPULATION: {
        CAP_CAPITAL:      6000,         // Capital del jugador
        CAP_PLAINS_COAST: 2000,         // Llanuras y costa (terrenos llanos productivos)
        CAP_DEFAULT:      1000,         // Resto de terrenos (montaña, pantano, bosque, etc.)
        // Fragmentos de terrain_types.name que califican como llanura/costa (comparación lowercase)
        PLAINS_COAST_TERRAINS: ['costa', 'llanura', 'llano', 'pradera', 'planicie', 'prado'],
    },
};

module.exports = GAME_CONFIG;