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
 * Se llama el día 15 de cada mes desde turn_engine.
 *
 * @param {Object} client       - Cliente PostgreSQL dentro de transacción
 * @param {number} currentTurn  - Turno actual
 * @param {number} currentMonth - Mes de juego actual (1-12)
 */
async function processCharacterLifecycle(client, currentTurn, currentMonth) {
    // Solo jugadores humanos no exiliados
    const playersResult = await client.query(`
        SELECT p.player_id, p.culture_id,
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

        // 2. Mayoría de edad: notificar al llegar a 16
        if (newAge === 16) {
            await NotificationService.createSystemNotification(
                player_id, 'Dinastía',
                `👑 **${char.name}** ha alcanzado la mayoría de edad y puede comandar ejércitos.`,
                currentTurn
            );
        }

        // 3. Muerte natural (solo adultos ≥ 50)
        const rate = getNaturalDeathRate(newAge);
        if (rate > 0 && Math.random() < rate) {
            await _handleNaturalDeath(client, player_id, char, currentTurn);
        }
    }

    // 4. Posible nacimiento (si está bajo el límite y hay personajes procesados hoy)
    if (characters.length > 0) {
        await _tryBirth(client, player, allAlive, currentTurn);
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

async function _tryBirth(client, player, characters, currentTurn) {
    const { player_id, culture_id, linaje } = player;

    const aliveCount = characters.length; // ya son solo los vivos
    const limit = await getCharacterLimit(client, player_id);

    if (aliveCount >= limit) return;

    // Debe haber al menos un adulto con al menos un hijo posible (padre conocido)
    const adults = characters.filter(c => c.age + 1 >= 18); // adultos tras envejecer
    if (adults.length === 0) return;

    // 40% de probabilidad de nacimiento
    if (Math.random() >= 0.40) return;

    // El padre es el líder o el adulto de mayor nivel
    const father = adults.find(c => c.is_main_character) ?? adults[0];

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
        h3_index:            null,
        birth_turn:          currentTurn,
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
