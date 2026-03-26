/**
 * ArmySimulationService.js
 * Servicio independiente para manejar la lógica de fatiga y recuperación de ejércitos
 *
 * REGLAS DE NEGOCIO:
 * - Stamina: Cada unidad tiene stamina individual (0-100)
 * - Consumo: El movimiento consume stamina según el terreno
 * - Force Rest: Si stamina llega a 0, la unidad se marca como force_rest = TRUE
 * - Recuperación: +4 stamina por turno cuando el ejército no se mueve
 * - Liberación: Si stamina >= 25 y force_rest = TRUE, se libera (force_rest = FALSE)
 */

const config = require('../config/constants.js');
const pool = require('../../db');
const { Logger } = require('../../src/utils/logger');
const h3 = require('h3-js');
const { auditEvent, TOPICS } = require('../infrastructure/kafkaFacade');

class ArmySimulationService {
  /**
   * Método auxiliar interno para consumir stamina con un client específico
   * @private
   */
  static async _consumeStaminaWithClient(client, armyId, terrainMovementCost) {
    // Obtener todas las unidades del ejército
    const troopsResult = await client.query(
      `SELECT troop_id, unit_type_id, quantity, stamina, force_rest
       FROM troops
       WHERE army_id = $1`,
      [armyId]
    );

    if (troopsResult.rows.length === 0) {
      Logger.army(armyId, 'ERROR', 'Ejército no tiene unidades');
      return {
        success: false,
        message: `Ejército no tiene unidades`,
        exhaustedUnits: 0
      };
    }

    // Calcular stamina mínima antes del consumo
    const minStaminaBefore = Math.min(...troopsResult.rows.map(t => t.stamina));

    let exhaustedCount = 0;
    let collapseCount = 0;

    // Actualizar stamina de cada unidad
    for (const troop of troopsResult.rows) {
      const newStamina = Math.max(0, troop.stamina - terrainMovementCost);
      const willBeExhausted = newStamina <= 0;

      await client.query(
        `UPDATE troops
         SET stamina = $1,
             force_rest = CASE WHEN $2 <= 0 THEN TRUE ELSE force_rest END
         WHERE troop_id = $3`,
        [newStamina, newStamina, troop.troop_id]
      );

      if (willBeExhausted && !troop.force_rest) {
        exhaustedCount++;
        collapseCount++;

        // Log individual de colapso por fatiga
        Logger.army(armyId, 'FATIGUE_COLLAPSE',
          `Troop ${troop.troop_id} (unit_type: ${troop.unit_type_id}) ¡Esfuerzo extra detectado! force_rest activado y stamina a 0`,
          { troop_id: troop.troop_id, unit_type_id: troop.unit_type_id, previous_stamina: troop.stamina }
        );
      }
    }

    // Calcular stamina mínima después del consumo
    const minStaminaAfter = Math.min(...troopsResult.rows.map(t => Math.max(0, t.stamina - terrainMovementCost)));

    // Log del consumo de stamina
    Logger.army(armyId, 'STAMINA_DECREASE',
      `Consumo de ${terrainMovementCost} puntos. Stamina mínima: ${minStaminaBefore} → ${minStaminaAfter}`,
      {
        cost: terrainMovementCost,
        min_stamina_before: minStaminaBefore,
        min_stamina_after: minStaminaAfter,
        exhausted_units: exhaustedCount,
        total_troops: troopsResult.rows.length
      }
    );

    return {
      success: true,
      exhaustedUnits: exhaustedCount
    };
  }

  /**
   * Consume stamina de todas las unidades de un ejército
   * @param {number} armyId - ID del ejército
   * @param {number} terrainMovementCost - Coste de movimiento del terreno (ej: 5, 10, 15)
   * @returns {Promise<Object>} - { success: boolean, message: string, exhaustedUnits?: number }
   */
  static async consumeStamina(armyId, terrainMovementCost) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Validar que el ejército existe
      const armyCheck = await client.query(
        'SELECT army_id, name FROM armies WHERE army_id = $1',
        [armyId]
      );

      if (armyCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'ERROR', 'Ejército no encontrado en BD');
        return {
          success: false,
          message: `Ejército ${armyId} no encontrado`
        };
      }

      const armyName = armyCheck.rows[0].name;

      // Delegar la lógica al helper interno
      const result = await this._consumeStaminaWithClient(client, armyId, terrainMovementCost);

      if (!result.success) {
        await client.query('ROLLBACK');
        return result;
      }

      await client.query('COMMIT');

      Logger.army(armyId, 'STAMINA_MANUAL_CONSUME',
        `Consumo manual de stamina. Coste: ${terrainMovementCost}. Unidades agotadas: ${result.exhaustedUnits}`,
        { army_name: armyName, cost: terrainMovementCost, exhausted_units: result.exhaustedUnits }
      );

      return {
        success: true,
        message: result.exhaustedUnits > 0
          ? `${result.exhaustedUnits} unidad(es) agotada(s) - Descanso forzado activado`
          : 'Stamina consumida correctamente',
        exhaustedUnits: result.exhaustedUnits
      };

    } catch (error) {
      await client.query('ROLLBACK');
      Logger.army(armyId, 'ERROR', `Error consumiendo stamina: ${error.message}`, { error: error.stack });
      Logger.error(error, { context: 'ArmySimulationService.consumeStamina', armyId });
      return {
        success: false,
        message: 'Error al consumir stamina del ejército',
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  /**
   * Procesa la recuperación pasiva de stamina de todas las unidades de un ejército
   * Recupera +4 stamina por turno (máximo 100)
   * Libera unidades de force_rest si stamina >= 25
   *
   * @param {number} armyId - ID del ejército
   * @returns {Promise<Object>} - { success: boolean, message: string, releasedUnits?: number }
   */
  static async processPassiveRecovery(armyId) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Validar que el ejército existe
      const armyCheck = await client.query(
        'SELECT army_id, name, battle_recovery_rate, battle_recovery_turns_left FROM armies WHERE army_id = $1',
        [armyId]
      );

      if (armyCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'ERROR', 'Ejército no encontrado');
        return {
          success: false,
          message: `Ejército ${armyId} no encontrado`
        };
      }

      const { name: armyName, battle_recovery_rate, battle_recovery_turns_left } = armyCheck.rows[0];

      // Obtener todas las unidades del ejército
      const troopsResult = await client.query(
        `SELECT troop_id, stamina, force_rest
         FROM troops
         WHERE army_id = $1`,
        [armyId]
      );

      if (troopsResult.rows.length === 0) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'ERROR', 'Ejército no tiene unidades');
        return {
          success: false,
          message: `Ejército ${armyName} no tiene unidades`
        };
      }

      let releasedCount = 0;
      const MAX_STAMINA      = config.MILITARY.STAMINA_MAX;
      const RELEASE_THRESHOLD = config.MILITARY.FORCE_REST_THRESHOLD;

      // Usar tasa de recuperación rápida post-batalla si está activa; si no, la normal
      const turnsLeft   = parseInt(battle_recovery_turns_left) || 0;
      const RECOVERY_RATE = turnsLeft > 0
        ? parseFloat(battle_recovery_rate) || config.MILITARY.STAMINA_RECOVERY_PER_TURN
        : config.MILITARY.STAMINA_RECOVERY_PER_TURN;

      const minStaminaBefore = Math.min(...troopsResult.rows.map(t => parseFloat(t.stamina)));
      const unitsInForceRest = troopsResult.rows.filter(t => t.force_rest).length;

      // Procesar recuperación de cada unidad
      for (const troop of troopsResult.rows) {
        // CRÍTICO: parseFloat evita concatenación de strings ("0.00" + 4 = "0.004" en lugar de 4)
        const currentStamina = parseFloat(troop.stamina);
        const newStamina = Math.min(MAX_STAMINA, currentStamina + RECOVERY_RATE);
        const shouldRelease = troop.force_rest && newStamina >= RELEASE_THRESHOLD;

        Logger.army(armyId, 'STAMINA_TICK',
          `Troop ${troop.troop_id} | Actual: ${currentStamina} | Nueva: ${newStamina} | ForceRest: ${troop.force_rest} | Liberar: ${shouldRelease}`,
          { troop_id: troop.troop_id, stamina_before: currentStamina, stamina_after: newStamina, force_rest: troop.force_rest, will_release: shouldRelease }
        );

        await client.query(
          `UPDATE troops
           SET stamina = $1,
               force_rest = CASE WHEN force_rest = TRUE AND $2::numeric >= $3::numeric THEN FALSE ELSE force_rest END
           WHERE troop_id = $4`,
          [newStamina, newStamina, RELEASE_THRESHOLD, troop.troop_id]
        );

        if (shouldRelease) {
          releasedCount++;
          Logger.army(armyId, 'UNIT_RELEASED',
            `Troop ${troop.troop_id} liberado de force_rest (stamina: ${currentStamina} → ${newStamina})`,
            { troop_id: troop.troop_id, stamina_before: currentStamina, stamina_after: newStamina }
          );
        }
      }

      // Decrementar contador de recuperación rápida
      if (turnsLeft > 0) {
        await client.query(
          `UPDATE armies
           SET battle_recovery_turns_left = GREATEST(0, battle_recovery_turns_left - 1),
               battle_recovery_rate = CASE WHEN battle_recovery_turns_left <= 1 THEN 0 ELSE battle_recovery_rate END
           WHERE army_id = $1`,
          [armyId]
        );
      }

      const minStaminaAfter = Math.min(MAX_STAMINA, minStaminaBefore + RECOVERY_RATE);

      await client.query('COMMIT');

      const recoveryLabel = turnsLeft > 0 ? `rápida (batalla, ${turnsLeft} turnos restantes)` : 'normal';
      Logger.army(armyId, 'STAMINA_RECOVERY',
        `+${RECOVERY_RATE} pts (${recoveryLabel}). Stamina mínima: ${minStaminaBefore} → ${minStaminaAfter}. Force_rest: ${unitsInForceRest - releasedCount}/${unitsInForceRest} unidades`,
        {
          army_name: armyName,
          recovery_rate: RECOVERY_RATE,
          battle_recovery_turns_left: turnsLeft,
          min_stamina_before: minStaminaBefore,
          min_stamina_after: minStaminaAfter,
          units_released: releasedCount,
        }
      );

      return {
        success: true,
        message: releasedCount > 0
          ? `Recuperación completada. ${releasedCount} unidad(es) lista(s) para moverse`
          : 'Recuperación completada',
        releasedUnits: releasedCount
      };

    } catch (error) {
      await client.query('ROLLBACK');
      Logger.army(armyId, 'ERROR', `Error procesando recuperación: ${error.message}`, { error: error.stack });
      Logger.error(error, { context: 'ArmySimulationService.processPassiveRecovery', armyId });
      return {
        success: false,
        message: 'Error al procesar recuperación del ejército',
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  /**
   * Obtiene el estado de fatiga de un ejército (eslabón más débil)
   * @param {number} armyId - ID del ejército
   * @returns {Promise<Object>} - { minStamina, hasForceRest, totalUnits, exhaustedUnits }
   */
  static async getArmyFatigueStatus(armyId) {
    try {
      const result = await pool.query(
        `SELECT
          MIN(stamina) as min_stamina,
          COUNT(*) as total_units,
          SUM(CASE WHEN force_rest = TRUE THEN 1 ELSE 0 END) as exhausted_units,
          BOOL_OR(force_rest) as has_force_rest
         FROM troops
         WHERE army_id = $1`,
        [armyId]
      );

      if (result.rows.length === 0 || result.rows[0].total_units === null) {
        Logger.army(armyId, 'STATUS_QUERY', 'Ejército no tiene unidades');
        return {
          success: false,
          message: 'Ejército no tiene unidades'
        };
      }

      const status = result.rows[0];

      Logger.army(armyId, 'STATUS_QUERY',
        `Consulta de estado - Stamina mín: ${status.min_stamina}, Force_rest: ${status.exhausted_units}/${status.total_units}`,
        {
          min_stamina: parseFloat(status.min_stamina) || 0,
          has_force_rest: status.has_force_rest || false,
          total_units: parseInt(status.total_units) || 0,
          exhausted_units: parseInt(status.exhausted_units) || 0
        }
      );

      return {
        success: true,
        minStamina: parseFloat(status.min_stamina) || 0,
        hasForceRest: status.has_force_rest || false,
        totalUnits: parseInt(status.total_units) || 0,
        exhaustedUnits: parseInt(status.exhausted_units) || 0
      };

    } catch (error) {
      Logger.army(armyId, 'ERROR', `Error obteniendo estado de fatiga: ${error.message}`, { error: error.stack });
      Logger.error(error, { context: 'ArmySimulationService.getArmyFatigueStatus', armyId });
      return {
        success: false,
        message: 'Error al obtener estado de fatiga',
        error: error.message
      };
    }
  }

  /**
   * Verifica si un ejército puede moverse (no tiene force_rest activo)
   * @param {number} armyId - ID del ejército
   * @returns {Promise<boolean>} - true si puede moverse, false si está en descanso forzado
   */
  static async canArmyMove(armyId) {
    try {
      const result = await pool.query(
        `SELECT BOOL_OR(force_rest) as has_force_rest
         FROM troops
         WHERE army_id = $1`,
        [armyId]
      );

      if (result.rows.length === 0) {
        Logger.army(armyId, 'MOVE_CHECK', 'No tiene unidades - no puede moverse');
        return false;
      }

      const canMove = !result.rows[0].has_force_rest;
      Logger.army(armyId, 'MOVE_CHECK',
        canMove ? 'Puede moverse - no tiene force_rest' : 'Bloqueado - tiene force_rest activo',
        { can_move: canMove, has_force_rest: result.rows[0].has_force_rest }
      );

      return canMove;

    } catch (error) {
      Logger.army(armyId, 'ERROR', `Error verificando si puede moverse: ${error.message}`, { error: error.stack });
      Logger.error(error, { context: 'ArmySimulationService.canArmyMove', armyId });
      return false;
    }
  }

  /**
   * Calcula la ruta óptima desde la posición actual del ejército hasta targetH3 usando A*,
   * y la guarda en army_routes. También actualiza armies.destination.
   * Si ya existía una ruta, la sobreescribe.
   *
   * @param {number} armyId  - ID del ejército
   * @param {string} targetH3 - Índice H3 del destino
   * @returns {Promise<Object>} - { success, path, steps, message }
   */
  static async calculateAndSaveRoute(armyId, targetH3) {
    const client = await pool.connect();
    let inTransaction = false;
    try {
      // 1. Obtener posición actual del ejército
      const armyResult = await client.query(
        'SELECT army_id, name, h3_index, is_naval FROM armies WHERE army_id = $1',
        [armyId]
      );
      if (armyResult.rows.length === 0) {
        Logger.army(armyId, 'ERROR', 'Ejército no encontrado para calcular ruta');
        return { success: false, message: `Ejército ${armyId} no encontrado` };
      }
      const army = armyResult.rows[0];
      const startH3 = army.h3_index;

      if (startH3 === targetH3) {
        return { success: true, path: [], steps: 0, message: 'Ya está en el destino' };
      }

      // 2. A* con caché de costes de terreno (consultas en batch)
      // Flotas navales usan is_naval_passable; ejércitos terrestres usan movement_cost > 0
      const terrainCache = new Map();

      const fetchTerrainCosts = async (hexes) => {
        const uncached = hexes.filter(h => !terrainCache.has(h));
        if (uncached.length === 0) return;
        const result = await client.query(
          `SELECT hm.h3_index, tt.movement_cost, tt.is_naval_passable, tt.terrain_type_id
           FROM h3_map hm
           JOIN terrain_types tt ON hm.terrain_type_id = tt.terrain_type_id
           WHERE hm.h3_index = ANY($1)`,
          [uncached]
        );
        const found = new Set();
        for (const row of result.rows) {
          let cost;
          if (army.is_naval) {
            if (!row.is_naval_passable) {
              cost = -1; // tierra: impasable
            } else if (row.terrain_type_id === 1) {
              cost = 1;  // Mar: preferido
            } else {
              cost = 5;  // Costa: pasable pero caro — evita cortar penínsulas
            }
          } else {
            cost = parseFloat(row.movement_cost);
          }
          terrainCache.set(row.h3_index, cost);
          found.add(row.h3_index);
        }
        // Hexágonos no encontrados en mapa = impasables
        for (const hex of uncached) {
          if (!found.has(hex)) terrainCache.set(hex, -1);
        }
      };

      // openSet: [{ hex, f, g }] — el nodo con menor f se procesa primero
      const openSet = [];
      const gScore = new Map([[startH3, 0]]);
      const cameFrom = new Map();
      const closedSet = new Set();

      openSet.push({ hex: startH3, f: h3.gridDistance(startH3, targetH3), g: 0 });

      const MAX_NODES = 15000;
      let explored = 0;
      let pathFound = false;

      while (openSet.length > 0 && explored < MAX_NODES) {
        explored++;
        // Extraer nodo con menor f
        openSet.sort((a, b) => a.f - b.f);
        const current = openSet.shift();

        if (current.hex === targetH3) {
          pathFound = true;
          break;
        }
        if (closedSet.has(current.hex)) continue;
        closedSet.add(current.hex);

        const neighbors = h3.gridDisk(current.hex, 1).filter(n => n !== current.hex);
        await fetchTerrainCosts(neighbors);

        for (const neighbor of neighbors) {
          if (closedSet.has(neighbor)) continue;
          const rawCost = terrainCache.get(neighbor);
          if (rawCost === undefined || rawCost < 0) continue; // fuera de mapa o impasable
          const cost = Math.max(1, rawCost);
          const tentativeG = gScore.get(current.hex) + cost;
          if (!gScore.has(neighbor) || tentativeG < gScore.get(neighbor)) {
            gScore.set(neighbor, tentativeG);
            cameFrom.set(neighbor, current.hex);
            const f = tentativeG + h3.gridDistance(neighbor, targetH3);
            const idx = openSet.findIndex(n => n.hex === neighbor);
            if (idx >= 0) openSet[idx] = { hex: neighbor, f, g: tentativeG };
            else openSet.push({ hex: neighbor, f, g: tentativeG });
          }
        }
      }

      if (!pathFound) {
        Logger.army(armyId, 'ROUTE_CALC',
          `Sin ruta hacia ${targetH3} (${explored} nodos explorados)`,
          { from: startH3, to: targetH3, explored }
        );
        return { success: false, message: `No se encontró ruta hacia ${targetH3}` };
      }

      // 3. Reconstruir camino (excluye la posición actual, incluye el destino)
      const path = [];
      let cur = targetH3;
      while (cur !== startH3) {
        path.unshift(cur);
        cur = cameFrom.get(cur);
        if (cur === undefined) {
          return { success: false, message: 'Error reconstruyendo la ruta' };
        }
      }

      // 4. Guardar en DB (sobreescribe ruta anterior si existe)
      await client.query('BEGIN');
      inTransaction = true;
      await client.query(
        `INSERT INTO army_routes (army_id, path, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (army_id) DO UPDATE SET path = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
        [armyId, JSON.stringify(path)]
      );
      await client.query(
        'UPDATE armies SET destination = $1 WHERE army_id = $2',
        [targetH3, armyId]
      );
      await client.query('COMMIT');
      inTransaction = false;

      Logger.army(armyId, 'ROUTE_CALC',
        `Army ${armyId} generada ruta de ${path.length} pasos hacia ${targetH3}`,
        { army_name: army.name, from: startH3, to: targetH3, steps: path.length, nodes_explored: explored }
      );

      return { success: true, path, steps: path.length, message: `Ruta calculada: ${path.length} pasos` };

    } catch (error) {
      if (inTransaction) await client.query('ROLLBACK').catch(() => {});
      Logger.army(armyId, 'ERROR', `Error calculando ruta: ${error.message}`, { error: error.stack });
      Logger.error(error, { context: 'ArmySimulationService.calculateAndSaveRoute', armyId });
      return { success: false, message: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Ejecuta el turno de movimiento completo de un ejército.
   * Lee la ruta pre-calculada de army_routes y avanza hasta min(speed) pasos.
   * Reglas: stamina > 0 → mueve y descuenta; stamina = 0 → bloqueado.
   * Si la stamina llega a 0 durante el movimiento → force_rest = TRUE y para.
   *
   * @param {number} armyId - ID del ejército
   * @returns {Promise<Object>} - { success, moved, arrived, stepsCount, staminaExhausted, message }
   */
  static async executeArmyTurn(armyId) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Obtener estado del ejército + ruta pre-calculada
      const armyResult = await client.query(
        `SELECT a.army_id, a.name, a.h3_index, a.destination, a.player_id,
                a.is_naval,
                ar.path
         FROM armies a
         LEFT JOIN army_routes ar ON ar.army_id = a.army_id
         WHERE a.army_id = $1`,
        [armyId]
      );

      if (armyResult.rows.length === 0) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'ERROR', 'Ejército no encontrado en BD');
        return { success: false, moved: false, message: `Ejército ${armyId} no encontrado` };
      }

      const army = armyResult.rows[0];

      // Sin destino → no hacer nada
      if (!army.destination) {
        await client.query('ROLLBACK');
        return { success: true, moved: false, message: `${army.name} no tiene destino` };
      }

      // Parsear path desde JSONB (pg devuelve el array directamente si es JSONB)
      const rawPath = army.path;
      const remainingPath = Array.isArray(rawPath)
        ? [...rawPath]
        : (rawPath ? JSON.parse(rawPath) : []);

      if (remainingPath.length === 0) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'MOVE_SKIP', 'Sin ruta calculada en army_routes');
        return { success: true, moved: false, message: `${army.name} sin ruta calculada` };
      }

      // ── PASO 1: Obtener velocidad (troops para terrestres, fleet_ships para navales) ──
      let maxCells;

      if (army.is_naval) {
        const shipsResult = await client.query(
          `SELECT MIN(st.speed) AS min_speed
           FROM fleet_ships fs
           JOIN ship_types st ON fs.ship_type_id = st.id
           WHERE fs.army_id = $1`,
          [armyId]
        );
        const minSpeed = shipsResult.rows[0]?.min_speed;
        if (!minSpeed) {
          await client.query('ROLLBACK');
          Logger.army(armyId, 'ERROR', 'Flota sin barcos');
          return { success: false, moved: false, message: `${army.name} no tiene barcos` };
        }
        maxCells = parseInt(minSpeed) || 1;
      } else {
        const troopsResult = await client.query(
          `SELECT t.troop_id, t.stamina, t.force_rest, ut.speed
           FROM troops t
           JOIN unit_types ut ON t.unit_type_id = ut.unit_type_id
           WHERE t.army_id = $1`,
          [armyId]
        );

        if (troopsResult.rows.length === 0) {
          await client.query('ROLLBACK');
          Logger.army(armyId, 'ERROR', 'Sin unidades');
          return { success: false, moved: false, message: `${army.name} no tiene unidades` };
        }

        const hasForceRestTroops = troopsResult.rows.some(t => t.force_rest);
        maxCells = Math.min(...troopsResult.rows.map(t => parseInt(t.speed) || 1));

        if (hasForceRestTroops) {
          await client.query('ROLLBACK');
          Logger.army(armyId, 'MOVE_BLOCKED', 'Sin stamina - force_rest activo');
          return { success: true, moved: false, message: `${army.name} no puede moverse (agotado)` };
        }
      }

      Logger.army(armyId, 'TURN_START',
        `MaxCells: ${maxCells}. Ruta: ${remainingPath.length} pasos restantes`,
        { army_name: army.name, max_cells: maxCells, path_remaining: remainingPath.length, is_naval: army.is_naval }
      );

      // Pre-fetch costes de terreno para los primeros pasos de la ruta
      // Flotas navales usan is_naval_passable; ejércitos terrestres usan movement_cost > 0
      const pathSlice = remainingPath.slice(0, maxCells + 2);
      const terrainResult = await client.query(
        `SELECT hm.h3_index, tt.movement_cost, tt.is_naval_passable, tt.terrain_type_id
         FROM h3_map hm
         JOIN terrain_types tt ON hm.terrain_type_id = tt.terrain_type_id
         WHERE hm.h3_index = ANY($1)`,
        [pathSlice]
      );
      const costMap = {};
      for (const row of terrainResult.rows) {
        if (army.is_naval) {
          if (!row.is_naval_passable) {
            costMap[row.h3_index] = -1; // tierra: bloquea movimiento
          } else if (row.terrain_type_id === 1) {
            costMap[row.h3_index] = 1;  // Mar
          } else {
            costMap[row.h3_index] = 5;  // Costa
          }
        } else {
          costMap[row.h3_index] = parseFloat(row.movement_cost);
        }
      }

      // ── PASO 2: Movimiento por stamina ────────────────────────────────────────
      const STAMINA_COST_PER_HEX = config.MILITARY.STAMINA_COST_PER_HEX;
      let currentPos       = army.h3_index;
      let stepsCount       = 0;
      let staminaExhausted = false;

      while (stepsCount < maxCells && remainingPath.length > 0) {
        const nextHex = remainingPath[0];
        const rawCost = costMap[nextHex];

        if (rawCost === undefined || rawCost < 0) {
          Logger.army(armyId, 'MOVE_BLOCKED',
            `Hex ${nextHex} impasable o fuera de mapa en ruta`,
            { hex: nextHex, raw_cost: rawCost }
          );
          break;
        }

        const cost        = Math.max(1, rawCost);
        const staminaCost = cost * STAMINA_COST_PER_HEX;

        // Mover el ejército al siguiente hexágono
        const prevPos = currentPos;
        currentPos = nextHex;
        remainingPath.shift();
        stepsCount++;

        await client.query('UPDATE armies SET h3_index = $1 WHERE army_id = $2', [currentPos, armyId]);
        // El comandante viaja con el ejército
        await client.query('UPDATE characters SET h3_index = $1 WHERE army_id = $2', [currentPos, armyId]);

        Logger.army(armyId, 'ROUTE_STEP',
          `Army ${armyId} avanzado a ${currentPos}. Pasos restantes en ruta: ${remainingPath.length}`,
          { from: prevPos, to: currentPos, steps_left: remainingPath.length, terrain_cost: cost, stamina_cost: staminaCost }
        );

        // Descontar stamina (solo ejércitos terrestres; flotas no se cansan)
        if (!army.is_naval) {
          const staminaResult = await this._consumeStaminaWithClient(client, armyId, staminaCost);

          if (staminaResult.exhaustedUnits > 0) {
            staminaExhausted = true;
            Logger.army(armyId, 'STAMINA_EXHAUSTED',
              `${staminaResult.exhaustedUnits} unidad(es) agotada(s). force_rest activado`,
              { exhausted_units: staminaResult.exhaustedUnits, step: stepsCount }
            );
            break;
          }
        }
      }

      // ── Actualizar/limpiar ruta ───────────────────────────────────────────────
      const arrived = remainingPath.length === 0;

      if (arrived) {
        await client.query('DELETE FROM army_routes WHERE army_id = $1', [armyId]);
        await client.query('UPDATE armies SET destination = NULL WHERE army_id = $1', [armyId]);
        Logger.army(armyId, 'MOVE_ARRIVED',
          `Llegó a su destino ${army.destination} en ${stepsCount} pasos`,
          { destination: army.destination, steps: stepsCount }
        );
      } else {
        // Guardar el path restante
        await client.query(
          `UPDATE army_routes SET path = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE army_id = $2`,
          [JSON.stringify(remainingPath), armyId]
        );
      }

      await client.query('COMMIT');

      Logger.army(armyId, 'TURN_END',
        `Pasos: ${stepsCount}, Llegó: ${arrived}, Agotado: ${staminaExhausted}`,
        { steps: stepsCount, arrived, stamina_exhausted: staminaExhausted, final_pos: currentPos }
      );

      if (stepsCount > 0) {
        auditEvent(arrived ? 'ARMY_ARRIVED' : 'ARMY_MOVED', {
          army_id:          armyId,
          player_id:        army.player_id,
          from:             army.h3_index,
          to:               currentPos,
          destination:      army.destination,
          steps:            stepsCount,
          stamina_exhausted: staminaExhausted,
          arrived,
        }, TOPICS.MILITARY);
      }

      return {
        success: true,
        moved: stepsCount > 0,
        arrived,
        stepsCount,
        staminaExhausted,
        message: arrived
          ? `${army.name} llegó a su destino`
          : `${army.name} avanzó ${stepsCount} pasos`
      };

    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      Logger.army(armyId, 'ERROR',
        `Error en executeArmyTurn: ${error.message}`,
        { error: error.stack }
      );
      Logger.error(error, { context: 'ArmySimulationService.executeArmyTurn', armyId });
      return { success: false, moved: false, message: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Procesa un paso de movimiento automático para un ejército con destino
   * @deprecated Usar executeArmyTurn en su lugar
   * [DEAD_CODE] Función deprecada — no se llama desde ningún otro módulo; candidata a eliminación
   * @param {number} armyId - ID del ejército
   * @returns {Promise<Object>} - { success, moved, arrived, message }
   */
  static async processMovementStep(armyId) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Obtener estado del ejército
      const armyResult = await client.query(
        `SELECT
          a.army_id, a.name, a.h3_index, a.destination, a.recovering,
          a.movement_points, a.player_id
         FROM armies a
         WHERE a.army_id = $1`,
        [armyId]
      );

      if (armyResult.rows.length === 0) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'ERROR', 'Ejército no encontrado en BD');
        return {
          success: false,
          moved: false,
          message: `Ejército ${armyId} no encontrado`
        };
      }

      const army = armyResult.rows[0];

      // Log de inicio de movimiento
      if (army.destination) {
        Logger.army(armyId, 'MOVE_START',
          `Destino: ${army.destination}, PM iniciales: ${army.movement_points}`,
          {
            army_name: army.name,
            current_pos: army.h3_index,
            destination: army.destination,
            movement_points: army.movement_points,
            recovering: army.recovering
          }
        );
      }

      // 2. Verificaciones previas
      // Si no tiene destino, no hacer nada
      if (!army.destination || army.destination === null) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'MOVE_SKIP', 'No tiene destino asignado');
        return {
          success: true,
          moved: false,
          message: `Ejército ${army.name} no tiene destino`
        };
      }

      // Si está en recovering, no puede moverse
      if (army.recovering && parseInt(army.recovering) > 0) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'MOVE_BLOCKED',
          `Se está recuperando (${army.recovering} turnos restantes)`,
          { recovering_turns: army.recovering }
        );
        return {
          success: true,
          moved: false,
          message: `Ejército ${army.name} se está recuperando (${army.recovering} turnos)`
        };
      }

      // Si tiene force_rest, no puede moverse
      const canMove = await this.canArmyMove(armyId);
      if (!canMove) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'MOVE_BLOCKED', 'Unidades agotadas - force_rest activo');
        return {
          success: true,
          moved: false,
          message: `Ejército ${army.name} tiene unidades agotadas y debe descansar`
        };
      }

      // 3. Verificar si ya llegó al destino
      if (army.h3_index === army.destination) {
        // Llegó al destino, limpiar destination
        await client.query(
          'UPDATE armies SET destination = NULL WHERE army_id = $1',
          [armyId]
        );
        await client.query('COMMIT');

        Logger.army(armyId, 'MOVE_ARRIVED',
          `Llegó a su destino ${army.destination}`,
          { destination: army.destination, army_name: army.name }
        );

        return {
          success: true,
          moved: false,
          arrived: true,
          message: `${army.name} ha llegado a su destino`
        };
      }

      // 4. Calcular siguiente paso (vecino más cercano al destino)
      const currentPos = army.h3_index;
      const destination = army.destination;

      // Obtener vecinos del hexágono actual (radio 1)
      const neighbors = h3.gridDisk(currentPos, 1).filter(hex => hex !== currentPos);

      if (neighbors.length === 0) {
        await client.query('ROLLBACK');
        Logger.army(armyId, 'ERROR', `No se pudieron calcular vecinos para ${currentPos}`);
        return {
          success: false,
          moved: false,
          message: `No se pudieron calcular vecinos para ${currentPos}`
        };
      }

      // Encontrar el vecino más cercano al destino
      let closestNeighbor = neighbors[0];
      let minDistance = h3.gridDistance(neighbors[0], destination);

      for (const neighbor of neighbors) {
        const distance = h3.gridDistance(neighbor, destination);
        if (distance < minDistance) {
          minDistance = distance;
          closestNeighbor = neighbor;
        }
      }

      // 5. Calcular coste de movimiento (por ahora fijo, TODO: obtener del terreno)
      const MOVEMENT_COST_PER_HEX = config.MILITARY.STAMINA_COST_PER_HEX; // Coste base de stamina
      const MOVEMENT_COST_PM = 1; // Coste en puntos de movimiento

      // 6. Verificar si tiene puntos de movimiento
      const currentPM = parseFloat(army.movement_points) || 0;

      if (currentPM < MOVEMENT_COST_PM) {
        // No tiene PM suficientes, no puede moverse este turno
        await client.query('ROLLBACK');
        Logger.army(armyId, 'MOVE_BLOCKED',
          `PM insuficientes (${currentPM}/${MOVEMENT_COST_PM})`,
          { current_pm: currentPM, required_pm: MOVEMENT_COST_PM }
        );
        return {
          success: true,
          moved: false,
          message: `${army.name} no tiene puntos de movimiento suficientes (${currentPM}/${MOVEMENT_COST_PM})`
        };
      }

      // Log del cálculo de paso
      Logger.army(armyId, 'MOVE_STEP',
        `De ${currentPos} a ${closestNeighbor}. Coste terreno: ${MOVEMENT_COST_PER_HEX}. PM restantes: ${currentPM - MOVEMENT_COST_PM}`,
        {
          from: currentPos,
          to: closestNeighbor,
          destination: destination,
          distance_to_destination: minDistance,
          terrain_cost: MOVEMENT_COST_PER_HEX,
          pm_cost: MOVEMENT_COST_PM,
          pm_before: currentPM,
          pm_after: currentPM - MOVEMENT_COST_PM
        }
      );

      // 7. Consumir stamina de todas las unidades (usar helper interno para evitar nested transactions)
      const staminaResult = await this._consumeStaminaWithClient(client, armyId, MOVEMENT_COST_PER_HEX);

      if (!staminaResult.success) {
        await client.query('ROLLBACK');
        return {
          success: false,
          moved: false,
          message: `Error al consumir stamina: ${staminaResult.message}`
        };
      }

      // 8. Mover el ejército al siguiente hexágono
      const newPM = Math.max(0, currentPM - MOVEMENT_COST_PM);

      await client.query(
        `UPDATE armies
         SET h3_index = $1,
             movement_points = $2
         WHERE army_id = $3`,
        [closestNeighbor, newPM, armyId]
      );

      await client.query('COMMIT');

      // Log final de movimiento exitoso
      Logger.army(armyId, 'MOVE_SUCCESS',
        `Movido de ${currentPos} → ${closestNeighbor}. PM: ${currentPM} → ${newPM}. Unidades agotadas: ${staminaResult.exhaustedUnits || 0}`,
        {
          army_name: army.name,
          from: currentPos,
          to: closestNeighbor,
          pm_before: currentPM,
          pm_after: newPM,
          stamina_consumed: MOVEMENT_COST_PER_HEX,
          exhausted_units: staminaResult.exhaustedUnits || 0,
          destination: army.destination,
          distance_remaining: minDistance
        }
      );

      return {
        success: true,
        moved: true,
        arrived: false,
        message: `${army.name} se movió de ${currentPos} a ${closestNeighbor}`,
        data: {
          from: currentPos,
          to: closestNeighbor,
          remaining_pm: newPM,
          stamina_consumed: MOVEMENT_COST_PER_HEX,
          exhausted_units: staminaResult.exhaustedUnits || 0
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      Logger.army(armyId, 'ERROR',
        `Error procesando paso de movimiento: ${error.message}`,
        { error: error.stack }
      );
      Logger.error(error, {
        context: 'ArmySimulationService.processMovementStep',
        armyId
      });
      return {
        success: false,
        moved: false,
        message: 'Error al procesar movimiento del ejército',
        error: error.message
      };
    } finally {
      client.release();
    }
  }
}

module.exports = ArmySimulationService;
