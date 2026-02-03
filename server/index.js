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
        population_rank
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
 * Helper: Generate random integer between min and max (inclusive)
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * POST /api/game/claim
 * Coloniza un hexágono (reclama territorio) con reglas de juego estrictas
 *
 * REGLAS:
 * 1. No se puede colonizar Mar (terrain_type_id=1) o Agua (terrain_type_id=3)
 * 2. Expansión:
 *    - Si el jugador tiene 0 territorios → Puede reclamar cualquier casilla válida (será la capital)
 *    - Si el jugador ya tiene territorios → Solo puede reclamar casillas contiguas
 * 3. Debe tener 100 de oro
 * 4. Genera valores aleatorios de economía (población, felicidad, recursos)
 *
 * Body: {
 *   player_id: number,
 *   h3_index: string (hex format)
 * }
 *
 * Response: {
 *   success: boolean,
 *   new_gold: number,
 *   is_capital: boolean,
 *   message: string
 * }
 */
app.post('/api/game/claim', async (req, res) => {
  const client = await pool.connect();

  try {
    const { player_id, h3_index } = req.body;

    // Validar parámetros
    if (!player_id || !h3_index) {
      return res.status(400).json({
        success: false,
        message: 'Faltan parámetros: player_id, h3_index'
      });
    }

    console.log(`[Claim] Player ${player_id} attempting to claim ${h3_index}`);

    // Convertir h3_index hex a BIGINT para la base de datos
    const h3_bigint = BigInt('0x' + h3_index).toString();

    // Iniciar transacción
    await client.query('BEGIN');

    // PASO 1: Verificar si el jugador tiene territorios previos
    const territoryCountQuery = `
      SELECT COUNT(*) as count
      FROM h3_map
      WHERE player_id = $1
    `;
    const territoryCountResult = await client.query(territoryCountQuery, [player_id]);
    const playerTerritoryCount = parseInt(territoryCountResult.rows[0].count);
    const isFirstTerritory = (playerTerritoryCount === 0);

    console.log(`[Claim] Player ${player_id} currently owns ${playerTerritoryCount} territories (isFirstTerritory: ${isFirstTerritory})`);

    // PASO A: Verificar datos de la casilla objetivo (including terrain resource outputs)
    const hexQuery = `
      SELECT m.h3_index, m.player_id, m.terrain_type_id,
             t.iron_output, t.name as terrain_name
      FROM h3_map m
      LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
      WHERE m.h3_index = $1
      FOR UPDATE OF m
    `;
    const hexResult = await client.query(hexQuery, [h3_bigint]);

    if (hexResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Hexágono no encontrado en el mapa'
      });
    }

    const hex = hexResult.rows[0];

    // REGLA 1: No se puede colonizar Mar (1) o Agua (3)
    if (hex.terrain_type_id === 1 || hex.terrain_type_id === 3) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: '🌊 No puedes construir en el agua'
      });
    }

    // Verificar que no tiene dueño
    if (hex.player_id !== null) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: '🛡️ Este territorio ya está ocupado'
      });
    }

    // PASO B: Verificar saldo del jugador
    const playerQuery = `
      SELECT player_id, username, gold
      FROM players
      WHERE player_id = $1
      FOR UPDATE
    `;
    const playerResult = await client.query(playerQuery, [player_id]);

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Jugador no encontrado'
      });
    }

    const player = playerResult.rows[0];
    const CLAIM_COST = 100;

    if (player.gold < CLAIM_COST) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `💰 Oro insuficiente. Necesitas: ${CLAIM_COST}, Tienes: ${player.gold}`
      });
    }

    // PASO C: Verificar contigüidad (REGLA 2) - Solo si NO es el primer territorio
    if (!isFirstTerritory) {
      // Obtener hexágonos vecinos (anillo de distancia 1)
      const neighbors = h3.gridDisk(h3_index, 1);

      // Filtrar solo los vecinos inmediatos (distancia 1, sin incluir el centro)
      const immediateNeighbors = neighbors.filter(neighbor => neighbor !== h3_index);

      // Convertir vecinos a BIGINT para consulta
      const neighborBigints = immediateNeighbors.map(hexStr => BigInt('0x' + hexStr).toString());

      // Verificar si algún vecino pertenece al jugador
      const neighborQuery = `
        SELECT COUNT(*) as count
        FROM h3_map
        WHERE player_id = $1 AND h3_index = ANY($2::bigint[])
      `;
      const neighborResult = await client.query(neighborQuery, [player_id, neighborBigints]);
      const adjacentOwnedCount = parseInt(neighborResult.rows[0].count);

      console.log(`[Claim] Found ${adjacentOwnedCount} adjacent territories owned by player`);

      if (adjacentOwnedCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: '📍 Debes colonizar territorios contiguos a los tuyos'
        });
      }

      console.log(`✓ Contiguity check passed: hex is adjacent to player territory`);
    }

    // PASO 2: Generar valores aleatorios de economía (RNG)
    const initialPopulation = getRandomInt(200, 400);
    const initialHappiness = getRandomInt(50, 70);
    const initialFood = getRandomInt(0, 2000);
    const initialWood = getRandomInt(0, 2000);
    const initialStone = getRandomInt(0, 2000);

    // IRON: Rare resource with 1/30 probability if terrain has iron potential
    let initialIron = 0;
    let ironVeinFound = false;

    if (hex.iron_output > 0) {
      // 1 in 30 chance to find an iron vein
      const foundVein = Math.random() < (1 / 30);

      if (foundVein) {
        ironVeinFound = true;
        // Lucky! Calculate iron with a bonus multiplier (1.5x) as a reward
        const baseIron = getRandomInt(500, 2500);
        initialIron = Math.floor(baseIron * 1.5);
        console.log(`🎉 [Claim] IRON VEIN FOUND! Initial iron: ${initialIron} (terrain: ${hex.terrain_name})`);
      } else {
        console.log(`[Claim] No iron vein found (terrain has potential: ${hex.terrain_name})`);
      }
    } else {
      console.log(`[Claim] Terrain has no iron potential (${hex.terrain_name})`);
    }

    console.log(`[Claim] Generated initial economy: pop=${initialPopulation}, happiness=${initialHappiness}, food=${initialFood}, wood=${initialWood}, stone=${initialStone}, iron=${initialIron}`);

    // PASO 3: Actualizar h3_map - Asignar hexágono al jugador sin edificio inicial (building_type_id = 0)
    await client.query(
      `UPDATE h3_map
       SET player_id = $1, building_type_id = 0, is_capital = $2, last_update = CURRENT_TIMESTAMP
       WHERE h3_index = $3`,
      [player_id, isFirstTerritory, h3_bigint]
    );

    // PASO 4: Insertar en territory_details
    const insertTerritoryDetailsQuery = `
      INSERT INTO territory_details (h3_index, population, happiness, food_stored, wood_stored, stone_stored, iron_stored)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (h3_index)
      DO UPDATE SET
        population = EXCLUDED.population,
        happiness = EXCLUDED.happiness,
        food_stored = EXCLUDED.food_stored,
        wood_stored = EXCLUDED.wood_stored,
        stone_stored = EXCLUDED.stone_stored,
        iron_stored = EXCLUDED.iron_stored
    `;
    await client.query(insertTerritoryDetailsQuery, [
      h3_bigint,
      initialPopulation,
      initialHappiness,
      initialFood,
      initialWood,
      initialStone,
      initialIron
    ]);

    // PASO 5: Cobrar el oro (100 monedas) al jugador
    const newGold = player.gold - CLAIM_COST;
    await client.query(
      'UPDATE players SET gold = $1 WHERE player_id = $2',
      [newGold, player_id]
    );

    // Commit transacción
    await client.query('COMMIT');

    const territoryWord = isFirstTerritory ? 'capital' : `territorio #${playerTerritoryCount + 1}`;
    const capitalFlag = isFirstTerritory ? '👑 CAPITAL' : '';
    console.log(`✓ Player ${player.username} claimed ${h3_index} (${territoryWord}) ${capitalFlag} for ${CLAIM_COST} gold. New balance: ${newGold}`);

    res.json({
      success: true,
      new_gold_balance: newGold,
      is_capital: isFirstTerritory,
      iron_vein_found: ironVeinFound,
      initial_iron: initialIron,
      message: isFirstTerritory
        ? '👑 ¡Capital fundada! Tu reino comienza aquí.'
        : `🏰 ¡Territorio #${playerTerritoryCount + 1} colonizado!`,
      iron_message: ironVeinFound
        ? `⛏️ ¡VETA DE HIERRO ENCONTRADA! +${initialIron} hierro`
        : null
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error claiming territory:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/map/cell-details/:h3_index
 * Returns detailed information about a specific hexagon cell
 *
 * Response: {
 *   h3_index: string,
 *   terrain_type: string,
 *   terrain_color: string,
 *   player_id: number | null,
 *   player_name: string | null,
 *   player_color: string | null,
 *   building_type: string | null,
 *   is_capital: boolean,
 *   settlement_name: string | null,
 *   settlement_type: string | null,
 *   territory: {
 *     population: number,
 *     happiness: number,
 *     food: number,
 *     wood: number,
 *     stone: number,
 *     iron: number
 *   } | null
 * }
 */
app.get('/api/map/cell-details/:h3_index', async (req, res) => {
  try {
    const { h3_index } = req.params;

    // Convert hex string to BIGINT
    const h3_bigint = BigInt('0x' + h3_index).toString();

    // Query to get all cell details (join h3_map, territory_details, players, settlements, terrain_types, building_types)
    const query = `
      SELECT
        m.h3_index,
        t.name AS terrain_type,
        t.color AS terrain_color,
        m.player_id,
        p.username AS player_name,
        p.color AS player_color,
        b.name AS building_type,
        m.is_capital,
        s.name AS settlement_name,
        s.type AS settlement_type,
        td.population,
        td.happiness,
        td.food_stored,
        td.wood_stored,
        td.stone_stored,
        td.iron_stored
      FROM h3_map m
      LEFT JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
      LEFT JOIN players p ON m.player_id = p.player_id
      LEFT JOIN building_types b ON m.building_type_id = b.building_type_id
      LEFT JOIN settlements s ON m.h3_index = s.h3_index
      LEFT JOIN territory_details td ON m.h3_index = td.h3_index
      WHERE m.h3_index = $1
    `;

    const result = await pool.query(query, [h3_bigint]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Hexágono no encontrado'
      });
    }

    const cell = result.rows[0];

    // Build response
    const response = {
      h3_index: h3_index,
      terrain_type: cell.terrain_type,
      terrain_color: cell.terrain_color,
      player_id: cell.player_id,
      player_name: cell.player_name,
      player_color: cell.player_color,
      building_type: cell.building_type,
      is_capital: cell.is_capital || false,
      settlement_name: cell.settlement_name,
      settlement_type: cell.settlement_type,
      territory: cell.population ? {
        population: cell.population,
        happiness: cell.happiness,
        food: cell.food_stored,
        wood: cell.wood_stored,
        stone: cell.stone_stored,
        iron: cell.iron_stored
      } : null
    };

    res.json(response);

  } catch (error) {
    console.error('Error fetching cell details:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
});

/**
 * GET /api/players/:id
 * Returns player details including gold
 *
 * Response: {
 *   player_id: number,
 *   username: string,
 *   gold: number,
 *   color: string
 * }
 */
app.get('/api/players/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT player_id, username, gold, color
      FROM players
      WHERE player_id = $1
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching player:', error);
    res.status(500).json({ error: 'Internal server error' });
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

// Start server only if this file is run directly (not imported by tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📍 API endpoints:`);
    console.log(`   - GET /api/map/region?minLat=X&maxLat=X&minLng=X&maxLng=X&res=8`);
    console.log(`   - GET /api/settlements`);
    console.log(`   - GET /api/terrain-types`);
    console.log(`   - POST /api/game/claim (Colonize territory with strict rules)`);
    console.log(`   - GET /health`);
    console.log(`\n⚔️  Colonization Rules:`);
    console.log(`   1. Cannot colonize Sea or Water`);
    console.log(`   2. Must have 100 gold`);
    console.log(`   3. Must be adjacent to owned territory (except first territory)`);
  });
}

// Export app for testing
module.exports = app;
