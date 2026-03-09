const { Logger } = require('../utils/logger');
const CharacterModel = require('../models/CharacterModel');
const DynastyService = require('./DynastyService');
const GAME_CONFIG = require('../config/constants');
const pool = require('../../db');
const h3 = require('h3-js');

const { GUARD_MAX, GUARD_REGEN_PER_TURN, COMBAT_BUFF_BASE, COMBAT_BUFF_PER_LEVEL,
        DEATH_AGE_THRESHOLD, DEATH_CHANCE_PER_YEAR, DEFAULT_ABILITIES } = GAME_CONFIG.CHARACTERS;

class CharacterService {

    // ══════════════════════════════════════════════════════════════
    // CÁLCULOS (sin estado, sin BD)
    // ══════════════════════════════════════════════════════════════

    /**
     * Devuelve el % de bono de combate para un nivel dado.
     * Nivel 1 → 10%, Nivel 2 → 11%, ...
     */
    calcCombatBuff(level) {
        return COMBAT_BUFF_BASE + (level - 1) * COMBAT_BUFF_PER_LEVEL;
    }

    /**
     * Resuelve el título nobiliario + nombre del personaje.
     * "[Título Noble] [Nombre del Personaje]"
     */
    async resolveFullTitle(characterId) {
        const r = await pool.query(`
            SELECT c.name, c.id,
                   CASE WHEN p.gender = 'F' THEN nr.title_female ELSE nr.title_male END AS title
            FROM characters c
            JOIN players p ON c.player_id = p.player_id
            JOIN noble_ranks nr ON p.noble_rank_id = nr.id
            WHERE c.id = $1
        `, [characterId]);
        if (!r.rows[0]) return null;
        const { title, name } = r.rows[0];
        return `${title} ${name}`;
    }

    // ══════════════════════════════════════════════════════════════
    // PROCESOS DE TURNO (llamados desde turn_engine.js)
    // ══════════════════════════════════════════════════════════════

    /**
     * Envejece todos los personajes en 1 año y evalúa mortalidad.
     * Llamar una vez por turno (o diariamente según config del turn engine).
     */
    async processAging() {
        const aged = await CharacterModel.incrementAllAges();
        for (const char of aged) {
            if (char.age < DEATH_AGE_THRESHOLD) continue;
            const deathChance = (char.age - DEATH_AGE_THRESHOLD) * DEATH_CHANCE_PER_YEAR;
            if (Math.random() * 100 < deathChance) {
                await this._handleDeath(char);
            }
        }
    }

    /**
     * Regenera guardia personal de todos los personajes (+1/turno, máx 25).
     */
    async processGuardRegeneration() {
        await CharacterModel.regenerateAllGuards(GUARD_REGEN_PER_TURN, GUARD_MAX);
    }

    /**
     * Gestión atómica de la muerte de un personaje.
     */
    async _handleDeath(character) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Desasociar del ejército
            if (character.army_id) {
                await CharacterModel.clearArmyCommander(character.army_id);
            }

            // Sucesión si era el personaje principal
            if (character.is_main_character) {
                await DynastyService.handleSuccession(client, character.player_id, character.id);
            }

            // Eliminar el personaje (muerte permanente)
            await CharacterModel.delete(client, character.id);

            await client.query('COMMIT');
            Logger.action(
                `Personaje "${character.name}" (id=${character.id}) ha fallecido a los ${character.age} años.`,
                character.player_id
            );
        } catch (err) {
            await client.query('ROLLBACK');
            Logger.error(err, { context: 'CharacterService._handleDeath', characterId: character.id });
        } finally {
            client.release();
        }
    }

    // ══════════════════════════════════════════════════════════════
    // ENDPOINTS HTTP
    // ══════════════════════════════════════════════════════════════

    /**
     * GET /api/characters
     * Devuelve todos los personajes del jugador con buff calculado y título completo.
     */
    async GetMyCharacters(req, res) {
        try {
            const playerId = req.user.player_id;
            const characters = await CharacterModel.getByPlayer(playerId);

            const enriched = await Promise.all(characters.map(async c => ({
                ...c,
                combat_buff_pct: this.calcCombatBuff(c.level),
                full_title:      await this.resolveFullTitle(c.id),
            })));

            res.json({ success: true, characters: enriched });
        } catch (err) {
            Logger.error(err, { endpoint: 'GET /characters', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener personajes' });
        }
    }

    /**
     * GET /api/characters/:id
     * Detalle de un personaje propio.
     */
    async GetCharacter(req, res) {
        try {
            const playerId = req.user.player_id;
            const id = parseInt(req.params.id, 10);
            const character = await CharacterModel.getById(id);

            if (!character || character.player_id !== playerId) {
                return res.status(404).json({ success: false, message: 'Personaje no encontrado' });
            }

            res.json({
                success: true,
                character: {
                    ...character,
                    combat_buff_pct: this.calcCombatBuff(character.level),
                    full_title:      await this.resolveFullTitle(id),
                },
            });
        } catch (err) {
            Logger.error(err, { endpoint: 'GET /characters/:id', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener personaje' });
        }
    }

    /**
     * POST /api/characters/:id/procreate
     * Genera un descendiente del personaje indicado.
     * Body: { name }
     */
    async Procreate(req, res) {
        const playerId  = req.user.player_id;
        const parentId  = parseInt(req.params.id, 10);
        const { name }  = req.body;

        if (!name || name.trim().length < 2 || name.trim().length > 100) {
            return res.status(400).json({ success: false, message: 'Nombre inválido (2-100 caracteres)' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verificar que el padre pertenece al jugador
            const parentResult = await client.query(
                'SELECT * FROM characters WHERE id = $1 AND player_id = $2',
                [parentId, playerId]
            );
            if (!parentResult.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Personaje padre no encontrado' });
            }

            const child = await CharacterModel.create(client, {
                player_id:           playerId,
                name:                name.trim(),
                age:                 0,
                health:              100,
                level:               1,
                personal_guard:      0,
                is_heir:             false,
                is_main_character:   false,
                parent_character_id: parentId,
            });

            // Habilidades base
            for (const key of DEFAULT_ABILITIES) {
                await CharacterModel.upsertAbility(client, child.id, key, 1);
            }

            await client.query('COMMIT');
            Logger.action(`Descendiente "${child.name}" (id=${child.id}) nacido del personaje ${parentId}.`, playerId);
            res.json({ success: true, character: child });
        } catch (err) {
            await client.query('ROLLBACK');
            Logger.error(err, { endpoint: 'POST /characters/:id/procreate', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al generar descendiente' });
        } finally {
            client.release();
        }
    }

    /**
     * PUT /api/armies/:id/commander
     * Asigna o elimina el comandante de un ejército.
     * Body: { character_id } — usar null para retirar el comandante.
     */
    async AssignCommander(req, res) {
        const playerId  = req.user.player_id;
        const armyId    = parseInt(req.params.id, 10);
        const { character_id } = req.body;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verificar propiedad del ejército
            const armyResult = await client.query(
                'SELECT army_id FROM armies WHERE army_id = $1 AND player_id = $2',
                [armyId, playerId]
            );
            if (!armyResult.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Ejército no encontrado' });
            }

            // Retirar comandante
            if (character_id === null || character_id === undefined) {
                await CharacterModel.clearArmyCommander(armyId);
                await client.query('COMMIT');
                return res.json({ success: true, message: 'Comandante retirado del ejército' });
            }

            // Verificar propiedad del personaje
            const charResult = await client.query(
                'SELECT * FROM characters WHERE id = $1 AND player_id = $2',
                [character_id, playerId]
            );
            const character = charResult.rows[0];
            if (!character) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Personaje no encontrado' });
            }

            // No puede estar ya en otro ejército
            if (character.army_id !== null && character.army_id !== armyId) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'El personaje ya está asignado a otro ejército'
                });
            }

            await CharacterModel.assignToArmy(client, character_id, armyId);

            const buff = this.calcCombatBuff(character.level);
            await client.query('COMMIT');
            Logger.action(
                `${character.name} asignado como comandante del ejército ${armyId} (buff: +${buff}%)`, playerId
            );
            res.json({
                success:   true,
                buff_pct:  buff,
                commander: { id: character.id, name: character.name, level: character.level },
                message:   `${character.name} lidera el ejército con un bono de combate de +${buff}%`,
            });
        } catch (err) {
            await client.query('ROLLBACK');
            Logger.error(err, { endpoint: 'PUT /armies/:id/commander', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al asignar comandante' });
        } finally {
            client.release();
        }
    }

    /**
     * PATCH /api/characters/:id/heir
     * Designa a este personaje como heredero (deselecciona el anterior).
     */
    async SetHeir(req, res) {
        const playerId = req.user.player_id;
        const id       = parseInt(req.params.id, 10);
        try {
            // Verificar propiedad y que no sea el personaje principal
            const charResult = await pool.query(
                'SELECT * FROM characters WHERE id = $1 AND player_id = $2',
                [id, playerId]
            );
            const character = charResult.rows[0];
            if (!character) return res.status(404).json({ success: false, message: 'Personaje no encontrado' });
            if (character.is_main_character) {
                return res.status(400).json({ success: false, message: 'El personaje principal no puede ser su propio heredero' });
            }

            // Desmarcar heredero previo
            await pool.query(
                'UPDATE characters SET is_heir = FALSE WHERE player_id = $1 AND is_heir = TRUE',
                [playerId]
            );
            await pool.query('UPDATE characters SET is_heir = TRUE WHERE id = $1', [id]);

            Logger.action(`${character.name} designado heredero del jugador ${playerId}`, playerId);
            res.json({ success: true, message: `${character.name} ha sido designado heredero` });
        } catch (err) {
            Logger.error(err, { endpoint: 'PATCH /characters/:id/heir', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al designar heredero' });
        }
    }

    /**
     * PUT /api/characters/:id/move
     * Establece el destino de movimiento del personaje.
     * El personaje avanzará MOVEMENT_PER_TURN hexágonos por turno hasta llegar.
     * Body: { h3_index }
     */
    async MoveCharacter(req, res) {
        const playerId = req.user.player_id;
        const id       = parseInt(req.params.id, 10);
        const { h3_index } = req.body;

        if (!h3_index) {
            return res.status(400).json({ success: false, message: 'Falta el destino (h3_index)' });
        }

        try {
            const charResult = await pool.query(
                'SELECT * FROM characters WHERE id = $1 AND player_id = $2',
                [id, playerId]
            );
            const character = charResult.rows[0];
            if (!character) {
                return res.status(404).json({ success: false, message: 'Personaje no encontrado' });
            }

            // Verificar que el hex destino existe en el mapa
            const hexResult = await pool.query(
                'SELECT h3_index FROM h3_map WHERE h3_index = $1',
                [h3_index]
            );
            if (!hexResult.rows[0]) {
                return res.status(400).json({ success: false, message: 'Hex destino no válido' });
            }

            // Si el personaje no tiene posición aún, colocarlo en el destino directamente
            if (!character.h3_index) {
                await CharacterModel.updatePosition(null, id, h3_index);
                Logger.action(`Personaje ${id} ubicado en ${h3_index}`, playerId);
                return res.json({ success: true, h3_index, moving: false, message: 'Personaje ubicado en el destino' });
            }

            const dist = h3.gridDistance(character.h3_index, h3_index);
            const MAX_DISTANCE = GAME_CONFIG.MAP.MAX_MOVEMENT_DISTANCE;
            if (dist > MAX_DISTANCE) {
                return res.status(400).json({
                    success: false,
                    message: `Destino demasiado lejano (${dist} hexágonos, máximo ${MAX_DISTANCE})`
                });
            }

            await CharacterModel.setDestination(null, id, h3_index);

            // Calcular ruta completa para devolver al frontend (visualización)
            const path = h3.gridPathCells(character.h3_index, h3_index).slice(1);
            const turns = Math.ceil(dist / GAME_CONFIG.CHARACTERS.MOVEMENT_PER_TURN);

            Logger.action(`Personaje ${id} destino establecido: ${h3_index} (~${turns} turnos)`, playerId);
            res.json({
                success: true,
                destination: h3_index,
                moving: true,
                estimated_turns: turns,
                path,
                from: character.h3_index,
                message: `${character.name} se desplazará hacia el destino (~${turns} turno${turns !== 1 ? 's' : ''})`,
            });
        } catch (err) {
            Logger.error(err, { endpoint: 'PUT /characters/:id/move', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al mover personaje' });
        }
    }

    /**
     * DELETE /api/characters/:id/move
     * Cancela el movimiento del personaje (limpia destination).
     */
    async StopCharacter(req, res) {
        const playerId = req.user.player_id;
        const id       = parseInt(req.params.id, 10);
        try {
            const charResult = await pool.query(
                'SELECT id FROM characters WHERE id = $1 AND player_id = $2',
                [id, playerId]
            );
            if (!charResult.rows[0]) {
                return res.status(404).json({ success: false, message: 'Personaje no encontrado' });
            }

            await CharacterModel.setDestination(null, id, null);

            Logger.action(`Personaje ${id} detenido`, playerId);
            res.json({ success: true, message: 'Movimiento cancelado' });
        } catch (err) {
            Logger.error(err, { endpoint: 'DELETE /characters/:id/move', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al detener personaje' });
        }
    }

    /**
     * Procesa el movimiento de todos los personajes con destino pendiente.
     * Llamar una vez por turno desde turn_engine.js.
     * Avanza MOVEMENT_PER_TURN hexágonos por turno usando gridPathCells.
     */
    async processMovements() {
        const moving = await CharacterModel.getMoving();
        if (!moving.length) return;

        const stepsPerTurn = GAME_CONFIG.CHARACTERS.MOVEMENT_PER_TURN;

        for (const char of moving) {
            try {
                // Calcular ruta completa desde posición actual al destino
                const path = h3.gridPathCells(char.h3_index, char.destination);
                // path incluye el hex de origen, así que slice(1) para los pasos reales
                const steps = path.slice(1, stepsPerTurn + 1);

                if (!steps.length) {
                    // Ya está en destino
                    await CharacterModel.advancePosition(null, char.id, char.h3_index, true);
                    continue;
                }

                const newPos  = steps[steps.length - 1];
                const arrived = newPos === char.destination;

                await CharacterModel.advancePosition(null, char.id, newPos, arrived);

                Logger.action(
                    `Personaje ${char.id} avanzó a ${newPos}${arrived ? ' (llegó al destino)' : ''}`,
                    char.player_id
                );
            } catch (err) {
                Logger.error(err, { context: 'CharacterService.processMovements', characterId: char.id });
            }
        }
    }
}

module.exports = new CharacterService();
