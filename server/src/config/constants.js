/**
 * CONFIGURACIÓN GLOBAL DEL MOTOR DE JUEGO (Hex-Engine)
 * Todos los valores de equilibrio (balancing) se centralizan aquí.
 */

const GAME_CONFIG = {
    // 🐛 Modo DEBUG — se desactiva automáticamente en producción
    DEBUG: {
        ENABLED:         process.env.NODE_ENV !== 'production',
        GOLD_MULTIPLIER: 100,    // Multiplicador de oro inicial cuando DEBUG está activo
    },


    // 🌍 Configuración del Mapa y Navegación
    MAP: {
        MAX_MOVEMENT_DISTANCE: 100,       // Máximo de hexágonos para seleccionar destino (radio)
        H3_RESOLUTION: 8,                 // Resolución de celdas H3 usada en el sistema
        BRIDGE_TERRAIN_TYPE_ID: 15,       // ID de tipo de terreno que representa un puente (paso entre islas)
    },

    // ⚔️ Atributos de Ejércitos y Unidades
    MILITARY: {
        STAMINA_RECOVERY_PER_TURN: 4,   // Recuperación de stamina si la tropa no se mueve
        STAMINA_MAX: 100,               // Valor máximo de stamina (techo)
        FORCE_REST_THRESHOLD: 25,       // % de stamina necesario para salir de 'force_rest'
        STAMINA_MIN_FOR_MOVE: 0.1,      // Stamina mínima para intentar el "Último Esfuerzo"
        STAMINA_COST_PER_HEX: 2,        // Coste de stamina por hexágono recorrido (× movement_cost del terreno)
FIEF_DETECTION_RANGE: 2,        // Hexágonos visibles desde cada feudo propio (niebla de guerra)
        // ⚔️ Sistema de resolución de combate
        COMBAT_K_NORM:        3,        // Constante de mitigación (escala unidad: def 3–9 vs K=3)
        COMBAT_DAMAGE_SCALE:  0.10,     // Factor global de bajas (0.10 → 4–8% en combate igualado)
        COMBAT_DRAW_THRESHOLD: 0.02,    // Diferencia mínima de presión para no ser empate (2%)
        COMBAT_DEFENDER_BONUS: 1.15,    // Multiplicador de defensa para el ejército defensor (+15%)
        // 😴 Cansancio post-batalla
        COMBAT_GREAT_BATTLE_RATIO:        1.5,  // ratio ≤ 1.5  → Gran Batalla (80% stamina perdida)
        COMBAT_MASSACRE_RATIO:           50,    // ratio ≥ 50   → Matanza (sin pérdida de stamina)
        COMBAT_GREAT_STAMINA_FLOOR:      20,    // stamina mínima tras Gran Batalla
        COMBAT_GREAT_RECOVERY_TURNS:      4,    // turnos para recuperación completa (Gran Batalla)
        COMBAT_SKIRMISH_STAMINA_LOSS:    20,    // pérdida stamina en batalla intermedia (1 turno)
        COMBAT_EARLY_MOVE_MORALE_PENALTY: 10,   // % moral perdida/turno por moverse en recuperación
        COMBAT_EARLY_MOVE_TROOP_PENALTY:   5,   // % tropas eliminadas/turno por moverse en recuperación
        // 🎖️ Experiencia de Combate
        COMBAT_XP_MULTIPLIER: 15,       // Multiplicador aplicado a la XP ganada por unidades tras combate
        // 🔭 Espionaje
        EXPLORE_COST: 100,              // Coste en provisiones del ejército para espionaje
        EXPLORE_COST_PLAYER: 1000,      // Coste en oro del jugador si el ejército no tiene provisiones
        UNIT_TYPE_EXPLORER: 'Explorador', // Nombre del tipo de unidad exploradora
        // 🏛️ Cultura por Templos (proceso mensual, día 1 de cada mes)
        CULTURE_TEMPLE_RINGS: [10, 7, 5, 4, 2], // bonus por ring 0→4 cada mes
        CULTURE_MAX: 100,               // Techo de cultura por tipo
    },

    // ⏱️ Sistema de Turnos y Recuperación
    TURNS: {
        RECOVERING_TURNS_PENALTY: 1,    // Cuántos turnos dura el estado 'recovering' tras esfuerzo extra
    },

    // 🏘️ Economía y Población
    ECONOMY: {
        MIN_FIEF_POPULATION: 200,       // Población mínima garantizada por feudo (reclutamiento y hambruna no pueden reducirla más)
        RECRUITMENT_NETWORK_RANGE: 10,  // Radio máximo (hexágonos BFS) de la red de suministro de reclutamiento
    },

    // 🌾 Producción y Cosecha
    HARVEST: {
        FOOD_PRODUCTION_MULTIPLIER: 1,      // Multiplicador sobre producción agrícola de cosecha
        GOLD_PRODUCTION_MULTIPLIER: 1,      // Multiplicador sobre producción de oro en cosecha
        EMERGENCY_HARVEST_MIN: 2.0,       // Multiplicador mínimo de Cosecha Milagrosa (emergencia alimentaria)
        EMERGENCY_HARVEST_MAX: 4.0,       // Multiplicador máximo de Cosecha Milagrosa (exclusivo, rango [MIN, MAX))
    },

    // 🏛️ Reglas de Construcción
    BUILDINGS: {
        EXCLUSION_RADIUS: 5,              // Radio (en hexágonos H3) dentro del cual no puede existir otro edificio del mismo tipo
        CONSERVATION_DECAY_PERCENT: 2,    // % de conservación que pierde cada edificio el día 5 de cada mes
    },

    // 🏛️ Señoríos y Divisiones Políticas
    DIVISIONS: {
        HAPPINESS_BONUS:         1.10,  // Multiplicador de felicidad para feudos en un señorío (+10%)
        MAX_RECRUITS_DIVISION:    400,  // Cap de reclutas por feudo cuando pertenece a un señorío
        MAX_RECRUITS_INDEPENDENT: 200,  // Cap de reclutas por feudo cuando es independiente
    },

    // 👑 Sistema de Personajes y Dinastías
    CHARACTERS: {
        GUARD_MAX:              25,   // Máximo de guardia personal
        GUARD_REGEN_PER_TURN:    1,   // Guardia recuperada por turno
        COMBAT_BUFF_BASE:       10,   // % de bono de combate (fijo)
        COMBAT_BUFF_PER_LEVEL:   0,   // % adicional por nivel > 1 (0 = buff plano)
        DEATH_AGE_THRESHOLD:    60,   // Edad a partir de la cual hay riesgo de muerte
        DEATH_CHANCE_PER_YEAR:   2,   // % de probabilidad de muerte por año sobre el umbral
        DEFAULT_ABILITIES: ['estrategia', 'logistica', 'diplomacia'],
        MOVEMENT_PER_TURN:       3,   // Hexágonos que avanza el personaje por turno
        DETECTION_RANGE:         2,   // Hexágonos visibles desde un personaje autónomo (niebla de guerra)
    },

    // ⚔️ Tropas iniciales por cultura (IDs según 049_unit_types_reset_data.sql)
    // Cada entrada: { unit_type_id, quantity }
    // El multiplicador ×2 para "Aleatorio" se aplica en playerInit.js.
    STARTING_TROOPS: {
        1: [ // Roma
            { unit_type_id:  1, quantity: 100 }, // Hastati
            { unit_type_id:  5, quantity:  50 }, // Velites
            { unit_type_id:  4, quantity:  50 }, // Auxilia (Cab)
        ],
        2: [ // Cartago
            { unit_type_id:  9, quantity: 100 }, // Infantería Libia
            { unit_type_id: 13, quantity:  50 }, // Honderos Baleares
            { unit_type_id: 11, quantity:  50 }, // Caballería Numida
        ],
        3: [ // Íberos
            { unit_type_id: 17, quantity: 100 }, // Caetrati
            { unit_type_id: 21, quantity:  50 }, // Falarica
            { unit_type_id: 19, quantity:  50 }, // Jin. Lanza
        ],
        4: [ // Celtas
            { unit_type_id: 25, quantity: 100 }, // Celtíberos
            { unit_type_id: 27, quantity:  50 }, // Cazadores
            { unit_type_id: 29, quantity:  50 }, // Cab. de Exploración
        ],
    },

    // 🏰 Límite de Ejércitos por Jugador
    // Regla: max(BASE, floor(feudos / RATIO))
    // Ej: 0 feudos → 1 ejército, 3 → 1, 6 → 2, 30 → 10, 170 → 56
    ARMY_LIMITS: {
        BASE:  1,  // Mínimo garantizado (aunque no tengas feudos)
        RATIO: 3,  // Un slot de ejército por cada 3 feudos
    },

    // ⛵ Límite de Flotas Navales por Jugador
    // Regla: max(BASE, floor(feudos / RATIO))
    // Ej: 0 feudos → 1 flota, 20 → 1, 60 → 3, 200 → 10, 500 → 25
    FLEET_LIMITS: {
        BASE:  1,   // Mínimo garantizado
        RATIO: 20,  // Un slot de flota por cada 20 feudos
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