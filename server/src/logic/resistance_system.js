const NotificationService = require('../services/NotificationService');
const { Logger } = require('../utils/logger');
const h3 = require('h3-js');

// ── Parámetros de rebelión ────────────────────────────────────────────────────
const CONQUEST_AFTERSHOCK    = 20;   // Shock por conquistar la capital de comarca
const AFTERSHOCK_DECAY_RATE  = 0.80; // 20 % del aftershock se disipa cada mes
const CULTURE_MISMATCH_INC   = 5;    // Resistencia extra mensual por desajuste cultural
const NATURAL_DECAY          = 2;    // Reducción natural mensual (mínimo 0)
const ARMY_DECAY_PER_UNIT    = 3;    // Reducción extra por cada ejército amigo en comarca
const REBELLION_THRESHOLD    = 100;  // Umbral que dispara la rebelión
const REBEL_ARMY_SIZE        = 500;  // Campesinos en armas al rebelarse
const RESISTANCE_AFTER_REBEL = 30;   // Resistencia residual tras rebelión (no vuelve a 0)

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
    if (!prevOwnerId) return;

    const indices = Array.isArray(h3Indices) ? h3Indices : [h3Indices];

    // Registrar propietario anterior
    await client.query(
        'UPDATE h3_map SET previous_player_id = $1 WHERE h3_index = ANY($2::text[])',
        [prevOwnerId, indices]
    );

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

        // Capital: +20; resto: +5 cada uno
        const aftershock = Math.min(100,
            (capitalConquered ? CONQUEST_AFTERSHOCK : 0) +
            countRes.rows[0].cnt * 5
        );

        await client.query(`
            INSERT INTO comarca_resistance (division_id, player_id, resistance, aftershock, updated_at)
            VALUES ($1, $2, 0, $3, NOW())
            ON CONFLICT (division_id, player_id)
            DO UPDATE SET
                aftershock = LEAST(100, comarca_resistance.aftershock + EXCLUDED.aftershock),
                updated_at = NOW()
        `, [row.division_id, newOwnerId, aftershock]);
    }
}

/**
 * Procesamiento mensual de resistencia (día 15 de cada mes de juego).
 * - Decae el aftershock
 * - Sube resistencia por desajuste cultural
 * - Baja resistencia por ejércitos amigos y decaimiento natural
 * - Dispara rebeliones cuando resistance + aftershock >= 100
 *
 * Debe llamarse DENTRO de una transacción activa.
 *
 * @param {Object} client    - pg client
 * @param {number} turn      - turno actual
 * @param {Date}   gameDate  - fecha del calendario de juego
 */
async function processComarcaResistance(client, turn, gameDate) {
    const gd = new Date(gameDate);
    if (gd.getDate() !== 15) return;

    const gYM = `${gd.getFullYear()}-${String(gd.getMonth() + 1).padStart(2, '0')}`;

    const lastRun = await client.query(
        `SELECT value FROM game_config WHERE "group" = 'system' AND key = 'last_resistance_month'`
    );
    if (lastRun.rows[0]?.value === gYM) {
        Logger.engine(`[TURN ${turn}] Comarca resistance skipped (already processed for ${gYM})`);
        return;
    }

    Logger.engine(`[TURN ${turn}] Processing comarca resistance — game month ${gYM}`);

    const resistances = await client.query(`
        SELECT cr.id, cr.division_id, cr.player_id,
               cr.resistance::float AS resistance,
               cr.aftershock::float AS aftershock,
               pd.name AS comarca_name,
               pd.capital_h3,
               p.culture_id AS owner_culture_id
        FROM comarca_resistance cr
        JOIN political_divisions pd ON pd.id = cr.division_id AND pd.player_id = cr.player_id
        JOIN players p ON p.player_id = cr.player_id
        WHERE cr.resistance + cr.aftershock > 0
    `);

    for (const row of resistances.rows) {
        try {
            let resistance = row.resistance;
            let aftershock = row.aftershock;

            // 1. Decaimiento del aftershock
            aftershock *= AFTERSHOCK_DECAY_RATE;
            if (aftershock < 0.5) aftershock = 0;

            // 2. Desajuste cultural: cultura dominante en comarca vs cultura del propietario
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

            // 5. Comprobación de umbral de rebelión
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

    await client.query(`
        INSERT INTO game_config ("group", key, value)
        VALUES ('system', 'last_resistance_month', $1)
        ON CONFLICT ("group", key) DO UPDATE SET value = EXCLUDED.value
    `, [gYM]);

    Logger.engine(`[TURN ${turn}] Comarca resistance processing completed.`);
}

// ── Disparo de rebelión ───────────────────────────────────────────────────────

async function triggerRebellion(client, divisionId, playerId, comarcaName, capitalH3, dominantCultureId, turn) {
    Logger.engine(`[TURN ${turn}] REBELLION in comarca ${divisionId} (${comarcaName}), owner: ${playerId}`);

    const fiefsRes = await client.query(
        `SELECT h3_index FROM territory_details WHERE division_id = $1`,
        [divisionId]
    );
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
        INSERT INTO armies (player_id, h3_index, name, is_rebel)
        VALUES (NULL, $1, 'Campesinos en Armas', TRUE)
        RETURNING army_id
    `, [spawnHex]);
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

module.exports = { addConquestResistance, processComarcaResistance };
