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

const pool = require('../db');
const { Logger } = require('../src/utils/logger');

class ArmySimulationService {
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
        return {
          success: false,
          message: `Ejército ${armyId} no encontrado`
        };
      }

      const armyName = armyCheck.rows[0].name;

      // Obtener todas las unidades del ejército
      const troopsResult = await client.query(
        `SELECT troop_id, unit_type_id, quantity, stamina, force_rest
         FROM troops
         WHERE army_id = $1`,
        [armyId]
      );

      if (troopsResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `Ejército ${armyName} no tiene unidades`
        };
      }

      let exhaustedCount = 0;

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
        }
      }

      await client.query('COMMIT');

      Logger.action(
        `[ArmySimulation] Stamina consumida del ejército ${armyName} (ID: ${armyId}). ` +
        `Coste: ${terrainMovementCost}. Unidades agotadas: ${exhaustedCount}`
      );

      return {
        success: true,
        message: exhaustedCount > 0
          ? `${exhaustedCount} unidad(es) agotada(s) - Descanso forzado activado`
          : 'Stamina consumida correctamente',
        exhaustedUnits: exhaustedCount
      };

    } catch (error) {
      await client.query('ROLLBACK');
      Logger.error('[ArmySimulation] Error consumiendo stamina:', error);
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
        'SELECT army_id, name FROM armies WHERE army_id = $1',
        [armyId]
      );

      if (armyCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `Ejército ${armyId} no encontrado`
        };
      }

      const armyName = armyCheck.rows[0].name;

      // Obtener todas las unidades del ejército
      const troopsResult = await client.query(
        `SELECT troop_id, stamina, force_rest
         FROM troops
         WHERE army_id = $1`,
        [armyId]
      );

      if (troopsResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `Ejército ${armyName} no tiene unidades`
        };
      }

      let releasedCount = 0;
      const RECOVERY_RATE = 4;
      const RELEASE_THRESHOLD = 25;
      const MAX_STAMINA = 100;

      // Procesar recuperación de cada unidad
      for (const troop of troopsResult.rows) {
        const newStamina = Math.min(MAX_STAMINA, troop.stamina + RECOVERY_RATE);
        const shouldRelease = troop.force_rest && newStamina >= RELEASE_THRESHOLD;

        await client.query(
          `UPDATE troops
           SET stamina = $1,
               force_rest = CASE WHEN force_rest = TRUE AND $2 >= $3 THEN FALSE ELSE force_rest END
           WHERE troop_id = $4`,
          [newStamina, newStamina, RELEASE_THRESHOLD, troop.troop_id]
        );

        if (shouldRelease) {
          releasedCount++;
        }
      }

      await client.query('COMMIT');

      Logger.action(
        `[ArmySimulation] Recuperación pasiva procesada para ejército ${armyName} (ID: ${armyId}). ` +
        `+${RECOVERY_RATE} stamina. Unidades liberadas de descanso forzado: ${releasedCount}`
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
      Logger.error('[ArmySimulation] Error procesando recuperación:', error);
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
        return {
          success: false,
          message: 'Ejército no tiene unidades'
        };
      }

      const status = result.rows[0];

      return {
        success: true,
        minStamina: parseFloat(status.min_stamina) || 0,
        hasForceRest: status.has_force_rest || false,
        totalUnits: parseInt(status.total_units) || 0,
        exhaustedUnits: parseInt(status.exhausted_units) || 0
      };

    } catch (error) {
      Logger.error('[ArmySimulation] Error obteniendo estado de fatiga:', error);
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
        return false;
      }

      return !result.rows[0].has_force_rest;

    } catch (error) {
      Logger.error('[ArmySimulation] Error verificando si ejército puede moverse:', error);
      return false;
    }
  }
}

module.exports = ArmySimulationService;
