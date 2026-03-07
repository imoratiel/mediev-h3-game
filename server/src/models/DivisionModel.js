/**
 * DivisionModel.js
 * Capa de persistencia para divisiones politicas y rangos nobiliarios.
 * Todas las funciones reciben un `client` activo para poder participar en transacciones.
 */

const pool = require('../../db.js');

class DivisionModel {

    // ─────────────────────────────────────────────────────────────
    // EDIFICIOS
    // ─────────────────────────────────────────────────────────────

    /**
     * Devuelve el edificio activo (completado) de un feudo, si existe.
     * Incluye el nombre del edificio para verificar si es Fortaleza o superior.
     */
    async GetFiefBuilding(client, h3_index) {
        const result = await client.query(`
            SELECT fb.building_id, b.name, b.required_building_id
            FROM fief_buildings fb
            JOIN buildings b ON fb.building_id = b.id
            WHERE fb.h3_index = $1
              AND fb.is_under_construction = FALSE
        `, [h3_index]);
        return result.rows[0] ?? null;
    }

    /**
     * Verifica si un feudo tiene Fortaleza (o edificio de nivel superior).
     * La Fortaleza tiene required_building_id = 1 (Cuartel).
     * Edificios superiores tendrían required_building_id = ID de Fortaleza.
     */
    async HasFortress(client, h3_index) {
        const result = await client.query(`
            SELECT 1
            FROM fief_buildings fb
            JOIN buildings b ON fb.building_id = b.id
            WHERE fb.h3_index = $1
              AND fb.is_under_construction = FALSE
              AND (b.name = 'Fortaleza' OR b.required_building_id IN (
                  SELECT id FROM buildings WHERE name = 'Fortaleza'
              ))
        `, [h3_index]);
        return result.rows.length > 0;
    }

    // ─────────────────────────────────────────────────────────────
    // RANGOS NOBILIARIOS
    // ─────────────────────────────────────────────────────────────

    /**
     * Devuelve todos los rangos nobiliarios ordenados por level_order.
     */
    async GetAllRanks(client) {
        const result = await (client || pool).query(`
            SELECT id, title_male, title_female, territory_name,
                   min_fiefs_required, max_fiefs_limit, level_order,
                   required_parent_rank_id, required_count
            FROM noble_ranks
            ORDER BY level_order ASC
        `);
        return result.rows;
    }

    /**
     * Devuelve el rango de Senorio (level_order = 2), que es el primer rango
     * con el que se puede fundar una division politica.
     */
    async GetSenorioRank(client) {
        const result = await (client || pool).query(`
            SELECT id, title_male, title_female, territory_name,
                   min_fiefs_required, max_fiefs_limit
            FROM noble_ranks
            WHERE level_order = 2
            LIMIT 1
        `);
        return result.rows[0] ?? null;
    }

    // ─────────────────────────────────────────────────────────────
    // DIVISIONES
    // ─────────────────────────────────────────────────────────────

    /**
     * Devuelve la division a la que pertenece un feudo, con datos del rango.
     * Devuelve null si el feudo no tiene division_id.
     */
    async GetDivisionByFief(client, h3_index) {
        const result = await client.query(`
            SELECT
                pd.id,
                pd.name,
                pd.capital_h3,
                pd.created_at,
                nr.id           AS rank_id,
                nr.title_male   AS rank_title_male,
                nr.title_female AS rank_title_female,
                nr.territory_name,
                nr.max_fiefs_limit,
                COUNT(td2.h3_index)::int AS fief_count
            FROM territory_details td
            JOIN political_divisions pd ON td.division_id = pd.id
            JOIN noble_ranks nr         ON pd.noble_rank_id = nr.id
            LEFT JOIN territory_details td2 ON td2.division_id = pd.id
            WHERE td.h3_index = $1
            GROUP BY pd.id, pd.name, pd.capital_h3, pd.created_at,
                     nr.id, nr.title_male, nr.title_female, nr.territory_name, nr.max_fiefs_limit
        `, [h3_index]);
        return result.rows[0] ?? null;
    }

    /**
     * Devuelve todos los feudos del jugador con division_id IS NULL y su terrain_name.
     * Se usa para construir el Set de feudos libres antes del BFS.
     */
    async GetPlayerFreeFiefs(client, player_id) {
        const result = await client.query(`
            SELECT m.h3_index, t.name AS terrain_name
            FROM h3_map m
            LEFT JOIN territory_details td ON m.h3_index = td.h3_index
            LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
            WHERE m.player_id = $1
              AND (td.division_id IS NULL OR td.h3_index IS NULL)
        `, [player_id]);
        return result.rows;
    }

    /**
     * Devuelve todas las divisiones de un jugador con su fief_count y capital.
     */
    async GetPlayerDivisions(client, player_id) {
        const result = await (client || pool).query(`
            SELECT
                pd.id,
                pd.name,
                pd.capital_h3,
                pd.created_at,
                nr.title_male   AS rank_title_male,
                nr.title_female AS rank_title_female,
                nr.territory_name,
                COUNT(td.h3_index)::int AS fief_count
            FROM political_divisions pd
            JOIN noble_ranks nr        ON pd.noble_rank_id = nr.id
            LEFT JOIN territory_details td ON td.division_id = pd.id
            WHERE pd.player_id = $1
            GROUP BY pd.id, pd.name, pd.capital_h3, pd.created_at,
                     nr.title_male, nr.title_female, nr.territory_name
            ORDER BY pd.created_at ASC
        `, [player_id]);
        return result.rows;
    }

    /**
     * Bloquea (FOR UPDATE) las filas de territory_details para los h3_index dados
     * y verifica que todos pertenezcan al jugador y esten libres.
     * Devuelve las filas bloqueadas, o lanza error si alguna fue tomada.
     */
    async LockAndVerifyFiefs(client, h3_indices, player_id) {
        if (h3_indices.length === 0) throw new Error('Lista de feudos vacia');

        // Verify ownership via h3_map (source of truth)
        const ownerResult = await client.query(`
            SELECT h3_index, player_id AS owner_id
            FROM h3_map
            WHERE h3_index = ANY($1::text[])
        `, [h3_indices]);

        if (ownerResult.rows.length !== h3_indices.length) {
            throw new Error('Algunos feudos seleccionados no existen en el mapa');
        }

        for (const row of ownerResult.rows) {
            if (row.owner_id !== player_id) {
                throw new Error(`El feudo ${row.h3_index} no te pertenece`);
            }
        }

        // Check division_id only for fiefs that have a territory_details row
        const divResult = await client.query(`
            SELECT h3_index, division_id
            FROM territory_details
            WHERE h3_index = ANY($1::text[]) AND division_id IS NOT NULL
            FOR UPDATE
        `, [h3_indices]);

        if (divResult.rows.length > 0) {
            throw new Error(`El feudo ${divResult.rows[0].h3_index} ya fue asignado a otra division`);
        }

        return ownerResult.rows;
    }

    /**
     * Inserta una nueva division politica.
     * Usa ON CONFLICT (player_id, name) DO NOTHING para idempotencia.
     * Devuelve la fila insertada, o null si ya existia.
     */
    async CreateDivision(client, { player_id, name, noble_rank_id, capital_h3 }) {
        const result = await client.query(`
            INSERT INTO political_divisions (player_id, name, noble_rank_id, capital_h3)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (player_id, name) DO NOTHING
            RETURNING id, name, capital_h3, created_at
        `, [player_id, name, noble_rank_id, capital_h3]);
        return result.rows[0] ?? null;
    }

    /**
     * Devuelve todos los h3_index asignados a una division.
     * Se usa para recalcular el boundary_geojson.
     */
    async GetDivisionFiefs(pool, divisionId) {
        const result = await pool.query(`
            SELECT m.h3_index
            FROM h3_map m
            JOIN territory_details td ON m.h3_index = td.h3_index
            WHERE td.division_id = $1
        `, [divisionId]);
        return result.rows.map(r => r.h3_index);
    }

    /**
     * Actualiza el campo boundary_geojson de una division.
     */
    async UpdateBoundary(pool, divisionId, geojson) {
        await pool.query(
            'UPDATE political_divisions SET boundary_geojson = $1 WHERE id = $2',
            [geojson ? JSON.stringify(geojson) : null, divisionId]
        );
    }

    /**
     * Devuelve todas las divisiones que tienen boundary_geojson calculado.
     * Usada por GET /divisions/boundaries.
     */
    async GetAllActiveBoundaries(pool) {
        const result = await pool.query(`
            SELECT pd.id, pd.name, pd.player_id, pd.capital_h3, pd.boundary_geojson,
                   nr.territory_name, nr.title_male, nr.title_female
            FROM political_divisions pd
            JOIN noble_ranks nr ON pd.noble_rank_id = nr.id
            WHERE pd.boundary_geojson IS NOT NULL
        `);
        return result.rows;
    }

    /**
     * Asigna masivamente un division_id a una lista de feudos.
     * Solo actualiza feudos que siguen con division_id IS NULL (seguridad extra).
     */
    async AssignFiefsToDivision(client, division_id, h3_indices) {
        if (h3_indices.length === 0) return;
        // UPSERT: insert row if missing, update if exists (only when division_id is still NULL)
        await client.query(`
            INSERT INTO territory_details (h3_index, division_id)
            SELECT unnest($2::text[]), $1
            ON CONFLICT (h3_index) DO UPDATE
              SET division_id = EXCLUDED.division_id
              WHERE territory_details.division_id IS NULL
        `, [division_id, h3_indices]);
    }
}

module.exports = new DivisionModel();
