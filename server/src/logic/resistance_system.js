const NotificationService = require('../services/NotificationService');
const CombatService      = require('../services/CombatService');
const { Logger } = require('../utils/logger');
const h3 = require('h3-js');

// ── Parámetros de rebelión ────────────────────────────────────────────────────
// Conquista inmediata: +5 feudo normal, +20 capital de comarca
const CONQUEST_RESIST_FIEF    = 5;
const CONQUEST_RESIST_CAPITAL = 20;
// Aftershock: contador que empieza en 10 y se suma a la rebelión cada turno hasta llegar a 0
const AFTERSHOCK_START        = 10;
const CULTURE_MISMATCH_INC    = 0.5;  // +0.5/turno con desajuste cultural
const NATURAL_DECAY           = 1;    // -1/turno de decay natural (mínimo 0)
const ARMY_DECAY_PER_UNIT     = 0.5;  // -0.5/turno por ejército amigo en comarca
const REBELLION_THRESHOLD     = 100;  // Umbral que dispara la rebelión
const REBEL_ARMY_SIZE         = 500;  // Campesinos en armas al rebelarse
const RESISTANCE_AFTER_REBEL  = 30;   // Resistencia residual tras rebelión

// Unidad de infantería ligera de cada cultura para los ejércitos rebeldes
const REBEL_UNIT_BY_CULTURE = {
    1: 5,   // Romano    → Velites
    2: 13,  // Cartago   → Honderos Baleares
    3: 17,  // Íberos    → Caetrati
    4: 25,  // Celtas    → Celtíberos
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHex(h3_index) {
    const [lat, lng] = h3.cellToLatLng(h3_index);
    return `${lat.toFixed(3)}, ${lng.toFixed(3)} (${h3_index})`;
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Registra el impacto de una conquista en la resistencia de la comarca.
 * Debe llamarse dentro de una transacción activa, justo después de cambiar
 * h3_map.player_id.
 *
 * @param {Object}         client      - pg client
 * @param {string|string[]} h3Indices  - hex(es) conquistados
 * @param {number}          newOwnerId - nuevo propietario
 * @param {number|null}     prevOwnerId - propietario anterior (null si era tierra libre)
 */
async function addConquestResistance(client, h3Indices, newOwnerId, prevOwnerId) {
    const indices = Array.isArray(h3Indices) ? h3Indices : [h3Indices];

    if (prevOwnerId) {
        await client.query(
            'UPDATE h3_map SET previous_player_id = $1 WHERE h3_index = ANY($2::text[])',
            [prevOwnerId, indices]
        );
    }

    // Buscar comarcas afectadas
    const comarcaRes = await client.query(`
        SELECT DISTINCT td.division_id
        FROM territory_details td
        WHERE td.h3_index = ANY($1::text[]) AND td.division_id IS NOT NULL
    `, [indices]);

    for (const row of comarcaRes.rows) {
        // Determinar si el feudo principal (capital de comarca) está entre los conquistados
        const capitalRes = await client.query(`
            SELECT capital_h3
            FROM political_divisions
            WHERE id = $1
        `, [row.division_id]);
        const comarcaCapital = capitalRes.rows[0]?.capital_h3 ?? null;
        const capitalConquered = comarcaCapital && indices.includes(comarcaCapital);

        // Contar feudos no-capital conquistados en esta comarca
        const countRes = await client.query(`
            SELECT COUNT(*)::int AS cnt
            FROM territory_details
            WHERE h3_index = ANY($1::text[]) AND division_id = $2
              AND h3_index != $3
        `, [indices, row.division_id, comarcaCapital ?? '']);

        // Capital conquistada: +20 fijo (los demás feudos en cascada no suman)
        // Sin capital: +5 por cada feudo conquistado
        const immediateResist = capitalConquered
            ? CONQUEST_RESIST_CAPITAL
            : countRes.rows[0].cnt * CONQUEST_RESIST_FIEF;

        if (capitalConquered) {
            // Tier del aftershock según ratio ejército conquistador / población de la comarca
            const troopsRes = await client.query(`
                SELECT COALESCE(SUM(t.quantity), 0)::int AS total_troops
                FROM troops t
                JOIN armies a ON a.army_id = t.army_id
                WHERE a.h3_index = ANY($1::text[])
                  AND a.player_id = $2
                  AND a.is_naval  = FALSE
                  AND a.is_rebel  = FALSE
            `, [indices, newOwnerId]);

            const popRes = await client.query(`
                SELECT COALESCE(SUM(td.population), 1)::int AS total_pop
                FROM territory_details td
                WHERE td.division_id = $1
            `, [row.division_id]);

            const ratio = troopsRes.rows[0].total_troops / popRes.rows[0].total_pop;
            // > 10%: aftershock fijo de 1/turno durante AFTERSHOCK_START turnos
            // >  5%: aftershock a la mitad (multiplier 0.5)
            // <=5%:  aftershock normal
            let aftershockMultiplier = 1.0;
            let aftershockOverride   = null;
            if (ratio >= 0.10) {
                aftershockOverride = 1.0;
            } else if (ratio >= 0.05) {
                aftershockMultiplier = 0.5;
            }

            await client.query(`
                INSERT INTO comarca_resistance
                    (division_id, player_id, resistance, aftershock, aftershock_multiplier, aftershock_override, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (division_id, player_id)
                DO UPDATE SET
                    resistance           = LEAST(100, comarca_resistance.resistance + EXCLUDED.resistance),
                    aftershock           = $4,
                    aftershock_multiplier = $5,
                    aftershock_override  = $6,
                    updated_at           = NOW()
            `, [row.division_id, newOwnerId, immediateResist, AFTERSHOCK_START, aftershockMultiplier, aftershockOverride]);
        } else {
            await client.query(`
                INSERT INTO comarca_resistance (division_id, player_id, resistance, aftershock, updated_at)
                VALUES ($1, $2, $3, 0, NOW())
                ON CONFLICT (division_id, player_id)
                DO UPDATE SET
                    resistance = LEAST(100, comarca_resistance.resistance + EXCLUDED.resistance),
                    updated_at = NOW()
            `, [row.division_id, newOwnerId, immediateResist]);
        }
    }
}

/**
 * Procesamiento de resistencia por turno.
 * - Aftershock decae linealmente -1/turno
 * - Resistencia sube +0.5/turno por desajuste cultural
 * - Resistencia baja -0.3/turno natural y -0.5/turno por ejército amigo
 * - Dispara rebelión cuando resistance + aftershock >= 100
 *
 * Debe llamarse DENTRO de una transacción activa, cada turno.
 *
 * @param {Object} client - pg client
 * @param {number} turn   - turno actual
 */
async function processComarcaResistance(client, turn) {
    const resistances = await client.query(`
        SELECT cr.division_id, cr.player_id,
               cr.resistance::float            AS resistance,
               cr.aftershock::float            AS aftershock,
               cr.aftershock_multiplier::float AS aftershock_multiplier,
               cr.aftershock_override,
               pd.name AS comarca_name,
               pd.capital_h3,
               p.culture_id AS owner_culture_id
        FROM comarca_resistance cr
        JOIN political_divisions pd ON pd.id = cr.division_id
        JOIN players p ON p.player_id = cr.player_id
        WHERE cr.resistance + cr.aftershock > 0
    `);

    if (resistances.rows.length === 0) return;

    for (const row of resistances.rows) {
        try {
            let resistance = row.resistance;
            let aftershock = row.aftershock;

            // 1. Aftershock: suma su contribución a la resistencia y decrementa el contador
            if (aftershock > 0) {
                const override    = row.aftershock_override !== null ? parseFloat(row.aftershock_override) : null;
                const multiplier  = parseFloat(row.aftershock_multiplier) || 1.0;
                resistance += override !== null ? override : aftershock * multiplier;
                aftershock -= 1;
            }

            // 2. Desajuste cultural
            const cultureRes = await client.query(`
                SELECT
                    COALESCE(SUM(fc.culture_romanos),       0)::float AS r,
                    COALESCE(SUM(fc.culture_cartagineses),  0)::float AS c,
                    COALESCE(SUM(fc.culture_iberos),        0)::float AS i,
                    COALESCE(SUM(fc.culture_celtas),        0)::float AS ce
                FROM territory_details td
                LEFT JOIN fief_culture fc ON fc.h3_index = td.h3_index
                WHERE td.division_id = $1
            `, [row.division_id]);

            const cs = cultureRes.rows[0];
            const cultureSums = [[1, cs.r], [2, cs.c], [3, cs.i], [4, cs.ce]];
            cultureSums.sort((a, b) => b[1] - a[1]);
            const dominantCultureId = cultureSums[0][0];

            if (dominantCultureId !== parseInt(row.owner_culture_id)) {
                resistance += CULTURE_MISMATCH_INC;
            }

            // 3. Decaimiento natural
            resistance = Math.max(0, resistance - NATURAL_DECAY);

            // 4. Reducción por ejércitos amigos en la comarca
            const armyRes = await client.query(`
                SELECT COUNT(*)::int AS army_count
                FROM armies a
                JOIN territory_details td ON td.h3_index = a.h3_index
                WHERE td.division_id = $1
                  AND a.player_id    = $2
                  AND a.is_naval     = FALSE
                  AND a.is_rebel     = FALSE
            `, [row.division_id, row.player_id]);

            const armyCount = armyRes.rows[0].army_count;
            if (armyCount > 0) {
                resistance = Math.max(0, resistance - armyCount * ARMY_DECAY_PER_UNIT);
            }

            resistance = Math.min(100, resistance);

            // 5. Suelo cultural: desajuste cultural → mínimo 40 de resistencia
            if (dominantCultureId !== parseInt(row.owner_culture_id)) {
                resistance = Math.max(40, resistance);
            }

            // 7. Comprobación de umbral de rebelión
            if (resistance + aftershock >= REBELLION_THRESHOLD) {
                await triggerRebellion(
                    client, row.division_id, row.player_id,
                    row.comarca_name, row.capital_h3, dominantCultureId, turn
                );
                resistance = RESISTANCE_AFTER_REBEL;
                aftershock = 0;
            }

            await client.query(`
                UPDATE comarca_resistance
                SET resistance = $1, aftershock = $2, updated_at = NOW()
                WHERE division_id = $3 AND player_id = $4
            `, [resistance, aftershock, row.division_id, row.player_id]);

        } catch (e) {
            Logger.error(e, {
                context: 'processComarcaResistance',
                division_id: row.division_id,
                player_id: row.player_id,
                turn,
            });
        }
    }
}

// ── Disparo de rebelión ───────────────────────────────────────────────────────

async function triggerRebellion(client, divisionId, playerId, comarcaName, capitalH3, dominantCultureId, turn) {
    Logger.engine(`[TURN ${turn}] REBELLION in comarca ${divisionId} (${comarcaName}), owner: ${playerId}`);

    // Solo los feudos que pertenecen al jugador conquistador dentro de esta comarca
    const fiefsRes = await client.query(`
        SELECT td.h3_index
        FROM territory_details td
        JOIN h3_map m ON m.h3_index = td.h3_index
        WHERE td.division_id = $1 AND m.player_id = $2
    `, [divisionId, playerId]);
    if (fiefsRes.rows.length === 0) return;

    // 50 % de los feudos se liberan; al menos uno siempre escapa
    const liberatedFiefs = fiefsRes.rows
        .filter(() => Math.random() < 0.5)
        .map(r => r.h3_index);

    if (liberatedFiefs.length === 0) {
        liberatedFiefs.push(fiefsRes.rows[0].h3_index);
    }

    // Liberar feudos: sin dueño, fuera de la comarca
    await client.query(
        `UPDATE h3_map
         SET player_id = NULL, previous_player_id = $1
         WHERE h3_index = ANY($2::text[])`,
        [playerId, liberatedFiefs]
    );
    await client.query(
        `UPDATE territory_details SET division_id = NULL WHERE h3_index = ANY($1::text[])`,
        [liberatedFiefs]
    );

    // Punto de aparición: capital de la comarca si se liberó, si no el primer feudo libre
    const spawnHex = liberatedFiefs.includes(capitalH3) ? capitalH3 : liberatedFiefs[0];
    const unitTypeId = REBEL_UNIT_BY_CULTURE[dominantCultureId] ?? 17;

    const armyRes = await client.query(`
        INSERT INTO armies (player_id, h3_index, name, is_rebel, rebel_division_id, rebel_target_player_id)
        VALUES (NULL, $1, 'Campesinos en Armas', TRUE, $2, $3)
        RETURNING army_id
    `, [spawnHex, divisionId, playerId]);
    const armyId = armyRes.rows[0].army_id;

    await client.query(`
        INSERT INTO troops (army_id, unit_type_id, quantity, experience, morale)
        VALUES ($1, $2, $3, 5, 70)
    `, [armyId, unitTypeId, REBEL_ARMY_SIZE]);

    const loc = fmtHex(spawnHex);
    await NotificationService.createSystemNotification(
        playerId, 'Militar',
        [
            `⚔️ **¡REBELIÓN EN ${comarcaName.toUpperCase()}!**`,
            ``,
            `La población de la comarca **${comarcaName}** se ha levantado en armas.`,
            `**${liberatedFiefs.length} de ${fiefsRes.rows.length} territorios** se han declarado libres.`,
            ``,
            `Campesinos en armas han sido vistos en ${loc}.`,
            ``,
            `Sofocad la rebelión antes de que se extienda.`,
        ].join('\n'),
        turn
    );

    Logger.engine(`[TURN ${turn}] Rebellion: ${liberatedFiefs.length}/${fiefsRes.rows.length} fiefs liberated in comarca ${divisionId}, rebel army ${armyId} at ${spawnHex}`);
}

// ── IA de ejércitos rebeldes ──────────────────────────────────────────────────

/**
 * Ejecuta el comportamiento de todos los ejércitos rebeldes activos.
 * Prioridades por ejército:
 *   1. Conquistar feudos adyacentes del agresor (liberarlos)
 *   2. Moverse a feudos libres de la comarca
 *   3. Atacar ejércitos del agresor en la comarca (o avanzar hacia ellos)
 *   4. Patrullar: moverse a un hex libre adyacente aleatorio
 */
async function processRebelArmies(client, turn) {
    const rebels = await client.query(`
        SELECT army_id, h3_index, rebel_division_id, rebel_target_player_id
        FROM armies
        WHERE is_rebel = TRUE
          AND h3_index IS NOT NULL
          AND rebel_division_id IS NOT NULL
          AND rebel_target_player_id IS NOT NULL
    `);

    for (const rebel of rebels.rows) {
        try {
            await _processOneRebelArmy(client, rebel, turn);
        } catch (e) {
            Logger.error(e, { context: 'processRebelArmies', army_id: rebel.army_id, turn });
        }
    }
}

async function _processOneRebelArmy(client, rebel, turn) {
    // Si el hex actual sigue siendo del agresor (quedó de un turno anterior), liberarlo
    await client.query(
        `UPDATE h3_map SET player_id = NULL, previous_player_id = $1
         WHERE h3_index = $2 AND player_id = $1`,
        [rebel.rebel_target_player_id, rebel.h3_index]
    );

    const neighbors = h3.gridDisk(rebel.h3_index, 1).filter(n => n !== rebel.h3_index);

    // 1. Feudos adyacentes del agresor → liberar
    const aggressorFiefs = await client.query(`
        SELECT h3_index FROM h3_map
        WHERE h3_index = ANY($1::text[]) AND player_id = $2
        LIMIT 1
    `, [neighbors, rebel.rebel_target_player_id]);

    if (aggressorFiefs.rows.length > 0) {
        const targetHex = aggressorFiefs.rows[0].h3_index;
        await client.query(
            'UPDATE armies SET h3_index = $1 WHERE army_id = $2',
            [targetHex, rebel.army_id]
        );

        // Combate si hay ejército defensor en ese hex
        const defArmy = await client.query(`
            SELECT army_id FROM armies
            WHERE h3_index = $1 AND player_id = $2 AND is_rebel = FALSE AND is_naval = FALSE
            LIMIT 1
        `, [targetHex, rebel.rebel_target_player_id]);

        if (defArmy.rows.length > 0) {
            await CombatService.resolveCombat(
                client, rebel.army_id, defArmy.rows[0].army_id, targetHex, turn, rebel.army_id
            );
            // Comprobar si el ejército rebelde sobrevivió
            const alive = await client.query(
                'SELECT army_id FROM armies WHERE army_id = $1', [rebel.army_id]
            );
            if (alive.rows.length === 0) return;
        }

        await client.query(
            `UPDATE h3_map SET player_id = NULL, previous_player_id = $1
             WHERE h3_index = $2 AND player_id = $1`,
            [rebel.rebel_target_player_id, targetHex]
        );
        Logger.engine(`[TURN ${turn}] Rebel army ${rebel.army_id} liberated ${targetHex}`);
        return;
    }

    // 2. Feudos libres de la comarca adyacentes → ocupar
    const freeComarca = await client.query(`
        SELECT m.h3_index FROM h3_map m
        JOIN territory_details td ON td.h3_index = m.h3_index
        WHERE m.h3_index = ANY($1::text[])
          AND m.player_id IS NULL
          AND td.division_id = $2
        LIMIT 1
    `, [neighbors, rebel.rebel_division_id]);

    if (freeComarca.rows.length > 0) {
        await client.query(
            'UPDATE armies SET h3_index = $1 WHERE army_id = $2',
            [freeComarca.rows[0].h3_index, rebel.army_id]
        );
        return;
    }

    // 3. Ejércitos del agresor en la comarca → atacar si adyacente, avanzar si no
    const aggressorArmies = await client.query(`
        SELECT a.army_id, a.h3_index FROM armies a
        JOIN territory_details td ON td.h3_index = a.h3_index
        WHERE td.division_id = $1
          AND a.player_id = $2
          AND a.is_rebel = FALSE AND a.is_naval = FALSE
    `, [rebel.rebel_division_id, rebel.rebel_target_player_id]);

    if (aggressorArmies.rows.length > 0) {
        const target = aggressorArmies.rows.reduce((best, a) => {
            try {
                return h3.gridDistance(rebel.h3_index, a.h3_index) <
                       h3.gridDistance(rebel.h3_index, best.h3_index) ? a : best;
            } catch { return best; }
        });

        if (neighbors.includes(target.h3_index)) {
            await client.query(
                'UPDATE armies SET h3_index = $1 WHERE army_id = $2',
                [target.h3_index, rebel.army_id]
            );
            await CombatService.resolveCombat(
                client, rebel.army_id, target.army_id, target.h3_index, turn, rebel.army_id
            );
        } else {
            const nextHex = neighbors.reduce((best, n) => {
                try {
                    const d = h3.gridDistance(n, target.h3_index);
                    const dBest = best ? h3.gridDistance(best, target.h3_index) : Infinity;
                    return d < dBest ? n : best;
                } catch { return best; }
            }, null);
            if (nextHex) {
                await client.query(
                    'UPDATE armies SET h3_index = $1 WHERE army_id = $2',
                    [nextHex, rebel.army_id]
                );
            }
        }
        return;
    }

    // 4. Patrullar: hex libre adyacente aleatorio
    const freeNeighbors = await client.query(`
        SELECT h3_index FROM h3_map
        WHERE h3_index = ANY($1::text[]) AND player_id IS NULL
    `, [neighbors]);

    if (freeNeighbors.rows.length > 0) {
        const pick = freeNeighbors.rows[Math.floor(Math.random() * freeNeighbors.rows.length)];
        await client.query(
            'UPDATE armies SET h3_index = $1 WHERE army_id = $2',
            [pick.h3_index, rebel.army_id]
        );
    }
}

module.exports = { addConquestResistance, processComarcaResistance, processRebelArmies };
