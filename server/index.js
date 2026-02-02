const express = require('express');
const cors = require('cors');
const pool = require('./db');
const h3 = require('h3-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Terrain type colors fallback (si la BD no tiene color)
const TERRAIN_COLORS = {
  'Mar': '#0a4b78',
  'Costa': '#fff59d',
  'Agua': '#4fc3f7',
  'Río': '#00bcd4',
  'Pantanos': '#4e342e',
  'Tierras de Cultivo': '#7db35d',
  'Tierras de Secano': '#b8a170',
  'Estepas': '#d4e157',
  'Bosque': '#558b2f',
  'Espesuras': '#2d5a27',
  'Oteros': '#a1887f',
  'Colinas': '#8d6e63',
  'Alta Montaña': '#546e7a',
  'Asentamiento': '#e53935'
};

/**
 * GET /api/map/region
 * Returns H3 hexagons within a bounding box with terrain and game state data
 *
 * Query params:
 *   - minLat, maxLat, minLng, maxLng (required): Bounding box coordinates
 *   - res (optional, default 8): H3 resolution
 *
 * Response: Array of {
 *   h3_index: string,                // Hexadecimal format for h3-js
 *   terrain_type_id: number,
 *   terrain_color: string,
 *   has_road: boolean,
 *   player_id: number | null,        // Owner player ID
 *   player_color: string | null,     // Owner kingdom color (hex)
 *   building_type_id: number,        // 0 = none
 *   icon_slug: string | null,        // Icon name (castle, farm, etc.)
 *   location_name: string | null,    // Settlement or custom name
 *   settlement_type: string | null   // city, town, village, etc.
 * }
 */
app.get('/api/map/region', async (req, res) => {
  try {
    const { minLat, maxLat, minLng, maxLng, res: resolution } = req.query;

    // Validate bounding box parameters
    if (!minLat || !maxLat || !minLng || !maxLng) {
      return res.status(400).json({
        error: 'Missing bounding box parameters',
        message: 'Required: minLat, maxLat, minLng, maxLng'
      });
    }

    const bounds = {
      minLat: parseFloat(minLat),
      maxLat: parseFloat(maxLat),
      minLng: parseFloat(minLng),
      maxLng: parseFloat(maxLng)
    };

    // Validate numeric values
    if (Object.values(bounds).some(isNaN)) {
      return res.status(400).json({
        error: 'Invalid bounding box parameters',
        message: 'All parameters must be valid numbers'
      });
    }

    // Parse resolution (default to 8)
    const H3_RESOLUTION = resolution ? parseInt(resolution, 10) : 8;

    // Validate resolution (8-10 for this app)
    if (H3_RESOLUTION < 8 || H3_RESOLUTION > 10) {
      return res.status(400).json({
        error: 'Invalid resolution parameter',
        message: 'Resolution must be between 8 and 10'
      });
    }

    console.log(`[${new Date().toISOString()}] Fetching map region: bounds=${JSON.stringify(bounds)}, res=${H3_RESOLUTION}`);

    // PASO 1: Convertir bounding box a lista de celdas H3 usando h3-js
    const polygon = [
      [bounds.minLat, bounds.minLng],
      [bounds.minLat, bounds.maxLng],
      [bounds.maxLat, bounds.maxLng],
      [bounds.maxLat, bounds.minLng],
    ];

    const h3CellsSet = h3.polygonToCells(polygon, H3_RESOLUTION);
    const h3CellsArray = Array.from(h3CellsSet);

    console.log(`Generated ${h3CellsArray.length} H3 cells (res ${H3_RESOLUTION})`);

    if (h3CellsArray.length === 0) {
      console.log('No H3 cells in bounding box');
      return res.json([]);
    }

    // Limit to 50000 cells to avoid query issues
    const cellsToQuery = h3CellsArray.slice(0, 50000);

    // PASO 2: Consultar la vista v_map_display usando los índices H3
    // Convertir h3_index de hexadecimal (string) a BIGINT para la consulta
    // h3-js devuelve strings hexadecimales, la BD usa BIGINT
    const h3IndexValues = cellsToQuery.map(hexStr => BigInt('0x' + hexStr).toString());

    // Query usando v_map_display (incluye nuevos campos: player_color, icon_slug, location_name)
    const query = `
      SELECT
        h3_index,
        terrain_type_id,
        terrain_color,
        has_road,
        player_id,
        player_color,
        building_type_id,
        icon_slug,
        location_name,
        settlement_type
      FROM v_map_display
      WHERE h3_index = ANY($1::text[])
    `;

    const result = await pool.query(query, [h3IndexValues]);

    // PASO 3: Formatear respuesta para el frontend
    // Convertir h3_index de BIGINT decimal a hexadecimal para h3-js
    const hexagons = result.rows.map(row => {
      // row.h3_index es TEXT con valor decimal BIGINT, convertir a hex sin '0x'
      const h3Hex = BigInt(row.h3_index).toString(16);

      return {
        h3_index: h3Hex,  // Hexadecimal string para h3-js
        terrain_type_id: row.terrain_type_id,
        terrain_color: row.terrain_color || '#9e9e9e',
        has_road: row.has_road || false,

        // Capa Jugador (Nuevo)
        player_id: row.player_id || null,
        player_color: row.player_color || null,

        // Capa Edificios/Asentamientos (Nuevo)
        building_type_id: row.building_type_id || 0,
        icon_slug: row.icon_slug || null,
        location_name: row.location_name || null,
        settlement_type: row.settlement_type || null
      };
    });

    console.log(`✓ Returned ${hexagons.length} hexagons (res ${H3_RESOLUTION})`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(hexagons);

  } catch (error) {
    console.error('❌ Error fetching map data:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      error: 'Failed to fetch map data',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/settlements
 * Returns all historical settlements with their coordinates
 *
 * Response: Array of {
 *   name: string,
 *   h3_index: string,
 *   lat: number,
 *   lng: number,
 *   type: string,
 *   population_rank: number,
 *   period: string
 * }
 */
app.get('/api/settlements', async (req, res) => {
  try {
    console.log('Fetching settlements from database...');

    const query = `
      SELECT
        name,
        h3_index,
        type,
        population_rank,
        period
      FROM settlements
      ORDER BY name ASC
    `;

    const result = await pool.query(query);

    if (!result.rows || result.rows.length === 0) {
      console.log('No settlements found in database');
      return res.json([]);
    }

    // Convert H3 indices to lat/lng coordinates usando h3-js
    const settlements = result.rows.map((row) => {
      try {
        // settlements.h3_index es TEXT en formato hexadecimal (ya está correcto)
        // No necesita conversión, h3-js acepta hex strings directamente
        const h3Index = row.h3_index;
        const [lat, lng] = h3.cellToLatLng(h3Index);

        return {
          name: row.name,
          h3_index: h3Index,
          lat: lat,
          lng: lng,
          type: row.type,
          population_rank: row.population_rank,
          period: row.period
        };
      } catch (rowError) {
        console.error(`Error processing settlement ${row.name}:`, rowError);
        return null;
      }
    }).filter(s => s !== null);

    console.log(`✓ Returned ${settlements.length} settlements`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(settlements);

  } catch (error) {
    console.error('❌ Error fetching settlements:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to fetch settlements',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/terrain-types
 * Returns all terrain types with their colors for the legend
 *
 * Response: Array of {
 *   terrain_type_id: number,
 *   name: string,
 *   color: string
 * }
 */
app.get('/api/terrain-types', async (req, res) => {
  try {
    const query = `
      SELECT
        terrain_type_id,
        name,
        color
      FROM terrain_types
      ORDER BY terrain_type_id
    `;

    const result = await pool.query(query);

    const terrainTypes = result.rows.map(row => ({
      terrain_type_id: row.terrain_type_id,
      name: row.name,
      color: row.color || TERRAIN_COLORS[row.name] || '#9e9e9e'
    }));

    console.log(`✓ Returned ${terrainTypes.length} terrain types`);
    res.json(terrainTypes);

  } catch (error) {
    console.error('Error fetching terrain types:', error);
    res.status(500).json({
      error: 'Failed to fetch terrain types',
      message: error.message
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: 'connected'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📍 API endpoints:`);
  console.log(`   - GET /api/map/region?minLat=X&maxLat=X&minLng=X&maxLng=X&res=8`);
  console.log(`   - GET /api/settlements`);
  console.log(`   - GET /api/terrain-types`);
  console.log(`   - GET /health`);
});
