/**
 * RouteVisualizer.js
 * Módulo independiente para visualizar rutas de ejércitos en el mapa.
 *
 * Responsabilidad única: dibujar/limpiar líneas de ruta sobre Leaflet.
 * No contiene lógica de cálculo A* ni de estado del juego.
 *
 * Uso:
 *   import RouteVisualizer from '@/utils/RouteVisualizer.js';
 *   RouteVisualizer.init(map);                            // una vez al montar el mapa
 *   RouteVisualizer.drawPath(armyId, h3Path, currentH3); // cuando se recibe una ruta
 *   RouteVisualizer.clear();                              // para limpiar todo
 *
 * Visualización en dos segmentos:
 *   - Naranja sólido  → casillas del TURNO ACTUAL (primeras MAX_CELLS_PER_TURN)
 *   - Gris discontinuo → casillas de TURNOS FUTUROS (resto de la ruta)
 */

import L from 'leaflet';
import { cellToLatLng } from 'h3-js';

// Máximo de casillas que recorre un ejército por turno (debe coincidir con backend)
const MAX_CELLS_PER_TURN = 4;

// Segmento del turno actual: negro sólido
const ROUTE_STYLE_CURRENT = {
  color: '#000000',
  weight: 3,
  opacity: 0.9,
  dashArray: '5, 8',
  pane: 'routePane'
};

// Segmento de turnos futuros: negro tenue y fino
const ROUTE_STYLE_FUTURE = {
  color: '#000000',
  weight: 2,
  opacity: 0.35,
  dashArray: '4, 10',
  pane: 'routePane'
};

class RouteVisualizer {
  constructor() {
    /** @type {L.LayerGroup|null} Capa Leaflet que contiene todas las polylines */
    this._routeLayer = null;

    /**
     * armyId → { current: L.Polyline|null, future: L.Polyline|null }
     * @type {Map<number|string, {current: L.Polyline|null, future: L.Polyline|null}>}
     */
    this._armyPolylines = new Map();
  }

  /**
   * Inicializa el visualizador con la instancia del mapa.
   * Crea un pane dedicado y registra la capa de rutas.
   * Debe llamarse UNA VEZ después de crear el mapa.
   *
   * @param {L.Map} map - Instancia del mapa Leaflet
   */
  init(map) {
    if (this._routeLayer) {
      // Ya inicializado (hot-reload en dev)
      return;
    }

    // Crear pane dedicado con z-index entre el mapa base y las tropas
    if (!map.getPane('routePane')) {
      map.createPane('routePane');
      const pane = map.getPane('routePane');
      pane.style.zIndex = 600;          // entre starPane(650) y territoryPane(400)
      pane.style.pointerEvents = 'none'; // las líneas no deben interceptar clics en hexágonos
    }

    // L.layerGroup NO propaga pane a sus hijos — el pane va en cada L.polyline (via ROUTE_STYLE_*)
    this._routeLayer = L.layerGroup().addTo(map);
    console.log('[RouteVisualizer] Inicializado');
  }

  /**
   * Dibuja (o actualiza) la ruta de un ejército en el mapa.
   * Divide la ruta en dos segmentos visuales:
   *   - Segmento actual (primeras MAX_CELLS_PER_TURN casillas): naranja
   *   - Segmento futuro (resto): gris tenue
   * Si ya existía una ruta para ese ejército, se elimina antes de dibujar la nueva.
   *
   * @param {number|string} armyId   - ID del ejército
   * @param {string[]}      h3Path   - Array de índices H3 que forman la ruta (sin la posición actual)
   * @param {string}        currentH3 - Índice H3 de la posición actual del ejército
   */
  drawPath(armyId, h3Path, currentH3) {
    if (!this._routeLayer) {
      console.warn('[RouteVisualizer] No inicializado — llama a init(map) primero');
      return;
    }

    // Eliminar líneas existentes para este ejército
    this._clearArmy(armyId);

    if (!h3Path || h3Path.length === 0 || !currentH3) {
      return;
    }

    // ── Segmento ACTUAL: posición actual + primeras MAX_CELLS_PER_TURN casillas ──
    const currentSegmentHexes = [currentH3, ...h3Path.slice(0, MAX_CELLS_PER_TURN)];
    const currentCoords = currentSegmentHexes.map(hex => cellToLatLng(hex));
    const currentPolyline = L.polyline(currentCoords, ROUTE_STYLE_CURRENT);
    this._routeLayer.addLayer(currentPolyline);

    // ── Segmento FUTURO: desde la casilla MAX_CELLS_PER_TURN en adelante ────────
    let futurePolyline = null;
    if (h3Path.length > MAX_CELLS_PER_TURN) {
      // El segmento futuro arranca donde termina el actual para que haya continuidad visual
      const futureSegmentHexes = h3Path.slice(MAX_CELLS_PER_TURN - 1);
      const futureCoords = futureSegmentHexes.map(hex => cellToLatLng(hex));
      futurePolyline = L.polyline(futureCoords, ROUTE_STYLE_FUTURE);
      this._routeLayer.addLayer(futurePolyline);
    }

    this._armyPolylines.set(armyId, { current: currentPolyline, future: futurePolyline });

    console.log(
      `[RouteVisualizer] Ejército ${armyId}: ${currentSegmentHexes.length - 1} casillas este turno` +
      (futurePolyline ? `, ${h3Path.length - MAX_CELLS_PER_TURN} casillas en turnos futuros` : '')
    );
  }

  /**
   * Elimina las líneas de ruta de un ejército específico.
   * @param {number|string} armyId - ID del ejército
   */
  _clearArmy(armyId) {
    const existing = this._armyPolylines.get(armyId);
    if (existing && this._routeLayer) {
      if (existing.current) this._routeLayer.removeLayer(existing.current);
      if (existing.future)  this._routeLayer.removeLayer(existing.future);
      this._armyPolylines.delete(armyId);
    }
  }

  /**
   * Elimina la línea de ruta de un ejército específico (API pública).
   * Se usa cuando el ejército cancela su movimiento.
   *
   * @param {number|string} armyId - ID del ejército
   */
  clearArmy(armyId) {
    this._clearArmy(armyId);
  }

  /**
   * Elimina TODAS las líneas de ruta del mapa.
   * Útil antes de un re-fetch completo de rutas.
   */
  clear() {
    if (this._routeLayer) {
      this._routeLayer.clearLayers();
    }
    this._armyPolylines.clear();
  }
}

// Exportar singleton — una instancia compartida por toda la app
export default new RouteVisualizer();
