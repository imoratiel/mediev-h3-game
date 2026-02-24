const pool = require('../../db.js');

class TerrainModel {    
    async GetRegion(h3CellsArray) {
        const query = `
            SELECT h3_index, terrain_type_id, terrain_color, has_road, is_capital, player_id, player_color, building_type_id, icon_slug, location_name, settlement_type, coord_x, coord_y
            FROM v_map_display WHERE h3_index = ANY($1::text[])
        `;
        const result = await pool.query(query, [h3CellsArray]);
        return result;
    }    
    async GetTerrainTypes() {
        const result = await pool.query('SELECT terrain_type_id, name, color FROM terrain_types ORDER BY terrain_type_id');
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
                b.name AS building_type,
                s.name AS settlement_name,
                s.type AS settlement_type,
                td.*,
                m.coord_x,
                m.coord_y
            FROM h3_map m
            LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
            LEFT JOIN players p ON m.player_id = p.player_id
            LEFT JOIN building_types b ON m.building_type_id = b.building_type_id
            LEFT JOIN settlements s ON m.h3_index = s.h3_index
            LEFT JOIN territory_details td ON m.h3_index = td.h3_index
            WHERE m.h3_index = $1
        `;
        const result = await pool.query(query, [h3_index]);
        return result;
    }
}

module.exports = new TerrainModel();