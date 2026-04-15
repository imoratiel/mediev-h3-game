const { Logger } = require('../utils/logger');
const CharacterModel = require('../models/CharacterModel');
const ArmyModel = require('../models/ArmyModel');
const WorkerModel = require('../models/WorkerModel');
const DynastyService = require('./DynastyService');
const NotificationService = require('./NotificationService');
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
        // Nivel mostrado = floor(level / 10), rango 0-10.
        // Bonus = nivel_mostrado * 2% (máximo +20% a nivel 100).
        return Math.floor(level / 10) * 2;
    }

    /**
     * Resuelve el título nobiliario + nombre del personaje.
     * "[Título Noble] [Nombre del Personaje]"
     */
    async resolveFullTitle(characterId) {
        const r = await pool.query(`
            SELECT c.name, c.is_main_character,
                   CASE WHEN p.gender = 'F' THEN nr.title_female ELSE nr.title_male END AS title
            FROM characters c
            JOIN players p ON c.player_id = p.player_id
            JOIN noble_ranks nr ON p.noble_rank_id = nr.id
            WHERE c.id = $1
        `, [characterId]);
        if (!r.rows[0]) return null;
        const { title, name, is_main_character } = r.rows[0];
        // Solo el líder (is_main_character) lleva el título nobiliario
        return is_main_character && title ? `${title} ${name}` : name;
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
     *
     * @param {object}  character     - Fila de la tabla characters
     * @param {boolean} diedInCombat  - TRUE si murió en combate (dispara cascade devotio)
     */
    async _handleDeath(character, diedInCombat = false) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Turno actual (necesario para eventos de relaciones)
            const { rows: ws } = await client.query('SELECT current_turn FROM world_state WHERE id = 1');
            const currentTurn = ws[0]?.current_turn ?? 0;

            // Desasociar del ejército
            if (character.army_id) {
                await CharacterModel.clearArmyCommander(character.army_id);
            }

            // Sucesión si era el personaje principal
            if (character.is_main_character) {
                await DynastyService.handleSuccession(client, character.player_id, character.id, currentTurn);

                // Cascade de devotio: solo si murió en combate
                if (diedInCombat) {
                    const RelationService = require('./RelationService.js');
                    await RelationService.onMainCharacterDeath(client, character.player_id, currentTurn);
                }
            } else if (character.is_heir) {
                // Si muere el heredero, auto-asignar el siguiente adulto
                await DynastyService.handleHeirDeath(client, character.player_id, character.id, currentTurn);
            }

            // Eliminar el personaje (muerte permanente)
            await CharacterModel.delete(client, character.id);

            await client.query('COMMIT');
            Logger.action(
                `Personaje "${character.name}" (id=${character.id}) ha fallecido a los ${character.age} años${diedInCombat ? ' en combate' : ''}.`,
                character.player_id
            );
        } catch (err) {
            await client.query('ROLLBACK');
            Logger.error(err, { context: 'CharacterService._handleDeath', characterId: character.id, diedInCombat });
        } finally {
            client.release();
        }
    }

    /**
     * Mata a un personaje en combate (llamar desde la resolución de combate).
     * Dispara cascade de devotio si era el main_character del jugador.
     *
     * @param {number} characterId
     */
    async killInCombat(characterId) {
        const { rows } = await pool.query('SELECT * FROM characters WHERE id = $1', [characterId]);
        const character = rows[0];
        if (!character) return;
        await this._handleDeath(character, true);
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
     * GET /api/characters/me/profile
     * Ficha del personaje principal del jugador autenticado.
     */
    async GetMyCharacterProfile(req, res) {
        try {
            const playerId = req.user.player_id;
            const mainChar = await pool.query(
                'SELECT id FROM characters WHERE player_id = $1 AND is_main_character = TRUE AND health > 0 LIMIT 1',
                [playerId]
            );
            if (!mainChar.rows[0]) {
                return res.status(404).json({ success: false, message: 'Sin personaje principal' });
            }
            // Delegate to GetCharacterProfile logic by temporarily overriding params
            req.params = { ...req.params, id: String(mainChar.rows[0].id) };
            return this.GetCharacterProfile(req, res);
        } catch (err) {
            Logger.error(err, { endpoint: 'GET /characters/me/profile', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener perfil del personaje' });
        }
    }

    /**
     * GET /api/characters/:id/profile
     * Ficha completa: datos base + linaje ascendente + hijos + stats del reino.
     */
    async GetCharacterProfile(req, res) {
        try {
            const playerId = req.user.player_id;
            const id = parseInt(req.params.id, 10);

            // 1. Character base + player info
            const charResult = await pool.query(`
                SELECT
                    c.*,
                    json_agg(
                        json_build_object('ability_key', ca.ability_key, 'level', ca.level)
                    ) FILTER (WHERE ca.id IS NOT NULL) AS abilities,
                    p.last_name            AS dynasty,
                    p.gender               AS player_gender,
                    p.color                AS player_color,
                    cu.name                AS culture_name,
                    CASE WHEN p.gender = 'F' THEN nr.title_female ELSE nr.title_male END AS noble_rank_title,
                    (SELECT COUNT(*)::int FROM political_divisions WHERE player_id = c.player_id) AS division_count,
                    (SELECT COUNT(*)::int FROM h3_map WHERE player_id = c.player_id)              AS fief_count
                FROM characters c
                JOIN players p ON p.player_id = c.player_id
                LEFT JOIN cultures cu ON cu.id = p.culture_id
                LEFT JOIN noble_ranks nr ON nr.id = p.noble_rank_id
                LEFT JOIN character_abilities ca ON ca.character_id = c.id
                WHERE c.id = $1
                GROUP BY c.id, p.last_name, p.gender, p.color, cu.name,
                         nr.title_male, nr.title_female
            `, [id]);

            const char = charResult.rows[0];
            if (!char || char.player_id !== playerId) {
                return res.status(404).json({ success: false, message: 'Personaje no encontrado' });
            }

            // 2. Children
            const childrenResult = await pool.query(`
                SELECT id, name, age, health, is_heir, is_main_character
                FROM characters
                WHERE parent_character_id = $1 AND health > 0
                ORDER BY age DESC
            `, [id]);

            // 3. Ancestors (walk parent chain, up to 3 levels)
            const ancestors = [];
            let nextParentId = char.parent_character_id;
            while (nextParentId && ancestors.length < 3) {
                const ancRow = await pool.query(
                    'SELECT id, name, age, health, parent_character_id FROM characters WHERE id = $1',
                    [nextParentId]
                );
                const anc = ancRow.rows[0];
                if (!anc) break;
                ancestors.unshift({ id: anc.id, name: anc.name, age: anc.age, is_alive: anc.health > 0 });
                nextParentId = anc.parent_character_id;
            }

            res.json({
                success: true,
                character: {
                    ...char,
                    abilities:        char.abilities ?? [],
                    combat_buff_pct:  this.calcCombatBuff(char.level),
                    display_level:    Math.floor((char.level ?? 1) / 10),
                    children:         childrenResult.rows,
                    ancestors,
                },
            });
        } catch (err) {
            Logger.error(err, { endpoint: 'GET /characters/:id/profile', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener ficha del personaje' });
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
                level:               10,
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
     * POST /api/characters/adopt
     * Adopta un niño (crea un personaje de edad 0-8 sin padre biológico).
     * Solo disponible si el jugador tiene menos de 3 personajes vivos.
     * Body: { name? }  — si no se da nombre, se genera automáticamente.
     */
    async Adopt(req, res) {
        const playerId = req.user.player_id;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Contar adultos vivos (age >= 16)
            const { rows: adultRows } = await client.query(
                `SELECT COUNT(*)::int AS cnt FROM characters
                 WHERE player_id = $1 AND health > 0 AND is_captive = FALSE AND age >= 16`,
                [playerId]
            );
            const adultCount = adultRows[0]?.cnt ?? 0;
            if (adultCount >= 3) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'Solo puedes adoptar si tienes menos de 3 personajes adultos.'
                });
            }

            const { rows: ws } = await client.query('SELECT current_turn FROM world_state WHERE id = 1');
            const currentTurn = ws[0]?.current_turn ?? 0;

            // Datos del jugador (cultura + linaje para nombre)
            const { rows: pr } = await client.query(
                'SELECT culture_id, display_name, username FROM players WHERE player_id = $1',
                [playerId]
            );
            const playerRow = pr[0];
            const cultureId = playerRow?.culture_id ?? null;
            const linaje    = playerRow?.display_name ?? playerRow?.username ?? '';

            const gender    = Math.random() < 0.5 ? 'M' : 'F';
            const age       = 16 + Math.floor(Math.random() * 20); // 16-35 años
            let   adoptName = (req.body?.name ?? '').trim();
            if (!adoptName) {
                const CharacterNameGenerator = require('../logic/CharacterNameGenerator');
                adoptName = CharacterNameGenerator.generate(cultureId, gender, linaje);
            } else if (!adoptName.includes(' ')) {
                // Si solo dan el nombre de pila, añadir el linaje
                adoptName = `${adoptName} ${linaje}`;
            }

            // Obtener capital del jugador para posicionar al adoptado
            const { rows: capRows } = await client.query(
                'SELECT capital_h3 FROM players WHERE player_id = $1', [playerId]
            );
            const capital_h3 = capRows[0]?.capital_h3 ?? null;

            const adopted = await CharacterModel.create(client, {
                player_id:           playerId,
                name:                adoptName,
                age,
                health:              100,
                level:               10,
                personal_guard:      0,
                is_heir:             false,
                is_main_character:   false,
                parent_character_id: null,
                h3_index:            capital_h3,
                birth_turn:          currentTurn - age * 365,
                xp:                  0,
            });

            await client.query('COMMIT');
            Logger.action(`Jugador ${playerId} adoptó a "${adopted.name}" (id=${adopted.id}, edad=${age}).`, playerId);
            res.json({ success: true, character: adopted });
        } catch (err) {
            await client.query('ROLLBACK');
            Logger.error(err, { endpoint: 'POST /characters/adopt', userId: playerId });
            res.status(500).json({ success: false, message: 'Error al adoptar' });
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

    /**
     * GET /api/characters/visible
     * Devuelve personajes enemigos autónomos visibles dentro del rango de detección
     * del jugador (ejércitos + feudos + personajes propios), igual que la niebla de guerra
     * aplicada a ejércitos. No incluye personajes en ejércitos (ya cubiertos por las tropas).
     */
    async GetVisibleCharacters(req, res) {
        try {
            const playerId = req.user.player_id;

            const [ownArmyVision, ownFiefPositions, ownCharPositions, workerPositions, fleetPositions] = await Promise.all([
                ArmyModel.GetPlayerArmiesWithDetection(playerId),
                ArmyModel.GetPlayerFiefPositions(playerId),
                CharacterModel.getStandalonePositions(playerId),
                WorkerModel.GetPlayerWorkerPositions(playerId),
                ArmyModel.GetPlayerFleetPositions(playerId),
            ]);

            const fiefRange = GAME_CONFIG.MILITARY.FIEF_DETECTION_RANGE;
            const charRange = GAME_CONFIG.CHARACTERS.DETECTION_RANGE;
            const FLEET_DETECTION_RANGE = 10;
            const visibleHexes = new Set();

            for (const army of ownArmyVision) {
                h3.gridDisk(army.h3_index, army.detection_range).forEach(hex => visibleHexes.add(hex));
            }
            for (const fiefH3 of ownFiefPositions) {
                h3.gridDisk(fiefH3, fiefRange).forEach(hex => visibleHexes.add(hex));
            }
            for (const charH3 of ownCharPositions) {
                h3.gridDisk(charH3, charRange).forEach(hex => visibleHexes.add(hex));
            }
            for (const w of workerPositions) {
                h3.gridDisk(w.h3_index, w.detection_range).forEach(hex => visibleHexes.add(hex));
            }
            for (const fleetH3 of fleetPositions) {
                h3.gridDisk(fleetH3, FLEET_DETECTION_RANGE).forEach(hex => visibleHexes.add(hex));
            }

            const characters = await CharacterModel.getEnemyCharactersAtHexes(playerId, [...visibleHexes]);
            res.json({ success: true, characters });
        } catch (err) {
            Logger.error(err, { endpoint: 'GET /characters/visible', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener personajes visibles' });
        }
    }

    /**
     * POST /api/characters/:id/capture
     * Captura a un personaje enemigo autónomo cuando uno de los ejércitos del jugador
     * está en el mismo feudo. No requiere combate previo.
     */
    async CaptureCharacter(req, res) {
        const playerId   = req.user.player_id;
        const characterId = parseInt(req.params.id, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Cargar el personaje objetivo
            const charResult = await client.query(
                `SELECT c.id, c.name, c.level, c.player_id, c.army_id, c.is_captive, c.h3_index,
                        p.username AS owner_name
                 FROM characters c
                 JOIN players p ON p.player_id = c.player_id
                 WHERE c.id = $1`,
                [characterId]
            );
            if (!charResult.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Personaje no encontrado.' });
            }
            const char = charResult.rows[0];

            // 2. Validaciones
            if (char.player_id === playerId) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'No puedes capturar a tu propio personaje.' });
            }
            if (char.is_captive) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Este personaje ya está cautivo.' });
            }
            if (char.army_id) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Este personaje está integrado en un ejército y no puede ser capturado directamente.' });
            }
            if (!char.h3_index) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El personaje no tiene posición en el mapa.' });
            }

            // 3. Verificar que el jugador tiene un ejército en el mismo feudo (sin movimiento activo)
            const armyResult = await client.query(
                `SELECT army_id FROM armies
                 WHERE player_id = $1 AND h3_index = $2 AND destination IS NULL
                 LIMIT 1`,
                [playerId, char.h3_index]
            );
            if (!armyResult.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Necesitas un ejército en el mismo territorio para capturar este personaje.' });
            }
            const capturingArmyId = armyResult.rows[0].army_id;

            // 4. Ejecutar captura
            await CharacterModel.setCaptive(client, characterId, capturingArmyId, char.level);

            await client.query('COMMIT');

            Logger.action(
                `[CAPTURA] ${char.name} (jugador ${char.owner_name}) capturado por ejército ${capturingArmyId} del jugador ${playerId}`,
                playerId
            );

            res.json({ success: true, message: `${char.name} ha sido capturado.`, army_id: capturingArmyId });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: 'POST /characters/:id/capture', userId: playerId, characterId });
            res.status(500).json({ success: false, message: 'Error al capturar el personaje.' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/characters/:id/attempt-capture
     * Intento de captura con combate de guardia personal.
     * Body: { attackerArmyId }
     */
    async AttemptCapture(req, res) {
        const playerId    = req.user.player_id;
        const characterId = parseInt(req.params.id, 10);
        const { attackerArmyId } = req.body ?? {};

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL lock_timeout = '8000ms'");

            // 1. Cargar personaje objetivo
            const charResult = await client.query(
                `SELECT c.id, c.name, c.level, c.age, c.player_id, c.army_id,
                        c.is_captive, c.is_imprisoned, c.h3_index, c.personal_guard,
                        c.capture_cooldown, p.capital_h3
                 FROM characters c
                 JOIN players p ON p.player_id = c.player_id
                 WHERE c.id = $1`,
                [characterId]
            );
            if (!charResult.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Personaje no encontrado.' });
            }
            const char = charResult.rows[0];

            // 2. Validaciones
            if (char.player_id === playerId) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'No puedes capturar a tu propio personaje.' });
            }
            if (char.age < 16) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Los menores no pueden ser capturados.' });
            }
            if (char.is_captive || char.is_imprisoned) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Este personaje ya está cautivo o encarcelado.' });
            }
            if ((char.capture_cooldown ?? 0) > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: `Debes esperar ${char.capture_cooldown} turno(s) antes de intentarlo de nuevo.` });
            }

            // 3. Verificar ejército atacante en el mismo hex, sin movimiento activo.
            // Si el cliente envió attackerArmyId se filtra por ese; si no, se usa cualquiera del jugador.
            const armyResult = await client.query(
                `SELECT a.army_id, pl.culture_id,
                        COALESCE(SUM(t.quantity), 0)::int AS troop_count
                 FROM armies a
                 JOIN players pl ON pl.player_id = a.player_id
                 LEFT JOIN troops t ON t.army_id = a.army_id
                 WHERE a.player_id = $1
                   AND a.h3_index = $2 AND a.destination IS NULL
                   AND ($3::int IS NULL OR a.army_id = $3)
                 GROUP BY a.army_id, pl.culture_id
                 LIMIT 1`,
                [playerId, char.h3_index, attackerArmyId ?? null]
            );
            if (!armyResult.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Necesitas un ejército estacionado en el mismo territorio.' });
            }
            const { army_id: foundArmyId, troop_count, culture_id } = armyResult.rows[0];

            // 4. Turno actual para notificaciones
            const turnResult = await client.query(
                `SELECT value FROM game_config WHERE "group" = 'game' AND key = 'current_turn'`
            );
            const currentTurn = parseInt(turnResult.rows[0]?.value ?? '0');

            // 5. Roll de muerte (3%)
            if (Math.random() < 0.03) {
                await CharacterModel.killCharacter(client, char.id);
                await NotificationService.createSystemNotification(
                    char.player_id, 'Captura',
                    `☠️ **${char.name}** ha muerto durante el intento de captura enemigo.`,
                    currentTurn
                );
                await NotificationService.createSystemNotification(
                    playerId, 'Captura',
                    `☠️ **${char.name}** ha muerto durante el intento de captura.`,
                    currentTurn
                );
                await client.query('COMMIT');
                Logger.action(`[CAPTURA] ${char.name} murió en intento de captura por ejército ${attackerArmyId}`, playerId);
                return res.json({ success: true, result: 'dead', message: `${char.name} ha muerto en el intento de captura.` });
            }

            // 6. Combate de guardia personal
            const guard = char.personal_guard ?? 0;
            if (guard > 0) {
                // Obtener stats de la unidad de guardia de la cultura atacante
                const unitResult = await client.query(
                    `SELECT ut.attack FROM cultures c
                     JOIN unit_types ut ON ut.unit_type_id = c.guard_unit_type_id
                     WHERE c.id = $1`,
                    [culture_id]
                );
                const attackPerUnit = unitResult.rows[0]?.attack ?? 15;

                const attackerPower = troop_count * attackPerUnit;
                const defenderPower = guard * 22; // Guardia personal: stats de élite

                const guardDefeated = attackerPower > defenderPower;

                if (!guardDefeated) {
                    // Cooldown: debe esperar 1 turno
                    await client.query(
                        'UPDATE characters SET capture_cooldown = 1 WHERE id = $1',
                        [char.id]
                    );
                    await client.query('COMMIT');
                    return res.json({
                        success: true, result: 'failed',
                        message: `La guardia personal de ${char.name} ha resistido el ataque.`
                    });
                }

                // Reducir guardia del personaje (bajas proporcionales)
                const guardLoss = Math.max(1, Math.floor(guard * 0.5));
                await client.query(
                    'UPDATE characters SET personal_guard = GREATEST(0, personal_guard - $1) WHERE id = $2',
                    [guardLoss, char.id]
                );
            }

            // 7. Roll de captura (guardia derrotada o sin guardia)
            let captureChance;
            if (troop_count > 100) captureChance = 0.40;
            else if (troop_count > 10) captureChance = 0.10;
            else captureChance = 0;

            if (captureChance === 0 || Math.random() > captureChance) {
                await client.query(
                    'UPDATE characters SET capture_cooldown = 1 WHERE id = $1',
                    [char.id]
                );
                await client.query('COMMIT');
                return res.json({
                    success: true, result: 'failed',
                    message: `${char.name} ha conseguido evitar la captura.`
                });
            }

            // 8. Captura exitosa
            await CharacterModel.setCaptive(client, char.id, foundArmyId, char.level);
            await NotificationService.createSystemNotification(
                char.player_id, 'Captura',
                `⛓️ **${char.name}** ha sido capturado por el enemigo.`,
                currentTurn
            );
            await NotificationService.createSystemNotification(
                playerId, 'Captura',
                `⛓️ Has capturado a **${char.name}**.`,
                currentTurn
            );

            await client.query('COMMIT');
            Logger.action(`[CAPTURA] ${char.name} capturado por ejército ${attackerArmyId} del jugador ${playerId}`, playerId);
            return res.json({ success: true, result: 'captured', message: `${char.name} ha sido capturado.` });

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            const msg = err.code === '55P03'
                ? 'El sistema está ocupado. Intenta de nuevo en unos segundos.'
                : 'Error al procesar el intento de captura.';
            Logger.error(err, { endpoint: 'POST /characters/:id/attempt-capture', userId: playerId, characterId });
            return res.status(500).json({ success: false, message: msg });
        } finally {
            client.release();
        }
    }

    /**
     * DELETE /api/characters/:id/execute
     * El captor ejecuta al personaje cautivo.
     */
    async Execute(req, res) {
        const playerId    = req.user.player_id;
        const characterId = parseInt(req.params.id, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const charResult = await client.query(
                `SELECT c.id, c.name, c.player_id, c.is_captive, c.captured_by_army_id,
                        a.player_id AS captor_player_id
                 FROM characters c
                 LEFT JOIN armies a ON a.army_id = c.captured_by_army_id
                 WHERE c.id = $1`,
                [characterId]
            );
            const char = charResult.rows[0];
            if (!char || !char.is_captive) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El personaje no está cautivo.' });
            }
            if (char.captor_player_id !== playerId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No eres el captor de este personaje.' });
            }

            const turnResult = await client.query(
                `SELECT value FROM game_config WHERE "group" = 'game' AND key = 'current_turn'`
            );
            const currentTurn = parseInt(turnResult.rows[0]?.value ?? '0');

            await CharacterModel.killCharacter(client, char.id);
            // Cancelar solicitudes de rescate pendientes
            await client.query(
                `UPDATE ransom_requests SET status = 'cancelled', resolved_at = NOW()
                 WHERE character_id = $1 AND status = 'pending'`,
                [char.id]
            );

            await NotificationService.createSystemNotification(
                char.player_id, 'Captura',
                `☠️ **${char.name}** ha sido ejecutado por el enemigo.`,
                currentTurn
            );

            await client.query('COMMIT');
            Logger.action(`[EJECUCION] ${char.name} ejecutado por jugador ${playerId}`, playerId);
            return res.json({ success: true, message: `${char.name} ha sido ejecutado.` });

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: 'DELETE /characters/:id/execute', userId: playerId, characterId });
            return res.status(500).json({ success: false, message: 'Error al ejecutar el personaje.' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/characters/:id/ransom
     * El captor solicita rescate (o actualiza la cantidad existente).
     * Body: { amount }
     */
    async RequestRansom(req, res) {
        const playerId    = req.user.player_id;
        const characterId = parseInt(req.params.id, 10);
        const amount      = parseInt(req.body.amount, 10);

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'El rescate debe ser mayor que 0.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const charResult = await client.query(
                `SELECT c.id, c.name, c.player_id, c.is_captive, c.captured_by_army_id,
                        a.player_id AS captor_player_id
                 FROM characters c
                 LEFT JOIN armies a ON a.army_id = c.captured_by_army_id
                 WHERE c.id = $1`,
                [characterId]
            );
            const char = charResult.rows[0];
            if (!char || !char.is_captive) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El personaje no está cautivo.' });
            }
            if (char.captor_player_id !== playerId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No eres el captor.' });
            }

            // Cancelar solicitudes previas del mismo personaje
            await client.query(
                `UPDATE ransom_requests SET status = 'cancelled', resolved_at = NOW()
                 WHERE character_id = $1 AND status = 'pending'`,
                [char.id]
            );

            // Crear nueva solicitud
            const insertResult = await client.query(
                `INSERT INTO ransom_requests (character_id, captor_player_id, owner_player_id, amount)
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [char.id, playerId, char.player_id, amount]
            );

            const turnResult = await client.query(
                `SELECT value FROM game_config WHERE "group" = 'game' AND key = 'current_turn'`
            );
            const currentTurn = parseInt(turnResult.rows[0]?.value ?? '0');

            await NotificationService.createSystemNotification(
                char.player_id, 'Captura',
                `💰 El enemigo solicita un rescate de **${amount.toLocaleString('es-ES')} oro** por **${char.name}**.`,
                currentTurn
            );

            await client.query('COMMIT');
            return res.json({ success: true, message: 'Solicitud de rescate enviada.', ransom_id: insertResult.rows[0].id });

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: 'POST /characters/:id/ransom', userId: playerId, characterId });
            return res.status(500).json({ success: false, message: 'Error al solicitar rescate.' });
        } finally {
            client.release();
        }
    }

    /**
     * DELETE /api/characters/:id/ransom
     * El captor cancela la solicitud de rescate activa.
     */
    async CancelRansom(req, res) {
        const playerId    = req.user.player_id;
        const characterId = parseInt(req.params.id, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `UPDATE ransom_requests SET status = 'cancelled', resolved_at = NOW()
                 WHERE character_id = $1 AND captor_player_id = $2 AND status = 'pending'
                 RETURNING id`,
                [characterId, playerId]
            );

            await client.query('COMMIT');

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'No hay solicitud de rescate activa para cancelar.' });
            }
            return res.json({ success: true, message: 'Solicitud de rescate cancelada.' });

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: 'DELETE /characters/:id/ransom', userId: playerId, characterId });
            return res.status(500).json({ success: false, message: 'Error al cancelar el rescate.' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/ransom-requests/:id/pay
     * El propietario paga el rescate para liberar a su personaje.
     */
    async PayRansom(req, res) {
        const playerId  = req.user.player_id;
        const ransomId  = parseInt(req.params.id, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL lock_timeout = '8000ms'");

            const rResult = await client.query(
                `SELECT r.*, c.name AS char_name, c.player_id AS char_owner,
                        p.capital_h3
                 FROM ransom_requests r
                 JOIN characters c ON c.id = r.character_id
                 JOIN players p ON p.player_id = r.owner_player_id
                 WHERE r.id = $1 AND r.status = 'pending'`,
                [ransomId]
            );
            const ransom = rResult.rows[0];
            if (!ransom) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Solicitud de rescate no encontrada o ya resuelta.' });
            }
            if (ransom.owner_player_id !== playerId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Esta solicitud no es para ti.' });
            }

            // Verificar oro suficiente
            const goldResult = await client.query(
                'SELECT gold FROM players WHERE player_id = $1 FOR UPDATE',
                [playerId]
            );
            const gold = parseInt(goldResult.rows[0]?.gold ?? '0');
            if (gold < ransom.amount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: `Oro insuficiente. Necesitas ${ransom.amount.toLocaleString('es-ES')} oro.` });
            }

            const turnResult = await client.query(
                `SELECT value FROM game_config WHERE "group" = 'game' AND key = 'current_turn'`
            );
            const currentTurn = parseInt(turnResult.rows[0]?.value ?? '0');

            // Transferir oro
            await client.query(
                'UPDATE players SET gold = gold - $1 WHERE player_id = $2',
                [ransom.amount, playerId]
            );
            await client.query(
                'UPDATE players SET gold = gold + $1 WHERE player_id = $2',
                [ransom.amount, ransom.captor_player_id]
            );

            // Liberar personaje
            await CharacterModel.flee(client, ransom.character_id, ransom.capital_h3);

            // Resolver solicitud
            await client.query(
                `UPDATE ransom_requests SET status = 'accepted', resolved_at = NOW() WHERE id = $1`,
                [ransomId]
            );

            await NotificationService.createSystemNotification(
                ransom.captor_player_id, 'Captura',
                `💰 **${ransom.char_name}** ha sido rescatado. Recibes ${ransom.amount.toLocaleString('es-ES')} oro.`,
                currentTurn
            );

            await client.query('COMMIT');
            Logger.action(`[RESCATE] ${ransom.char_name} liberado. Pagado por jugador ${playerId} al captor ${ransom.captor_player_id}`, playerId);
            return res.json({ success: true, message: `${ransom.char_name} ha sido liberado.` });

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: 'POST /ransom-requests/:id/pay', userId: playerId, ransomId });
            return res.status(500).json({ success: false, message: 'Error al pagar el rescate.' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/ransom-requests/:id/reject
     * El propietario rechaza la solicitud de rescate.
     */
    async RejectRansom(req, res) {
        const playerId = req.user.player_id;
        const ransomId = parseInt(req.params.id, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `UPDATE ransom_requests SET status = 'rejected', resolved_at = NOW()
                 WHERE id = $1 AND owner_player_id = $2 AND status = 'pending'
                 RETURNING character_id`,
                [ransomId, playerId]
            );

            await client.query('COMMIT');

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Solicitud no encontrada.' });
            }
            return res.json({ success: true, message: 'Solicitud de rescate rechazada.' });

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: 'POST /ransom-requests/:id/reject', userId: playerId, ransomId });
            return res.status(500).json({ success: false, message: 'Error al rechazar el rescate.' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /api/characters/:id/imprison
     * El captor encarcela al personaje en un cuartel del hex donde está el ejército.
     */
    async Imprison(req, res) {
        const playerId    = req.user.player_id;
        const characterId = parseInt(req.params.id, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const charResult = await client.query(
                `SELECT c.id, c.name, c.player_id, c.is_captive, c.captured_by_army_id,
                        a.player_id AS captor_player_id, a.h3_index AS army_h3
                 FROM characters c
                 LEFT JOIN armies a ON a.army_id = c.captured_by_army_id
                 WHERE c.id = $1`,
                [characterId]
            );
            const char = charResult.rows[0];
            if (!char || !char.is_captive) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El personaje no está cautivo.' });
            }
            if (char.captor_player_id !== playerId) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No eres el captor.' });
            }

            // Verificar que hay un cuartel en el hex del ejército
            const barracksResult = await client.query(
                `SELECT fb.h3_index FROM fief_buildings fb
                 JOIN buildings b ON b.id = fb.building_id
                 JOIN building_types bt ON bt.id = b.type_id
                 WHERE fb.h3_index = $1
                   AND bt.name ILIKE '%militar%'
                   AND fb.remaining_construction_turns = 0`,
                [char.army_h3]
            );
            if (!barracksResult.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Necesitas un edificio militar en este territorio para encarcelar al personaje.' });
            }

            const turnResult = await client.query(
                `SELECT value FROM game_config WHERE "group" = 'game' AND key = 'current_turn'`
            );
            const currentTurn = parseInt(turnResult.rows[0]?.value ?? '0');

            await CharacterModel.setImprisoned(client, char.id, char.army_h3);

            await NotificationService.createSystemNotification(
                char.player_id, 'Captura',
                `🔒 **${char.name}** ha sido encarcelado en un cuartel enemigo.`,
                currentTurn
            );

            await client.query('COMMIT');
            Logger.action(`[ENCARCELAMIENTO] ${char.name} encarcelado en ${char.army_h3} por jugador ${playerId}`, playerId);
            return res.json({ success: true, message: `${char.name} ha sido encarcelado.` });

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(err, { endpoint: 'POST /characters/:id/imprison', userId: playerId, characterId });
            return res.status(500).json({ success: false, message: 'Error al encarcelar el personaje.' });
        } finally {
            client.release();
        }
    }

    /**
     * GET /api/characters/captives
     * Devuelve los personajes cautivos capturados por el jugador actual.
     */
    async GetMyCaptives(req, res) {
        const playerId = req.user.player_id;
        try {
            const result = await pool.query(
                `SELECT c.id, c.name, c.level, c.age, c.player_id, c.is_imprisoned,
                        c.imprisoned_at_h3, c.captured_by_army_id,
                        c.ransom_amount, c.ransom_turns_remaining,
                        p.display_name AS owner_name, p.color AS owner_color,
                        a.h3_index AS army_h3,
                        rr.id AS ransom_request_id, rr.amount AS ransom_request_amount,
                        rr.status AS ransom_request_status
                 FROM characters c
                 JOIN players p ON p.player_id = c.player_id
                 LEFT JOIN armies a ON a.army_id = c.captured_by_army_id
                 LEFT JOIN ransom_requests rr ON rr.character_id = c.id AND rr.status = 'pending'
                 WHERE c.is_captive = TRUE
                   AND (a.player_id = $1 OR c.imprisoned_at_h3 IN (
                       SELECT h3_index FROM h3_map WHERE player_id = $1
                   ))`,
                [playerId]
            );
            return res.json({ success: true, captives: result.rows });
        } catch (err) {
            Logger.error(err, { endpoint: 'GET /characters/captives', userId: playerId });
            return res.status(500).json({ success: false, message: 'Error al obtener cautivos.' });
        }
    }

    /**
     * GET /api/ransom-requests/pending
     * Solicitudes de rescate pendientes recibidas por el jugador (como propietario de cautivos).
     */
    async GetPendingRansomRequests(req, res) {
        const playerId = req.user.player_id;
        try {
            const result = await pool.query(
                `SELECT rr.id, rr.character_id, rr.captor_player_id, rr.amount, rr.created_at,
                        c.name AS character_name, c.level AS character_level,
                        p.display_name AS captor_name
                 FROM ransom_requests rr
                 JOIN characters c ON c.id = rr.character_id
                 JOIN players p ON p.player_id = rr.captor_player_id
                 WHERE rr.owner_player_id = $1 AND rr.status = 'pending'
                 ORDER BY rr.created_at DESC`,
                [playerId]
            );
            return res.json({ success: true, requests: result.rows });
        } catch (err) {
            Logger.error(err, { endpoint: 'GET /ransom-requests/pending', userId: playerId });
            return res.status(500).json({ success: false, message: 'Error al obtener solicitudes de rescate.' });
        }
    }
}

module.exports = new CharacterService();
