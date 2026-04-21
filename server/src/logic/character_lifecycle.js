'use strict';

/**
 * character_lifecycle.js
 *
 * Ciclo anual de los personajes: envejecimiento, muerte natural y nacimientos.
 * Se llama desde turn_engine una vez al año (dayOfYear === 1).
 *
 * Reglas:
 *  - Cada personaje envejece 1 año.
 *  - Se tira la probabilidad de muerte natural según la edad.
 *  - Si el jugador está bajo el límite de personajes y tiene un adulto vivo,
 *    hay un 40% de probabilidad de que nazca un nuevo niño.
 *  - Límite de personajes = 4 + noble_rank.level_order del jugador.
 */

const { Logger }              = require('../utils/logger');
const CharacterModel          = require('../models/CharacterModel');
const NotificationService     = require('../services/NotificationService');
const CharacterNameGenerator  = require('./CharacterNameGenerator');

// ── Probabilidad de muerte natural por tramo de edad ─────────────────────────
const NATURAL_DEATH_RATES = [
    { minAge: 90, rate: 0.65 },
    { minAge: 80, rate: 0.40 },
    { minAge: 70, rate: 0.20 },
    { minAge: 60, rate: 0.08 },
    { minAge: 50, rate: 0.02 },
];

function getNaturalDeathRate(age) {
    for (const { minAge, rate } of NATURAL_DEATH_RATES) {
        if (age >= minAge) return rate;
    }
    return 0;
}

// ── Límite de personajes ──────────────────────────────────────────────────────
const BASE_CHARACTER_LIMIT = 4;

async function getCharacterLimit(client, playerId) {
    const r = await client.query(`
        SELECT COALESCE(nr.level_order, 0) AS level_order
        FROM players p
        LEFT JOIN noble_ranks nr ON nr.id = p.noble_rank_id
        WHERE p.player_id = $1
    `, [playerId]);
    const levelOrder = r.rows[0]?.level_order ?? 0;
    return BASE_CHARACTER_LIMIT + levelOrder;
}

// ── Ciclo anual ───────────────────────────────────────────────────────────────

/**
 * Procesa los cumpleaños del mes actual: envejece a todos los personajes cuyo
 * birth_month coincide con el mes de juego actual.
 * Usa idempotencia en game_config para ejecutarse UNA VEZ por mes,
 * independientemente del día en que se llame.
 *
 * @param {Object} client       - Cliente PostgreSQL dentro de transacción
 * @param {number} currentTurn  - Turno actual
 * @param {number} currentMonth - Mes de juego actual (1-12)
 * @param {number} currentYear  - Año de juego actual
 */
async function processCharacterLifecycle(client, currentTurn, currentMonth, currentYear) {
    const idempotencyKey = `${currentYear}-${currentMonth}`;

    // Verificar si ya se procesó este mes
    const check = await client.query(`
        SELECT value FROM game_config
        WHERE "group" = 'system' AND key = 'last_lifecycle_month'
    `);
    if (check.rows[0]?.value === idempotencyKey) return;

    // Marcar como procesado
    await client.query(`
        INSERT INTO game_config ("group", key, value)
        VALUES ('system', 'last_lifecycle_month', $1)
        ON CONFLICT ("group", key) DO UPDATE SET value = $1
    `, [idempotencyKey]);

    Logger.action(`[CharacterLifecycle] Procesando mes ${idempotencyKey}`);

    // Solo jugadores humanos no exiliados
    const playersResult = await client.query(`
        SELECT p.player_id, p.culture_id, p.capital_h3,
               COALESCE(p.display_name, p.username) AS linaje
        FROM players p
        WHERE p.is_ai = FALSE AND (p.is_exiled = FALSE OR p.is_exiled IS NULL)
    `);

    for (const player of playersResult.rows) {
        await _processPlayerCharacters(client, player, currentTurn, currentMonth);
    }
}

async function _processPlayerCharacters(client, player, currentTurn, currentMonth) {
    const { player_id, culture_id, linaje } = player;

    const allAlive = await CharacterModel.getAllAliveByPlayer(client, player_id);

    // Solo los personajes que cumplen años este mes
    const characters = allAlive.filter(c => (c.birth_month ?? 1) === currentMonth);

    for (const char of characters) {
        // 1. Envejecer
        await CharacterModel.incrementAge(client, char.id);
        const newAge = char.age + 1;

        // 2. Mayoría de edad: posicionar en capital y notificar al llegar a 16
        if (newAge === 16) {
            if (player.capital_h3) {
                await client.query(
                    'UPDATE characters SET h3_index = $1 WHERE id = $2',
                    [player.capital_h3, char.id]
                );
            }
            await NotificationService.createSystemNotification(
                player_id, 'Dinastía',
                `👑 **${char.name}** ha alcanzado la mayoría de edad y puede comandar ejércitos.`,
                currentTurn
            );
        }

        // 3. Nacimiento forzado al llegar a 40 sin hijos vivos
        if (newAge === 40 && char.is_main_character) {
            const hasChildren = allAlive.some(c => c.parent_character_id === char.id);
            if (!hasChildren) {
                await _tryBirth(client, player, allAlive, currentTurn, true);
            }
        }

        // 4. Muerte natural (solo adultos ≥ 50)
        const rate = getNaturalDeathRate(newAge);
        if (rate > 0 && Math.random() < rate) {
            await _handleNaturalDeath(client, player_id, char, currentTurn);
        }
    }

    // 5. Posible nacimiento (si está bajo el límite y hay personajes procesados hoy)
    if (characters.length > 0) {
        await _tryBirth(client, player, allAlive, currentTurn, false);
    }
}

async function _handleNaturalDeath(client, player_id, char, currentTurn) {
    await CharacterModel.killCharacter(client, char.id);

    Logger.action(`[CharacterLifecycle] Muerte natural: ${char.name} (id=${char.id}, age=${char.age + 1}), player=${player_id}`);

    await NotificationService.createSystemNotification(
        player_id, 'Dinastía',
        `⚰️ **${char.name}** ha fallecido de muerte natural a los ${char.age + 1} años.`,
        currentTurn
    );

    // Sucesión automática
    if (char.is_main_character) {
        const newLeader = await CharacterModel.promoteHeirToLeader(client, player_id);
        if (newLeader) {
            await NotificationService.createSystemNotification(
                player_id, 'Dinastía',
                `👑 **${newLeader.name}** asume el liderazgo de la facción.`,
                currentTurn
            );
            // Asignar nuevo heredero entre los adultos restantes
            const newHeir = await CharacterModel.assignBestAsHeir(client, player_id);
            if (newHeir) {
                await NotificationService.createSystemNotification(
                    player_id, 'Dinastía',
                    `🔱 **${newHeir.name}** es designado nuevo heredero.`,
                    currentTurn
                );
            } else {
                await NotificationService.createSystemNotification(
                    player_id, 'Dinastía',
                    `⚠️ **Crisis dinástica**: no hay adultos disponibles para ser heredero.`,
                    currentTurn
                );
            }
        } else {
            // Sin heredero
            const bestAdult = await CharacterModel.assignBestAsHeir(client, player_id);
            if (bestAdult) {
                // Promoverlo directamente a líder
                await client.query(
                    'UPDATE characters SET is_heir = FALSE, is_main_character = TRUE WHERE id = $1',
                    [bestAdult.id]
                );
                await NotificationService.createSystemNotification(
                    player_id, 'Dinastía',
                    `👑 **${bestAdult.name}** asume el liderazgo ante la ausencia de heredero.`,
                    currentTurn
                );
            } else {
                await NotificationService.createSystemNotification(
                    player_id, 'Dinastía',
                    `☠️ **Crisis dinástica grave**: no hay adultos para liderar la facción.`,
                    currentTurn
                );
            }
        }
    } else if (char.is_heir) {
        const newHeir = await CharacterModel.assignBestAsHeir(client, player_id);
        if (newHeir) {
            await NotificationService.createSystemNotification(
                player_id, 'Dinastía',
                `🔱 **${newHeir.name}** pasa a ser el nuevo heredero.`,
                currentTurn
            );
        } else {
            await NotificationService.createSystemNotification(
                player_id, 'Dinastía',
                `⚠️ No hay adultos disponibles para ser heredero.`,
                currentTurn
            );
        }
    }
}

async function _tryBirth(client, player, characters, currentTurn, forced = false) {
    const { player_id, culture_id, linaje, capital_h3 } = player;

    const aliveCount = characters.length;

    // Debe haber al menos un adulto
    const adults = characters.filter(c => c.age >= 18);
    if (adults.length === 0) return;

    // El líder del linaje
    const leader = adults.find(c => c.is_main_character) ?? adults[0];

    // Contar hijos directos del líder
    const leaderDirectChildren = characters.filter(c => c.parent_character_id === leader.id);

    // A partir del 4º hijo el nacimiento se asigna a un hijo adulto (nieto del líder)
    let father = leader;
    if (leaderDirectChildren.length >= 3) {
        const adultChildren = leaderDirectChildren.filter(c => c.age >= 18);
        if (adultChildren.length > 0) {
            // Elegir hijo adulto al azar que no tenga ya 2 menores
            const eligible = adultChildren.filter(c => {
                const minors = characters.filter(g => g.age < 16 && g.parent_character_id === c.id);
                return minors.length < 2;
            });
            if (eligible.length > 0) {
                father = eligible[Math.floor(Math.random() * eligible.length)];
            } else {
                return; // Todos los hijos adultos tienen ya 2 menores
            }
        }
        // Si no hay hijos adultos aún, el líder sigue siendo el padre (seguirá teniendo hijos hasta que los haya)
    }

    // Personajes entre 25-40 pueden tener un hijo aunque se haya alcanzado el límite global
    const fatherInFertileAge = father.age >= 25 && father.age <= 40;
    if (!fatherInFertileAge) {
        const limit = await getCharacterLimit(client, player_id);
        if (aliveCount >= limit) return;
    }

    // Límite: máximo 2 hijos menores de edad por padre
    const minorChildren = characters.filter(c => c.age < 16 && c.parent_character_id === father.id);
    if (minorChildren.length >= 2) return;

    // Regla del abuelo: solo aplica al líder (los hijos adultos pueden tener hijos aunque el líder sea abuelo)
    if (father.id === leader.id) {
        const leaderAliveChildren = characters.filter(c => c.parent_character_id === leader.id);
        const isGrandfather = leaderAliveChildren.some(child =>
            characters.some(c => c.parent_character_id === child.id)
        );
        if (isGrandfather) return;
    }

    // Probabilidad de nacimiento (el forzado la omite)
    if (!forced && Math.random() >= 0.40) return;

    const childGender = Math.random() < 0.5 ? 'M' : 'F';
    const childAge    = 0;
    const childName   = CharacterNameGenerator.generate(culture_id, childGender, linaje);

    const child = await CharacterModel.create(client, {
        player_id,
        name:                childName,
        age:                 childAge,
        health:              100,
        level:               10,
        personal_guard:      0,
        is_main_character:   false,
        is_heir:             false,
        parent_character_id: father.id,
        h3_index:            capital_h3 ?? null,
        birth_turn:          currentTurn,
        gender:              childGender,
        xp:                  0,
    });

    Logger.action(`[CharacterLifecycle] Nacimiento: ${childName} (id=${child.id}), padre=${father.name}, player=${player_id}`);

    await NotificationService.createSystemNotification(
        player_id, 'Dinastía',
        `🍼 Ha nacido **${childName}**, ${childGender === 'M' ? 'hijo' : 'hija'} de **${father.name}**.`,
        currentTurn
    );
}

module.exports = { processCharacterLifecycle };

