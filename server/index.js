const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Terrain type colors mapping (fallback if database color is NULL)
const TERRAIN_COLORS = {
  'Vegas Reales': '#7db35d',       // Fertile green
  'Tierras de Secano': '#b8a170',  // Light brown/ochre
  'Yermos': '#9e9e9e',             // Stone gray
  'Picos de Granito': '#546e7a',   // Dark grayish blue
  'Oteros': '#a1887f',             // Hill brown
  'Espesuras': '#2d5a27',          // Dark forest green
  'Sotos': '#558b2f',              // Grove green
  'Albuferas': '#4fc3f7',          // Water blue
  'Tremedales': '#4e342e',         // Dark swamp brown
  'Estepas': '#d4e157',            // Yellowish green
  'Desconocido': '#9e9e9e'         // Gray for unknown
};

/**
 * GET /api/map/region
 * Returns H3 hexagons within a bounding box with terrain data
 * Query params: minLat, maxLat, minLng, maxLng
 * Response: Array of { h3_index: string, name: string, color: string }
 * Limit: Maximum 50000 hexagons per request
 */
app.get('/api/map/region', async (req, res) => {
  try {
    const { minLat, maxLat, minLng, maxLng } = req.query;

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

    // Import h3-js for H3 operations
    const h3 = require('h3-js');

    // Generate ALL H3 cells for the bounding box at resolution 8
    const H3_RESOLUTION = 8;
    const polygon = [
      [bounds.minLat, bounds.minLng],
      [bounds.minLat, bounds.maxLng],
      [bounds.maxLat, bounds.maxLng],
      [bounds.maxLat, bounds.minLng],
    ];

    // h3-js v4 API: polygonToCells accepts array directly (no LatLngPoly wrapper)
    const h3CellsSet = h3.polygonToCells(polygon, H3_RESOLUTION);
    const h3CellsArray = Array.from(h3CellsSet);

    console.log(`Generated ${h3CellsArray.length} H3 cells for bounding box`);

    // If no cells in the bounding box, return empty array
    if (h3CellsArray.length === 0) {
      console.log('No H3 cells in bounding box');
      return res.json([]);
    }

    // Limit to 50000 cells to avoid query size issues
    const cellsToQuery = h3CellsArray.slice(0, 50000);

    // Convert H3 hex strings to BIGINT for database query
    const h3IndexValues = cellsToQuery.map(hexStr => BigInt('0x' + hexStr).toString());

    // Query database for ONLY the cells in the bounding box
    const query = `
      SELECT
        h3_map.h3_index,
        terrain_types.name,
        terrain_types.color
      FROM h3_map
      INNER JOIN terrain_types ON h3_map.terrain_type_id = terrain_types.terrain_type_id
      WHERE h3_map.h3_index = ANY($1::bigint[])
    `;

    const result = await pool.query(query, [h3IndexValues]);

    // Convert h3_index from BIGINT to hex string
    const hexagons = result.rows.map(row => ({
      h3_index: BigInt(row.h3_index).toString(16),
      name: row.name,
      color: row.color || TERRAIN_COLORS[row.name] || TERRAIN_COLORS['Desconocido']
    }));

    console.log(`✓ Returned ${hexagons.length} hexagons for bounds: [${bounds.minLat}, ${bounds.maxLat}], [${bounds.minLng}, ${bounds.maxLng}]`);
    res.json(hexagons);

  } catch (error) {
    console.error('Error fetching map data:', error);
    res.status(500).json({
      error: 'Failed to fetch map data',
      message: error.message
    });
  }
});

/**
 * GET /api/terrain-types
 * Returns all terrain types with their colors for the legend
 * Response: Array of { terrain_type_id: number, name: string, color: string }
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
      color: row.color || TERRAIN_COLORS[row.name] || TERRAIN_COLORS['Desconocido']
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📍 API endpoint: http://localhost:${PORT}/api/map/region`);
});
