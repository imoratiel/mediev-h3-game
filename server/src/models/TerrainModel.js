const pool = require('../../db.js');

class TerrainModel {    
    async GetRegion(h3CellsArray) {
        const query = `
            SELECT h3_index, terrain_type_id, terrain_color, has_road, is_capital,
                   player_id, player_color, location_name, settlement_type, coord_x, coord_y
            FROM v_map_display
            WHERE h3_index = ANY($1::text[])
        `;
        const result = await pool.query(query, [h3CellsArray]);
        return result;
    }    
    async GetTerrainTypes() {
        const result = await pool.query('SELECT terrain_type_id, name, color, sort_order FROM terrain_types WHERE sort_order IS NOT NULL ORDER BY sort_order, terrain_type_id');
        return result;
    }
    async GetBuildingsInBounds(h3CellsArray) {
        const query = `
            SELECT
                fb.h3_index,
                fb.building_id,
                bld.name AS building_name,
                bt.name  AS type_name,
                fb.is_under_construction,
                fb.remaining_construction_turns
            FROM fief_buildings fb
            JOIN buildings bld ON fb.building_id = bld.id
            JOIN building_types bt ON bld.type_id = bt.building_type_id
            WHERE fb.h3_index = ANY($1::text[])
        `;
        const result = await pool.query(query, [h3CellsArray]);
        return result;
    }
    async GetCellDetails(h3_index) {
        const query = `
            SELECT
                m.*,
                t.name AS terrain_type,
                t.color AS terrain_color,
                t.food_output,
                t.wood_output,
                p.display_name AS player_name,
                p.color AS player_color,
                p.capital_h3,
                s.name AS settlement_name,
                s.type AS settlement_type,
                td.*,
                m.coord_x,
                m.coord_y,
                fb.building_id            AS fief_building_id,
                fb.is_under_construction  AS fief_building_constructing,
                fb.remaining_construction_turns AS fief_building_turns_left,
                fb.conservation           AS fief_building_conservation,
                bld.name                  AS fief_building_name,
                bt.name                   AS fief_building_type_name,
                upgrade_bld.id            AS upgrade_building_id,
                upgrade_bld.name          AS upgrade_building_name,
                upgrade_bld.gold_cost     AS upgrade_gold_cost,
                upgrade_bld.construction_time_turns AS upgrade_turns,
                pd.name                   AS division_name
            FROM h3_map m
            LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
            LEFT JOIN players p ON m.player_id = p.player_id
            LEFT JOIN settlements s ON m.h3_index = s.h3_index
            LEFT JOIN territory_details td ON m.h3_index = td.h3_index
            LEFT JOIN political_divisions pd ON td.division_id = pd.id
            LEFT JOIN fief_buildings fb ON m.h3_index = fb.h3_index
            LEFT JOIN buildings bld ON fb.building_id = bld.id
            LEFT JOIN building_types bt ON bld.type_id = bt.building_type_id
            LEFT JOIN buildings upgrade_bld ON upgrade_bld.required_building_id = fb.building_id
            WHERE m.h3_index = $1
        `;
        const result = await pool.query(query, [h3_index]);
        return result;
    }
}

module.exports = new TerrainModel();