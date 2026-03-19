const { Logger } = require('../utils/logger');
const AdminModel = require('../models/AdminModel.js');
const { CONFIG } = require('../config.js');
const { resetGame } = require('../logic/resetGame.js');
const pool = require('../../db.js');
const h3   = require('h3-js');
const DivisionModel = require('../models/DivisionModel.js');
const KingdomModel  = require('../models/KingdomModel.js');
const MapService    = require('../services/MapService.js');
const { bfsExpandTerritory } = require('../logic/playerInit.js');
const { getUniqueDivisionName } = require('../logic/NamingService.js');
const { generateDivisionName }  = require('../logic/CulturalNameGenerator.js');

class AdminService {
    async ResetWorld(req, res) {
        try {
            Logger.action('Acceso administrativo a /admin/reset - Reseteando mundo', req.user.player_id);
            await AdminModel.ResetWorld();
            Logger.action('Mundo reseteado exitosamente', req.user.player_id);
            res.json({ success: true, message: 'Mundo reseteado' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/reset', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al resetear mundo' });
        }
    }
    async ResetGame(req, res) {
        try {
            Logger.action('⚠️ RESET DE PARTIDA iniciado por administrador', req.user.player_id);
            await resetGame();
            Logger.action('✅ RESET DE PARTIDA completado: bots eliminados, territorios liberados, jugadores reiniciados', req.user.player_id);
            res.json({ success: true, message: 'Partida reseteada. Los jugadores pueden iniciar una nueva partida.' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/reset-game', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al resetear la partida: ' + error.message });
        }
    }
    async GetStats(req, res) {
        try {
            Logger.action('Acceso administrativo a /admin/stats', req.user.player_id);
            const { world, turnConfig, players, territories, messages } = await AdminModel.GetStats();
            res.json({
                success: true,
                stats: {
                    current_turn: world.current_turn,
                    game_date: world.game_date,
                    players: parseInt(players),
                    territories: parseInt(territories),
                    messages: parseInt(messages),
                    turn_interval_seconds: turnConfig.value
                }
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/stats', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
        }
    }
    async ResetExplorations(req, res) {
        try {
            Logger.action('Acceso administrativo a /admin/reset-explorations - Reseteando exploraciones', req.user.player_id);
            await AdminModel.ResetExplorations();
            Logger.action('Exploraciones reseteadas exitosamente', req.user.player_id);
            res.json({ success: true, message: 'Todas las exploraciones han sido reseteadas' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/reset-explorations', method: 'POST', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al resetear exploraciones' });
        }
    }
    async UpdateConfig(req, res) {
        try {
            const { turn_interval_seconds } = req.body;
            if (!turn_interval_seconds) return res.status(400).json({ success: false, message: 'turn_interval_seconds requerido' });

            Logger.action(`Acceso administrativo a /admin/config - Actualizando intervalo de turnos a ${turn_interval_seconds}s`, req.user.player_id);
            await AdminModel.UpsertConfig('gameplay', 'turn_duration_seconds', turn_interval_seconds);
            Logger.action(`Configuración actualizada: turn_interval_seconds = ${turn_interval_seconds}`, req.user.player_id);
            res.json({ success: true, message: 'Configuración actualizada. Reinicie el servidor para aplicar el nuevo intervalo de tiempo.' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/config', method: 'POST', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al actualizar configuración', error: error.message });
        }
    }
    async GetGameConfig(req, res) {
        try {
            Logger.action('Acceso administrativo a /admin/game-config - Consultando configuración', req.user.player_id);
            res.json({ success: true, config: CONFIG });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/game-config', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al obtener configuración' });
        }
    }
    /**
     * POST /admin/create-pagus
     * Crea un Pagus completo (centurias + fortaleza + capital) adyacente al territorio del jugador.
     * Pensado para testing — se puede ejecutar múltiples veces.
     */
    async CreateAdminPagus(req, res) {
        const adminId   = req.user.player_id;
        const player_id = parseInt(req.body?.player_id ?? adminId);

        const client = await pool.connect();
        let divisionId = null;
        try {
            await client.query('BEGIN');

            // 1. Verificar jugador y obtener cultura
            const playerRes = await client.query(
                'SELECT culture_id FROM players WHERE player_id = $1',
                [player_id]
            );
            if (!playerRes.rows[0]) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Jugador no encontrado' });
            }
            const cultureId = playerRes.rows[0].culture_id;

            // 2. Obtener todos los hexes del jugador
            const playerHexesRes = await client.query(
                'SELECT h3_index FROM h3_map WHERE player_id = $1',
                [player_id]
            );
            if (playerHexesRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'El jugador no tiene territorio' });
            }
            const playerHexSet = new Set(playerHexesRes.rows.map(r => r.h3_index));

            // 3. Recopilar vecinos ring-1 no pertenecientes al jugador
            const neighborSet = new Set();
            for (const hex of playerHexSet) {
                for (const n of h3.gridDisk(hex, 1)) {
                    if (!playerHexSet.has(n)) neighborSet.add(n);
                }
            }

            // 4. Encontrar un hex libre y colonizable como capital del nuevo pagus
            const freeRes = await client.query(`
                SELECT m.h3_index FROM h3_map m
                JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
                WHERE m.h3_index = ANY($1::text[])
                  AND m.player_id IS NULL
                  AND t.is_colonizable = TRUE
                ORDER BY RANDOM()
                LIMIT 1
            `, [[...neighborSet]]);

            const startHex = freeRes.rows[0]?.h3_index;
            if (!startHex) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'No hay hexágonos libres adyacentes a tu territorio' });
            }

            // 5. Número objetivo de centurias (min_fiefs_required del rango Señorío)
            const senorioRank = await DivisionModel.GetSenorioRank(client, cultureId);
            const targetCount = senorioRank?.min_fiefs_required ?? 30;

            // 6. BFS desde startHex para recopilar centurias contiguas
            const { bonusHexes } = await bfsExpandTerritory(client, startHex, targetCount);
            const allHexes = [startHex, ...bonusHexes];

            // 7. Reclamar hexes e inicializar territory_details
            for (const hex of allHexes) {
                await client.query(
                    'UPDATE h3_map SET player_id = $1, last_update = CURRENT_TIMESTAMP WHERE h3_index = $2',
                    [player_id, hex]
                );
                await client.query(`
                    INSERT INTO territory_details
                        (h3_index, population, happiness, food_stored, wood_stored, stone_stored, iron_stored, gold_stored)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (h3_index) DO UPDATE SET
                        population   = EXCLUDED.population,
                        happiness    = EXCLUDED.happiness,
                        food_stored  = EXCLUDED.food_stored,
                        wood_stored  = EXCLUDED.wood_stored,
                        stone_stored = EXCLUDED.stone_stored,
                        iron_stored  = EXCLUDED.iron_stored,
                        gold_stored  = EXCLUDED.gold_stored
                `, [
                    hex,
                    Math.floor(Math.random() * 201) + 200,
                    Math.floor(Math.random() * 21)  + 50,
                    Math.floor(Math.random() * 2001),
                    Math.floor(Math.random() * 2001),
                    Math.floor(Math.random() * 2001),
                    0,
                    Math.floor(Math.random() * 201) + 50,
                ]);
            }

            // 8. Colocar fortaleza completada en la capital del pagus
            const lvl2Military = await KingdomModel.GetMilitaryLvl2Building(client, cultureId);
            if (lvl2Military) {
                await KingdomModel.PlaceBuildingCompleted(client, startHex, lvl2Military.id);
            }

            // 9. Crear la división política
            const terrainRow = await client.query(`
                SELECT t.name AS terrain_name, COUNT(*) AS cnt
                FROM h3_map m
                JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
                WHERE m.h3_index = ANY($1::text[])
                GROUP BY t.name ORDER BY cnt DESC LIMIT 1
            `, [allHexes]);
            const dominantTerrain = terrainRow.rows[0]?.terrain_name ?? null;
            const baseName        = generateDivisionName(cultureId, startHex, dominantTerrain);
            const divisionName    = await getUniqueDivisionName(client, baseName, player_id);

            const division = await DivisionModel.CreateDivision(client, {
                player_id,
                name:          divisionName,
                noble_rank_id: senorioRank.id,
                capital_h3:    startHex,
            });
            if (!division) throw new Error('No se pudo crear la división política');
            divisionId = division.id;

            // 10. Asignar todas las centurias al pagus
            await DivisionModel.AssignFiefsToDivision(client, divisionId, allHexes);

            await client.query('COMMIT');

            // 11. Generar boundary GeoJSON (fuera de la transacción)
            await MapService.generateDivisionBoundary(divisionId);

            Logger.action(`Admin creó pagus "${divisionName}" (${allHexes.length} centurias, capital ${startHex}) para player ${player_id}`, adminId);
            res.json({
                success:       true,
                division_id:   divisionId,
                division_name: divisionName,
                capital_h3:    startHex,
                hex_count:     allHexes.length,
            });

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, { endpoint: '/admin/create-pagus', userId: adminId, player_id });
            res.status(500).json({ success: false, message: error.message || 'Error al crear pagus' });
        } finally {
            client.release();
        }
    }

    async UpdateGameConfig(req, res) {
        try {
            const { group, key, value } = req.body;
            if (!group || !key || value === undefined) return res.status(400).json({ success: false, message: 'Faltan parámetros' });

            Logger.action(`Acceso administrativo a /admin/game-config - Actualizando ${group}.${key} = ${value}`, req.user.player_id);
            await AdminModel.UpsertConfig(group, key, value);

            // Update in-memory config so changes take effect without restart
            if (!CONFIG[group]) CONFIG[group] = {};
            CONFIG[group][key] = !isNaN(value) ? Number(value) : value;

            Logger.action(`Configuración actualizada: ${group}.${key} = ${value}`, req.user.player_id);
            res.json({ success: true, message: 'Configuración de juego actualizada' });
        } catch (error) {
            Logger.error(error, { endpoint: '/admin/game-config', method: 'PUT', userId: req.user?.player_id, payload: req.body });
            res.status(500).json({ success: false, message: 'Error al actualizar configuración de juego' });
        }
    }
}

module.exports = new AdminService();
