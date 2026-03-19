/**
 * DivisionService.js
 * Handlers HTTP para el sistema de divisiones politicas (Edictos).
 *
 * Endpoints:
 *   GET  /territory/:h3_index/laws     → estado de division del feudo + feudos contiguos libres
 *   GET  /divisions/propose-name       → sugiere nombre unico dado un nombre base
 *   POST /divisions/proclaim           → fundar un Senorio
 */

const pool = require('../../db.js');
const { Logger } = require('../utils/logger');
const DivisionModel = require('../models/DivisionModel.js');
const KingdomModel  = require('../models/KingdomModel.js');
const MapService = require('./MapService.js');
const { findContiguousFiefs } = require('../logic/contiguitySearch.js');
const { getUniqueDivisionName } = require('../logic/NamingService.js');
const { generateDivisionName }  = require('../logic/CulturalNameGenerator.js');

class DivisionService {

    /**
     * GET /territory/:h3_index/laws
     *
     * Caso A - feudo ya pertenece a una division:
     *   Devuelve los datos de la division (nombre, rango, capital, fief_count).
     *
     * Caso B - feudo libre:
     *   Ejecuta BFS para encontrar feudos contiguos libres del jugador.
     *   Recorta al max_fiefs_limit del rango Senorio.
     *   Devuelve la lista de h3_index y un nombre sugerido.
     *
     * Requisito previo: el feudo debe tener una Fortaleza activa.
     * (Verificado en el popup del mapa antes de mostrar el boton; aqui lo revalidamos.)
     */
    async GetTerritoryLaws(req, res) {
        const { h3_index } = req.params;
        const player_id    = req.user.player_id;
        const client       = await pool.connect();

        try {
            // 1. Verificar propiedad del feudo
            const ownerResult = await client.query(
                'SELECT player_id FROM h3_map WHERE h3_index = $1',
                [h3_index]
            );
            if (!ownerResult.rows[0] || ownerResult.rows[0].player_id !== player_id) {
                return res.status(403).json({ success: false, message: 'No posees este feudo' });
            }

            // 2. Verificar Fortaleza
            const hasFortress = await DivisionModel.HasFortress(client, h3_index);
            if (!hasFortress) {
                return res.status(400).json({
                    success: false,
                    message: 'Este feudo necesita una Fortaleza para proclamar un Senorio'
                });
            }

            // 3. Caso A: el feudo ya tiene division
            const existing = await DivisionModel.GetDivisionByFief(client, h3_index);
            if (existing) {
                return res.json({
                    success:      true,
                    has_division: true,
                    division: {
                        id:         existing.id,
                        name:       existing.name,
                        capital_h3: existing.capital_h3,
                        rank: {
                            id:              existing.rank_id,
                            title_male:      existing.rank_title_male,
                            title_female:    existing.rank_title_female,
                            territory_name:  existing.territory_name,
                            max_fiefs_limit: existing.max_fiefs_limit,
                            culture_id:      existing.rank_culture_id,
                        },
                        fief_count: existing.fief_count,
                        tax_rate:   parseFloat(existing.tax_rate ?? 10),
                    }
                });
            }

            // 4. Caso B: feudo libre → BFS
            const playerCulture = await KingdomModel.GetPlayerCulture(client, player_id);
            const senorioRank = await DivisionModel.GetSenorioRank(client, playerCulture);
            if (!senorioRank) {
                return res.status(500).json({ success: false, message: 'Configuracion de rangos no encontrada' });
            }

            const freeFiefs    = await DivisionModel.GetPlayerFreeFiefs(client, player_id);
            const freeFiefsSet = new Set(freeFiefs.map(f => f.h3_index));
            const terrainMap   = Object.fromEntries(freeFiefs.map(f => [f.h3_index, f.terrain_name]));

            const maxLimit     = senorioRank.max_fiefs_limit ?? 40;
            const contiguous   = findContiguousFiefs(freeFiefsSet, h3_index, maxLimit);

            // Construir objetos con terrain para el generador de nombre
            const contiguousFiefs = contiguous.map(h => ({
                h3_index:     h,
                terrain_name: terrainMap[h] ?? null
            }));

            const rawName      = suggestDivisionName(contiguousFiefs, senorioRank.territory_name);
            const suggestedName = await getUniqueDivisionName(client, rawName, player_id);

            const minRequired = senorioRank.min_fiefs_required ?? 1;

            return res.json({
                success:          true,
                has_division:     false,
                can_found:        contiguous.length >= minRequired,
                contiguous_fiefs: contiguous,
                suggested_name:   suggestedName,
                rank: {
                    id:                 senorioRank.id,
                    title_male:         senorioRank.title_male,
                    title_female:       senorioRank.title_female,
                    territory_name:     senorioRank.territory_name,
                    min_fiefs_required: minRequired,
                    max_fiefs_limit:    senorioRank.max_fiefs_limit,
                    culture_id:         playerCulture,
                }
            });

        } catch (error) {
            Logger.error(error, {
                endpoint: `/territory/${h3_index}/laws`,
                method:   'GET',
                userId:   player_id
            });
            res.status(500).json({ success: false, message: 'Error al obtener datos del territorio' });
        } finally {
            client.release();
        }
    }

    /**
     * POST /divisions/proclaim
     *
     * Funda un nuevo Senorio con los feudos seleccionados.
     *
     * Body:
     *   {
     *     capital_h3: string,       // feudo con Fortaleza, sera la capital
     *     fiefs:      string[],     // lista de h3_index a incluir (debe incluir capital_h3)
     *     name?:      string        // nombre opcional; si omitido, se genera automaticamente
     *   }
     *
     * Transaccion atomica:
     *   1. Verificar propiedad y Fortaleza en capital_h3
     *   2. Obtener rango Senorio
     *   3. LockAndVerifyFiefs: bloquea filas y valida que no hayan sido tomadas
     *   4. Validar contigüidad de los feudos enviados
     *   5. INSERT political_divisions
     *   6. UPDATE territory_details SET division_id
     *   ROLLBACK automatico si cualquier paso falla
     */
    async ProclaimDivision(req, res) {
        const player_id = req.user.player_id;
        const { capital_h3, fiefs, name: requestedName } = req.body;

        if (!capital_h3 || !Array.isArray(fiefs) || fiefs.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere capital_h3 y un array de feudos no vacio'
            });
        }

        if (!fiefs.includes(capital_h3)) {
            return res.status(400).json({
                success: false,
                message: 'La capital debe estar incluida en la lista de feudos'
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verificar propiedad y Fortaleza en la capital
            const ownerResult = await client.query(
                'SELECT player_id FROM h3_map WHERE h3_index = $1',
                [capital_h3]
            );
            if (!ownerResult.rows[0] || ownerResult.rows[0].player_id !== player_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'No posees el feudo capital' });
            }

            const hasFortress = await DivisionModel.HasFortress(client, capital_h3);
            if (!hasFortress) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'La capital debe tener una Fortaleza activa'
                });
            }

            // 2. Obtener rango Senorio y validar limite de feudos
            const playerCulture = await KingdomModel.GetPlayerCulture(client, player_id);
            const senorioRank = await DivisionModel.GetSenorioRank(client, playerCulture);
            if (!senorioRank) {
                await client.query('ROLLBACK');
                return res.status(500).json({ success: false, message: 'Configuracion de rangos no encontrada' });
            }

            const minRequired = senorioRank.min_fiefs_required ?? 1;
            const maxLimit    = senorioRank.max_fiefs_limit ?? 40;

            if (fiefs.length < minRequired) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Un Senorio requiere al menos ${minRequired} feudos (enviados: ${fiefs.length})`
                });
            }

            if (fiefs.length > maxLimit) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Un Senorio no puede tener mas de ${maxLimit} feudos`
                });
            }

            // 3. Bloquear y verificar que todos los feudos siguen libres y son del jugador
            await DivisionModel.LockAndVerifyFiefs(client, fiefs, player_id);

            // 4. Validar contigüidad: re-ejecutar BFS con el conjunto enviado
            //    para asegurarse de que no hay islas
            const { findContiguousFiefs: bfs } = require('../logic/contiguitySearch.js');
            const fiefsSet   = new Set(fiefs);
            const reachable  = bfs(fiefsSet, capital_h3, fiefs.length);

            if (reachable.length !== fiefs.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: 'Los feudos seleccionados no forman un territorio continuo (se detectaron islas)'
                });
            }

            // 5. Determinar nombre: usar el del body si existe, si no generar por cultura
            let baseName;
            if (requestedName && requestedName.trim().length > 0) {
                baseName = requestedName.trim().slice(0, 100);
            } else {
                const terrainRows = await client.query(`
                    SELECT t.name AS terrain_name, COUNT(*) AS cnt
                    FROM h3_map m
                    JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
                    WHERE m.h3_index = ANY($1::text[])
                    GROUP BY t.name
                    ORDER BY cnt DESC
                    LIMIT 1
                `, [fiefs]);
                const dominantTerrain = terrainRows.rows[0]?.terrain_name ?? null;
                baseName = generateDivisionName(playerCulture, capital_h3, dominantTerrain);
            }

            // Garantizar unicidad (resuelve conflictos automaticamente)
            const divisionName = await getUniqueDivisionName(client, baseName, player_id);
            const nameChanged  = divisionName !== baseName;

            // 6. Crear division
            const division = await DivisionModel.CreateDivision(client, {
                player_id,
                name:          divisionName,
                noble_rank_id: senorioRank.id,
                capital_h3
            });

            if (!division) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    message: `Error al crear la division "${divisionName}"`
                });
            }

            // 7. Asignar feudos a la division
            await DivisionModel.AssignFiefsToDivision(client, division.id, fiefs);

            await client.query('COMMIT');

            // Pre-calculate boundary GeoJSON (fast: pure h3 computation + 1 UPDATE)
            await MapService.generateDivisionBoundary(division.id);

            Logger.action(
                `Division "${divisionName}" proclamada por jugador ${player_id}. Capital: ${capital_h3}, feudos: ${fiefs.length}`,
                player_id
            );

            res.json({
                success: true,
                name_changed: nameChanged,
                original_name: nameChanged ? baseName : undefined,
                division: {
                    id:         division.id,
                    name:       division.name,
                    capital_h3: division.capital_h3,
                    fief_count: fiefs.length,
                    rank: {
                        title_male:     senorioRank.title_male,
                        territory_name: senorioRank.territory_name,
                    }
                }
            });

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            Logger.error(error, {
                endpoint: '/divisions/proclaim',
                method:   'POST',
                userId:   player_id,
                payload:  req.body
            });
            res.status(500).json({
                success: false,
                message: error.message || 'Error al proclamar la division'
            });
        } finally {
            client.release();
        }
    }
    /**
     * PATCH /divisions/:id/tax
     *
     * Actualiza la tasa impositiva (tax_rate) del señorío indicado.
     * Solo el propietario puede modificarla. Rango válido: 1-15.
     */
    async UpdateDivisionTax(req, res) {
        const player_id  = req.user.player_id;
        const divisionId = parseInt(req.params.id, 10);
        const { tax_rate } = req.body;

        if (isNaN(divisionId)) {
            return res.status(400).json({ success: false, message: 'ID de señorío inválido' });
        }
        if (tax_rate === undefined || tax_rate === null) {
            return res.status(400).json({ success: false, message: 'tax_rate es requerido' });
        }

        const rate = parseFloat(tax_rate);
        if (isNaN(rate) || rate < 1 || rate > 15) {
            return res.status(400).json({ success: false, message: 'tax_rate debe ser un número entre 1 y 15' });
        }

        const client = await pool.connect();
        try {
            const updated = await DivisionModel.UpdateTaxRate(client, divisionId, player_id, Math.round(rate * 100) / 100);
            if (!updated) {
                return res.status(404).json({ success: false, message: 'Señorío no encontrado o no te pertenece' });
            }
            Logger.action(`División ${updated.name} (id=${divisionId}): tax_rate → ${updated.tax_rate}%`, player_id);
            return res.json({ success: true, division: updated });
        } catch (error) {
            Logger.error(error, { endpoint: '/divisions/:id/tax', method: 'PATCH', userId: player_id });
            res.status(500).json({ success: false, message: 'Error al actualizar la tasa impositiva' });
        } finally {
            client.release();
        }
    }

    /**
     * GET /divisions/propose-name?base_name=...
     *
     * Devuelve el primer nombre disponible derivado de base_name para el jugador.
     * Util para validacion en tiempo real cuando el usuario edita el nombre.
     */
    async ProposeName(req, res) {
        const player_id = req.user.player_id;
        const baseName  = (req.query.base_name ?? '').trim();

        if (!baseName) {
            return res.status(400).json({ success: false, message: 'base_name requerido' });
        }

        try {
            const name    = await getUniqueDivisionName(pool, baseName, player_id);
            const changed = name !== baseName;
            return res.json({ success: true, name, changed });
        } catch (error) {
            Logger.error(error, { endpoint: '/divisions/propose-name', userId: player_id });
            res.status(500).json({ success: false, message: 'Error al proponer nombre' });
        }
    }

    /**
     * GET /divisions/my
     *
     * Devuelve todas las divisiones politicas del jugador autenticado,
     * junto con datos del rango y conteo de feudos.
     * Incluye tambien el rango noble actual del jugador y el siguiente rango.
     */
    async GetMyDivisions(req, res) {
        const player_id = req.user.player_id;
        try {
            const divisions = await DivisionModel.GetPlayerDivisions(null, player_id);
            const ranks = await DivisionModel.GetAllRanks(null);

            // Datos del jugador (rango actual)
            const playerResult = await pool.query(
                `SELECT p.noble_rank_id, p.first_name, p.last_name, p.gender,
                        nr.title_male, nr.title_female, nr.territory_name, nr.level_order,
                        nr.min_fiefs_required, nr.max_fiefs_limit,
                        nr.required_parent_rank_id, nr.required_count
                 FROM players p
                 JOIN noble_ranks nr ON p.noble_rank_id = nr.id
                 WHERE p.player_id = $1`,
                [player_id]
            );
            const player = playerResult.rows[0] ?? {};

            // Conteo total de feudos del jugador
            const fiefsCountResult = await pool.query(
                'SELECT COUNT(*)::int AS total FROM h3_map WHERE player_id = $1',
                [player_id]
            );
            const total_fiefs = fiefsCountResult.rows[0]?.total ?? 0;

            // Siguiente rango (level_order + 1)
            const nextRank = ranks.find(r => r.level_order === (player.level_order ?? 0) + 1) ?? null;

            return res.json({
                success: true,
                player: {
                    first_name:     player.first_name ?? '',
                    last_name:      player.last_name ?? '',
                    gender:         player.gender ?? 'M',
                    noble_rank_id:  player.noble_rank_id,
                    title:          player.gender === 'F' ? player.title_female : player.title_male,
                    territory_name: player.territory_name,
                    level_order:    player.level_order,
                    total_fiefs,
                },
                divisions,
                next_rank: nextRank,
                ranks,
            });
        } catch (error) {
            Logger.error(error, {
                endpoint: '/divisions/my',
                method: 'GET',
                userId: player_id,
            });
            res.status(500).json({ success: false, message: 'Error al obtener divisiones' });
        }
    }
}

module.exports = new DivisionService();
