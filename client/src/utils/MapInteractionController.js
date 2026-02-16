/**
 * MapInteractionController.js
 * Controlador de estados de interacción del mapa
 *
 * Gestiona los diferentes modos de interacción con el mapa (clicks, selección, etc.)
 * Evita sobrecargar MapViewer.vue con lógica de estados
 */

// Estados de interacción posibles
export const InteractionMode = {
  NORMAL: 'NORMAL',                     // Modo normal: click abre popup
  SELECT_DESTINATION: 'SELECT_DESTINATION'  // Modo selección: click mueve ejército
};

class MapInteractionController {
  constructor() {
    // Estado actual de interacción
    this.currentMode = InteractionMode.NORMAL;

    // Datos del contexto actual (ej: armyId que se está moviendo)
    this.contextData = null;

    // Callback para actualizar la UI (cambiar cursor, mostrar mensaje, etc.)
    this.onModeChange = null;
  }

  /**
   * Establece un nuevo modo de interacción
   * @param {string} mode - Modo del enum InteractionMode
   * @param {Object} data - Datos contextuales para el modo (opcional)
   */
  setMode(mode, data = null) {
    if (!Object.values(InteractionMode).includes(mode)) {
      console.error(`[MapInteraction] Modo inválido: ${mode}`);
      return;
    }

    console.log(`[MapInteraction] Cambiando modo: ${this.currentMode} → ${mode}`, data);

    this.currentMode = mode;
    this.contextData = data;

    // Notificar cambio de modo a la UI
    if (this.onModeChange) {
      this.onModeChange(mode, data);
    }
  }

  /**
   * Resetea al modo normal
   */
  resetMode() {
    this.setMode(InteractionMode.NORMAL, null);
  }

  /**
   * Obtiene el modo actual
   * @returns {string} - Modo actual
   */
  getMode() {
    return this.currentMode;
  }

  /**
   * Obtiene los datos del contexto actual
   * @returns {Object|null} - Datos contextuales
   */
  getContextData() {
    return this.contextData;
  }

  /**
   * Verifica si está en modo normal
   * @returns {boolean}
   */
  isNormalMode() {
    return this.currentMode === InteractionMode.NORMAL;
  }

  /**
   * Verifica si está en modo selección de destino
   * @returns {boolean}
   */
  isSelectingDestination() {
    return this.currentMode === InteractionMode.SELECT_DESTINATION;
  }

  /**
   * Maneja un click en el mapa según el modo actual
   * @param {string} h3Index - Índice H3 del hexágono clickeado
   * @param {Object} callbacks - Callbacks para cada modo
   * @param {Function} callbacks.onNormal - Callback para modo normal (abrir popup)
   * @param {Function} callbacks.onSelectDestination - Callback para selección de destino (mover ejército)
   */
  handleMapClick(h3Index, callbacks) {
    const { onNormal, onSelectDestination } = callbacks;

    switch (this.currentMode) {
      case InteractionMode.NORMAL:
        // Modo normal: abrir popup del hexágono
        if (onNormal) {
          onNormal(h3Index);
        }
        break;

      case InteractionMode.SELECT_DESTINATION:
        // Modo selección: procesar movimiento de ejército
        if (onSelectDestination && this.contextData) {
          const { armyId, armyName } = this.contextData;
          console.log(`[MapInteraction] Procesando movimiento de ejército ${armyName} (${armyId}) → ${h3Index}`);
          onSelectDestination(armyId, h3Index, armyName);
        }
        // Resetear al modo normal después de procesar
        this.resetMode();
        break;

      default:
        console.warn(`[MapInteraction] Modo no manejado: ${this.currentMode}`);
    }
  }

  /**
   * Inicia el proceso de movimiento de un ejército
   * @param {number} armyId - ID del ejército a mover
   * @param {string} armyName - Nombre del ejército (para feedback)
   */
  startArmyMovement(armyId, armyName, armyH3) {
    console.log(`[MapInteraction] Iniciando movimiento de ejército: ${armyName} (ID: ${armyId}) desde ${armyH3}`);
    this.setMode(InteractionMode.SELECT_DESTINATION, {
      armyId,
      armyName,
      armyH3
    });
  }

  /**
   * Cancela el proceso de selección actual
   */
  cancelSelection() {
    console.log(`[MapInteraction] Selección cancelada`);
    this.resetMode();
  }

  /**
   * Verifica si hay algún modo especial activo (no está en modo normal)
   * @returns {boolean} - true si hay interacción especial activa
   */
  isInteracting() {
    return this.currentMode !== InteractionMode.NORMAL;
  }

  /**
   * Registra un callback para cuando cambie el modo
   * @param {Function} callback - Función a ejecutar cuando cambie el modo (mode, data) => void
   */
  setOnModeChange(callback) {
    this.onModeChange = callback;
  }
}

// Exportar instancia singleton
export default new MapInteractionController();
