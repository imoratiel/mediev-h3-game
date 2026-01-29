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
 * Returns all H3 hexagons for the Mallorca region with terrain data
 * Response: Array of { h3_index: string, name: string, color: string }
 */
app.get('/api/map/region', async (req, res) => {
  try {
    // Query to get H3 cells with terrain information
    const query = `
      SELECT
        h3_map.h3_index,
        terrain_types.name,
        terrain_types.color
      FROM h3_map
      INNER JOIN terrain_types ON h3_map.terrain_type_id = terrain_types.terrain_type_id
      ORDER BY h3_map.h3_index
    `;

    const result = await pool.query(query);

    // Convert h3_index from BIGINT to hex string (without 0x prefix)
    const hexagons = result.rows.map(row => ({
      h3_index: BigInt(row.h3_index).toString(16),
      name: row.name,
      color: row.color || TERRAIN_COLORS[row.name] || TERRAIN_COLORS['Desconocido']
    }));

    console.log(`✓ Returned ${hexagons.length} hexagons`);
    res.json(hexagons);

  } catch (error) {
    console.error('Error fetching map data:', error);
    res.status(500).json({
      error: 'Failed to fetch map data',
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
