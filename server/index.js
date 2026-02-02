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
 * Query params: minLat, maxLat, minLng, maxLng, res (optional, default 8)
 * Response: Array of { h3_index: string, name: string, color: string }
 * Limit: Maximum 50000 hexagons per request
 */
app.get('/api/map/region', async (req, res) => {
  try {
    const { minLat, maxLat, minLng, maxLng, res } = req.query;

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

    // Parse resolution parameter (default to 8 if not provided or invalid)
    const H3_RESOLUTION = res ? parseInt(res, 10) : 8;

    // Validate resolution (H3 supports 0-15, but we limit to 8-10 for this app)
    if (H3_RESOLUTION < 8 || H3_RESOLUTION > 10) {
      return res.status(400).json({
        error: 'Invalid resolution parameter',
        message: 'Resolution must be between 8 and 10'
      });
    }

    // Import h3-js for H3 operations
    const h3 = require('h3-js');

    // Generate ALL H3 cells for the bounding box at specified resolution
    const polygon = [
      [bounds.minLat, bounds.minLng],
      [bounds.minLat, bounds.maxLng],
      [bounds.maxLat, bounds.maxLng],
      [bounds.maxLat, bounds.minLng],
    ];

    // h3-js v4 API: polygonToCells accepts array directly (no LatLngPoly wrapper)
    const h3CellsSet = h3.polygonToCells(polygon, H3_RESOLUTION);
    const h3CellsArray = Array.from(h3CellsSet);

    console.log(`Generated ${h3CellsArray.length} H3 cells (res ${H3_RESOLUTION}) for bounding box`);

    // If no cells in the bounding box, return empty array
    if (h3CellsArray.length === 0) {
      console.log('No H3 cells in bounding box');
      return res.json([]);
    }

    // Limit to 50000 cells to avoid query size issues
    const cellsToQuery = h3CellsArray.slice(0, 50000);

    // ESTRATEGIA DE RESOLUCION:
    // - La base de datos contiene datos en resolucion 8
    // - Para res > 8: Convertir cada celda a su celda padre (res 8), buscar en DB, y heredar el terreno
    // - Para res = 8: Consulta directa

    let hexagons = [];

    if (H3_RESOLUTION === 8) {
      // CONSULTA DIRECTA: res 8 (incluye has_road y settlements)
      const h3IndexValues = cellsToQuery.map(hexStr => BigInt('0x' + hexStr).toString());

      const query = `
        SELECT
          h3_map.h3_index,
          terrain_types.name,
          terrain_types.color,
          h3_map.has_road,
          s.name AS settlement_name,
          s.settlement_type,
          s.population_rank,
          s.period
        FROM h3_map
        INNER JOIN terrain_types ON h3_map.terrain_type_id = terrain_types.terrain_type_id
        LEFT JOIN settlements s ON h3_map.h3_index = s.h3_index
        WHERE h3_map.h3_index = ANY($1::bigint[])
      `;

      const result = await pool.query(query, [h3IndexValues]);

      hexagons = result.rows.map(row => ({
        h3_index: BigInt(row.h3_index).toString(16),
        name: row.name,
        color: row.color || TERRAIN_COLORS[row.name] || TERRAIN_COLORS['Desconocido'],
        has_road: row.has_road || false,
        settlement: row.settlement_name ? {
          name: row.settlement_name,
          type: row.settlement_type,
          population_rank: row.population_rank,
          period: row.period
        } : null
      }));

    } else {
      // RESOLUCION SUPERIOR (10): Convertir a celdas padre (res 8) y heredar terreno
      // Mapa: celda hijo (res 10) -> celda padre (res 8)
      const childToParentMap = {};
      const parentCellsSet = new Set();

      cellsToQuery.forEach(childHex => {
        const parentHex = h3.cellToParent(childHex, 8);
        childToParentMap[childHex] = parentHex;
        parentCellsSet.add(parentHex);
      });

      const parentCellsArray = Array.from(parentCellsSet);
      const parentIndexValues = parentCellsArray.map(hexStr => BigInt('0x' + hexStr).toString());

      // Consultar DB para celdas padre (res 8) con has_road y settlements
      const query = `
        SELECT
          h3_map.h3_index,
          terrain_types.name,
          terrain_types.color,
          h3_map.has_road,
          s.name AS settlement_name,
          s.settlement_type,
          s.population_rank,
          s.period
        FROM h3_map
        INNER JOIN terrain_types ON h3_map.terrain_type_id = terrain_types.terrain_type_id
        LEFT JOIN settlements s ON h3_map.h3_index = s.h3_index
        WHERE h3_map.h3_index = ANY($1::bigint[])
      `;

      const result = await pool.query(query, [parentIndexValues]);

      // Crear mapa: celda padre -> datos completos (terreno, has_road, settlement)
      const parentDataMap = {};
      result.rows.forEach(row => {
        const parentHex = BigInt(row.h3_index).toString(16);
        parentDataMap[parentHex] = {
          name: row.name,
          color: row.color || TERRAIN_COLORS[row.name] || TERRAIN_COLORS['Desconocido'],
          has_road: row.has_road || false,
          settlement: row.settlement_name ? {
            name: row.settlement_name,
            type: row.settlement_type,
            population_rank: row.population_rank,
            period: row.period
          } : null
        };
      });

      // Mapear celdas hijo (res 10) a datos heredados de celdas padre (res 8)
      hexagons = cellsToQuery
        .filter(childHex => {
          const parentHex = childToParentMap[childHex];
          return parentDataMap[parentHex] !== undefined;
        })
        .map(childHex => {
          const parentHex = childToParentMap[childHex];
          const data = parentDataMap[parentHex];
          return {
            h3_index: childHex,
            name: data.name,
            color: data.color,
            has_road: data.has_road,
            settlement: data.settlement
          };
        });

      console.log(`Mapped ${hexagons.length} child cells (res ${H3_RESOLUTION}) from ${parentCellsArray.length} parent cells (res 8)`);
    }

    console.log(`✓ Returned ${hexagons.length} hexagons (res ${H3_RESOLUTION}) for bounds: [${bounds.minLat}, ${bounds.maxLat}], [${bounds.minLng}, ${bounds.maxLng}]`);
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
 * GET /api/settlements
 * Returns all historical settlements with their coordinates
 * Response: Array of { name: string, lat: number, lng: number, type: string, period: string }
 */
app.get('/api/settlements', async (req, res) => {
  try {
    const h3 = require('h3-js');

    const query = `
      SELECT
        name,
        h3_index,
        settlement_type,
        population_rank,
        period
      FROM settlements
      ORDER BY name ASC
    `;

    console.log('Fetching settlements from database...');
    const result = await pool.query(query);

    if (!result.rows || result.rows.length === 0) {
      console.log('No settlements found in database');
      return res.json([]);
    }

    // Convert H3 indices to lat/lng coordinates
    const settlements = result.rows.map((row, index) => {
      try {
        const h3Index = BigInt(row.h3_index).toString(16);
        const [lat, lng] = h3.cellToLatLng(h3Index);

        return {
          name: row.name,
          lat: lat,
          lng: lng,
          type: row.settlement_type,
          period: row.period,
          population_rank: row.population_rank
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
