/**
 * CONFIGURACIÓN GLOBAL DEL MOTOR DE JUEGO (Hex-Engine)
 * Todos los valores de equilibrio (balancing) se centralizan aquí.
 */

const GAME_CONFIG = {
    // 🌍 Configuración del Mapa y Navegación
    MAP: {
        MAX_MOVEMENT_DISTANCE: 100,      // Rango máximo para elegir destino (hexágonos)
        H3_RESOLUTION: 8,               // Resolución de celdas H3 usada en el sistema
    },

    // ⚔️ Atributos de Ejércitos y Unidades
    MILITARY: {
        STAMINA_RECOVERY_PER_TURN: 4,   // Recuperación de stamina si la tropa no se mueve
        STAMINA_MAX: 100,               // Valor máximo de fatiga
        FORCE_REST_THRESHOLD: 25,       // % de stamina necesario para salir de 'force_rest'
        STAMINA_MIN_FOR_MOVE: 0.1,      // Stamina mínima para intentar el "Último Esfuerzo"
    },

    // ⏱️ Sistema de Turnos y Recuperación
    TURNS: {
        RECOVERING_TURNS_PENALTY: 1,    // Cuántos turnos dura el estado 'recovering' tras esfuerzo extra
    },
};

// Exportar para Node.js (CommonJS) o ESModules según tu setup
module.exports = GAME_CONFIG;