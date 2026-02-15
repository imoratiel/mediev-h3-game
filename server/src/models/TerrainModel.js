const pool = require('../../db.js');

class TerrainModel {    
    async GetRegion(h3CellsArray) {
        const query = `
            SELECT h3_index, terrain_type_id, terrain_color, has_road, player_id, player_color, building_type_id, icon_slug, location_name, settlement_type, coord_x, coord_y
            FROM v_map_display WHERE h3_index = ANY($1::text[])
        `;
        const result = await pool.query(query, [h3CellsArray]);
        return result;
    }    
    async GetTerrainTypes() {
        const result = await pool.query('SELECT terrain_type_id, name, color FROM terrain_types ORDER BY terrain_type_id');
        return result;
    }
}

module.exports = new TerrainModel();