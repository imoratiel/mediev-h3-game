const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pool = require('./db');
const h3 = require('h3-js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Log file configuration
const LOG_FILE = path.join(__dirname, 'server.log');

/**
 * Log game events to server.log file
 * @param {string} message - The message to log
 */
function logGameEvent(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;

  try {
    fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
  } catch (error) {
    console.error('Error writing to log file:', error);
  }
}

// Clear log file on server startup
try {
  if (fs.existsSync(LOG_FILE)) {
    fs.unlinkSync(LOG_FILE);
    console.log('✓ Previous server.log cleared');
  }
  logGameEvent('========== SERVER STARTED ==========');
} catch (error) {
  console.error('Error clearing log file:', error);
}

/**
 * Format days into human-readable years and days
 * @param {number} days - Total days
 * @returns {string} Formatted string like "2 años y 45 días"
 */
function formatDaysToYearsAndDays(days) {
  if (days >= 999999) {
    return 'más de 2,700 años (reservas ilimitadas)';
  }

  const years = Math.floor(days / 365);
  const remainingDays = days % 365;

  if (years === 0) {
    return `${remainingDays} día${remainingDays !== 1 ? 's' : ''}`;
  } else if (remainingDays === 0) {
    return `${years} año${years !== 1 ? 's' : ''}`;
  } else {
    return `${years} año${years !== 1 ? 's' : ''} y ${remainingDays} día${remainingDays !== 1 ? 's' : ''}`;
  }
}

// Middleware
app.use(cors({
  origin: 'http://localhost:5173', // Vite dev server
  credentials: true
}));
app.use(express.json());

// Session configuration
app.use(session({
  secret: 'medieval-game-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Authentication middleware - checks if user is logged in
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'Autenticación requerida. Por favor, inicia sesión.'
    });
  }
  next();
};

// Admin authentication middleware - checks if user is admin
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        success: false,
        message: 'Autenticación requerida. Por favor, inicia sesión.'
      });
    }

    if (req.session.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado. Se requieren permisos de administrador.'
      });
    }

    next();
  } catch (error) {
    console.error('Error in admin middleware:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};

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

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

/**
 * POST /api/auth/login
 * Login endpoint - validates credentials and creates session
 * Body: { username: string, password: string }
 * Returns: { success: boolean, user: { player_id, username, role } }
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Usuario y contraseña requeridos'
      });
    }

    // Query user from database
    const result = await pool.query(
      'SELECT player_id, username, password, role FROM players WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Usuario o contraseña incorrectos'
      });
    }

    const user = result.rows[0];

    // Simple password comparison (in production, use bcrypt)
    if (password !== user.password) {
      return res.status(401).json({
        success: false,
        message: 'Usuario o contraseña incorrectos'
      });
    }

    // Create session
    req.session.user = {
      player_id: user.player_id,
      username: user.username,
      role: user.role || 'player'
    };

    console.log(`✓ User logged in: ${user.username} (${user.role})`);

    res.json({
      success: true,
      user: {
        player_id: user.player_id,
        username: user.username,
        role: user.role || 'player'
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout endpoint - destroys session
 */
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({
        success: false,
        message: 'Error al cerrar sesión'
      });
    }
    res.json({
      success: true,
      message: 'Sesión cerrada exitosamente'
    });
  });
});

/**
 * GET /api/auth/me
 * Get current user session
 * Returns: { success: boolean, user: { player_id, username, role } }
 */
app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'No hay sesión activa'
    });
  }

  res.json({
    success: true,
    user: req.session.user
  });
});

// ============================================
// MAP AND GAME ENDPOINTS
// ============================================

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
    // IMPORTANT: h3_index is stored as TEXT (hexadecimal string), not BIGINT
    // h3-js returns hex strings, DB stores hex strings - no conversion needed
    const h3IndexValues = cellsToQuery; // Already hex strings

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
    // h3_index is already a hexadecimal string - no conversion needed
    const hexagons = result.rows.map(row => {
      return {
        h3_index: row.h3_index,  // Already hexadecimal string for h3-js
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
  console.log('[API] Fetching terrain types...');
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
app.post('/api/game/claim', requireAuth, async (req, res) => {
  const client = await pool.connect();

  try {
    const player_id = req.session.user.player_id; // Get from session
    const { h3_index } = req.body;

    // Validar parámetros
    if (!h3_index) {
      return res.status(400).json({
        success: false,
        message: 'Falta parámetro: h3_index'
      });
    }

    console.log(`[Claim] Player ${player_id} attempting to claim ${h3_index}`);

    // IMPORTANT: h3_index is stored as TEXT (hexadecimal string), not BIGINT
    // No conversion needed - use h3_index directly

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
    const hexResult = await client.query(hexQuery, [h3_index]);

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

      // No conversion needed - h3_index is stored as TEXT
      // immediateNeighbors is already an array of hex strings

      // Verificar si algún vecino pertenece al jugador
      const neighborQuery = `
        SELECT COUNT(*) as count
        FROM h3_map
        WHERE player_id = $1 AND h3_index = ANY($2::text[])
      `;
      const neighborResult = await client.query(neighborQuery, [player_id, immediateNeighbors]);
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

    // GOLD: Precious metal with 1/20 probability in mountains
    let initialGold = 0;
    let goldVeinFound = false;

    if (hex.terrain_name === 'Mountains' || hex.terrain_name === 'Hills') {
      // 1 in 50 chance to find a gold vein (2% - even rarer than iron's 3.33%)
      const foundGoldVein = Math.random() < (1 / 50);

      if (foundGoldVein) {
        goldVeinFound = true;
        // HIGH VALUE / LOW VOLUME: Gold is extremely scarce
        // Generate 0.5 to 2.5 units (10x less than other resources)
        const baseGold = getRandomInt(5, 25);
        initialGold = (baseGold * 0.1).toFixed(2);

        console.log(`🎉 [Claim] GOLD VEIN FOUND! Initial gold: ${initialGold} (terrain: ${hex.terrain_name})`);
        logGameEvent(`[MINERÍA] ¡Veta de oro descubierta en el feudo ${h3_index}! Cantidad inicial: ${initialGold} unidades`);
      } else {
        console.log(`[Claim] No gold vein found (terrain has potential: ${hex.terrain_name})`);
      }
    } else {
      console.log(`[Claim] Terrain has no gold potential (${hex.terrain_name})`);
    }

    console.log(`[Claim] Generated initial economy: pop=${initialPopulation}, happiness=${initialHappiness}, food=${initialFood}, wood=${initialWood}, stone=${initialStone}, iron=${initialIron}, gold=${initialGold}`);

    // PASO 3: Actualizar h3_map - Asignar hexágono al jugador sin edificio inicial (building_type_id = 0)
    await client.query(
      `UPDATE h3_map
       SET player_id = $1, building_type_id = 0, is_capital = $2, last_update = CURRENT_TIMESTAMP
       WHERE h3_index = $3`,
      [player_id, isFirstTerritory, h3_index]
    );

    // PASO 4: Insertar en territory_details
    const insertTerritoryDetailsQuery = `
      INSERT INTO territory_details (h3_index, population, happiness, food_stored, wood_stored, stone_stored, iron_stored, oro)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (h3_index)
      DO UPDATE SET
        population = EXCLUDED.population,
        happiness = EXCLUDED.happiness,
        food_stored = EXCLUDED.food_stored,
        wood_stored = EXCLUDED.wood_stored,
        stone_stored = EXCLUDED.stone_stored,
        iron_stored = EXCLUDED.iron_stored,
        oro = EXCLUDED.oro
    `;
    await client.query(insertTerritoryDetailsQuery, [
      h3_index,
      initialPopulation,
      initialHappiness,
      initialFood,
      initialWood,
      initialStone,
      initialIron,
      initialGold
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
      gold_vein_found: goldVeinFound,
      initial_gold: initialGold,
      message: isFirstTerritory
        ? '👑 ¡Capital fundada! Tu reino comienza aquí.'
        : `🏰 ¡Territorio #${playerTerritoryCount + 1} colonizado!`,
      iron_message: ironVeinFound
        ? `⛏️ ¡VETA DE HIERRO ENCONTRADA! +${initialIron} hierro`
        : null,
      gold_message: goldVeinFound
        ? `💰 ¡VETA DE ORO ENCONTRADA! +${initialGold} oro`
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
 * GET /api/game/capital?player_id=X
 * Returns the h3_index of the player's capital territory
 *
 * Query params:
 *   player_id: number (required)
 *
 * Response: {
 *   success: boolean,
 *   h3_index: string | null,
 *   message: string
 * }
 */
app.get('/api/game/capital', requireAuth, async (req, res) => {
  try {
    const player_id = req.session.user.player_id; // Get from session

    const query = `
      SELECT h3_index
      FROM h3_map
      WHERE player_id = $1 AND is_capital = TRUE
      LIMIT 1
    `;

    const result = await pool.query(query, [player_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        h3_index: null,
        message: 'Aún no has colonizado tu primer territorio'
      });
    }

    res.json({
      success: true,
      h3_index: result.rows[0].h3_index,
      message: 'Capital encontrada'
    });

  } catch (error) {
    console.error('Error fetching capital:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
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

    // IMPORTANT: h3_index is stored as TEXT (hexadecimal string), not BIGINT
    // No conversion needed - use h3_index directly

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

    const result = await pool.query(query, [h3_index]);

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
 * GET /api/game/world-state
 * Returns current world state (turn and date)
 *
 * Response: {
 *   success: boolean,
 *   turn: number,
 *   date: string,
 *   is_paused: boolean
 * }
 */
app.get('/api/game/world-state', async (req, res) => {
  try {
    const query = `
      SELECT current_turn, game_date, is_paused
      FROM world_state
      WHERE id = 1
    `;
    const result = await pool.query(query);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'World state not found'
      });
    }

    const { current_turn, game_date, is_paused } = result.rows[0];

    res.json({
      success: true,
      turn: current_turn,
      date: game_date,
      is_paused: is_paused
    });

  } catch (error) {
    console.error('Error fetching world state:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
});

/**
 * GET /api/game/my-fiefs
 * Returns all territories (fiefs) owned by a specific player
 *
 * Query params:
 *   - player_id (required): The player ID to filter territories
 *
 * Response: {
 *   success: boolean,
 *   fiefs: Array<{
 *     h3_index: string,
 *     location_name: string | null,
 *     population: number,
 *     food_stored: number,
 *     terrain_name: string
 *   }>
 * }
 */
app.get('/api/game/my-fiefs', requireAuth, async (req, res) => {
  try {
    const player_id = req.session.user.player_id; // Get from session

    console.log(`[My Fiefs] Request received for player_id: ${player_id}`);

    const query = `
      SELECT
        m.h3_index,
        COALESCE(td.custom_name, s.name, 'Territorio sin nombre') AS location_name,
        CAST(td.population AS INTEGER) AS population,
        CAST(td.food_stored AS DOUBLE PRECISION) AS food_stored,
        t.name AS terrain_name
      FROM h3_map m
      JOIN territory_details td ON m.h3_index = td.h3_index
      JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
      LEFT JOIN settlements s ON m.h3_index = s.h3_index
      WHERE m.player_id = $1
      ORDER BY td.population DESC, td.food_stored DESC
    `;

    const result = await pool.query(query, [player_id]);

    console.log(`[My Fiefs] Found ${result.rows.length} fiefs for player ${player_id}`);

    // Debug: Log first result structure if exists
    if (result.rows.length > 0) {
      console.log('[My Fiefs] First fief sample:', JSON.stringify(result.rows[0], null, 2));
      console.log('[My Fiefs] Fields returned:', Object.keys(result.rows[0]));
    } else {
      console.log('[My Fiefs] No territories found for this player - they may not have colonized any yet');
    }

    res.json({
      success: true,
      fiefs: result.rows
    });

  } catch (error) {
    console.error('Error fetching player fiefs:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
});

/**
 * Core game turn processing function
 * Handles all turn advancement logic including food consumption and harvests
 * Can be called by both the time engine and manual endpoints
 *
 * @returns {Object} Turn result data
 */
async function processGameTurn() {
  const client = await pool.connect();

  try {
    console.log('[Game Engine] Processing turn advancement...');

    // Begin transaction
    await client.query('BEGIN');

    // Step 1: Get current world state
    const currentStateQuery = `
      SELECT current_turn, game_date, days_per_year
      FROM world_state
      WHERE id = 1
    `;
    const currentState = await client.query(currentStateQuery);

    if (currentState.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({
        success: false,
        message: 'World state not found'
      });
    }

    const { current_turn, game_date, days_per_year } = currentState.rows[0];
    const newTurn = current_turn + 1;
    const dayOfYear = newTurn % (days_per_year || 365);

    console.log(`[Next Turn] Current: ${current_turn}, Date: ${game_date}, Day of Year: ${dayOfYear}`);

    // Step 2: Update world state (increment turn, advance date by 1 day)
    const updateWorldQuery = `
      UPDATE world_state
      SET
        current_turn = current_turn + 1,
        game_date = game_date + INTERVAL '1 day',
        last_updated = CURRENT_TIMESTAMP
      WHERE id = 1
      RETURNING current_turn, game_date
    `;
    const newState = await client.query(updateWorldQuery);
    const { current_turn: newCurrentTurn, game_date: newGameDate } = newState.rows[0];

    console.log(`[Next Turn] New: ${newCurrentTurn}, Date: ${newGameDate}`);

    // Step 3: Process daily food consumption for all territories
    // NEW FORMULA: food_stored = food_stored - (floor(population / 100) * 0.01)
    const foodConsumptionQuery = `
      UPDATE territory_details
      SET food_stored = GREATEST(
        0,
        food_stored - (FLOOR(population / 100.0) * 0.01)
      )
      WHERE h3_index IN (
        SELECT h3_index FROM h3_map WHERE player_id IS NOT NULL
      )
    `;
    const consumptionResult = await client.query(foodConsumptionQuery);
    const territoriesProcessed = consumptionResult.rowCount;

    console.log(`[Next Turn] Food consumption processed for ${territoriesProcessed} territories`);

    // Step 3.5: Monthly Census - Population Dynamics (every 30 turns)
    const isCensusDay = ((newCurrentTurn - 1) % 30) === 0;
    let censusResults = { totalGrowth: 0, plagueEvents: 0, famineEvents: 0 };

    if (isCensusDay) {
      console.log('[Census] 📊 MONTHLY CENSUS - Processing population dynamics...');
      logGameEvent('[CENSO] Inicio del censo mensual de población');

      // Maximum population capacities by terrain type
      const TERRAIN_CAPACITY = {
        'Plains': 10000,
        'Grass': 8000,
        'Forest': 4000,
        'Hills': 1500,
        'Swamp': 800,
        'Desert': 500,
        'Tundra': 500
      };

      // Get all territories with population data
      const censusQuery = `
        SELECT
          td.h3_index,
          td.population,
          td.food_stored,
          t.name as terrain_type,
          m.player_id
        FROM territory_details td
        JOIN h3_map m ON td.h3_index = m.h3_index
        JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
        WHERE m.player_id IS NOT NULL
      `;
      const territories = await client.query(censusQuery);

      // Track events by player for notifications
      const playerEvents = new Map(); // player_id -> { plague: [], famine: [] }

      for (const territory of territories.rows) {
        const { h3_index, population, food_stored, terrain_type, player_id } = territory;

        // Calculate daily consumption and days of autonomy
        const dailyConsumption = (population / 100.0) * 0.01;
        const daysOfProvisions = dailyConsumption > 0 ? Math.floor(food_stored / dailyConsumption) : 999999;

        // Get max capacity for this terrain
        const maxCapacity = TERRAIN_CAPACITY[terrain_type] || 1000;

        // Determine growth factor based on food autonomy
        let growthFactor = 0;
        let growthCategory = '';

        if (daysOfProvisions === 0) {
          // Severe famine
          growthFactor = -0.30 + Math.random() * -0.20; // random(-0.30, -0.50)
          growthCategory = 'HAMBRUNA SEVERA';

          // Track famine event
          if (!playerEvents.has(player_id)) {
            playerEvents.set(player_id, { plague: [], famine: [] });
          }
          playerEvents.get(player_id).famine.push({ h3_index, population, terrain_type });
          censusResults.famineEvents++;
        } else if (daysOfProvisions <= 30) {
          // Hunger
          growthFactor = -0.05 + Math.random() * -0.07; // random(-0.05, -0.12)
          growthCategory = 'HAMBRE';
        } else if (daysOfProvisions <= 180) { // 1-6 months
          // Scarcity
          growthFactor = -0.005 + Math.random() * -0.015; // random(-0.005, -0.02)
          growthCategory = 'ESCASEZ';
        } else if (daysOfProvisions <= 420) { // 6-14 months
          // Stable
          growthFactor = 0.005 + Math.random() * 0.015; // random(+0.005, +0.02)
          growthCategory = 'ESTABLE';
        } else if (daysOfProvisions <= 720) { // 14-24 months
          // Prosperous
          growthFactor = 0.03 + Math.random() * 0.02; // random(+0.03, +0.05)
          growthCategory = 'PRÓSPERO';
        } else { // > 24 months
          // Very prosperous
          growthFactor = 0.06 + Math.random() * 0.04; // random(+0.06, +0.10)
          growthCategory = 'MUY PRÓSPERO';
        }

        // Check for overcrowding and plague
        let plagueOccurred = false;
        if (population > maxCapacity) {
          // Severe overcrowding - plague outbreak
          if (growthFactor > 0) {
            growthFactor = 0; // Cancel positive growth
          }
          // Apply plague mortality
          const plagueMortality = 0.05 + Math.random() * 0.10; // random(0.05, 0.15)
          growthFactor -= plagueMortality;
          plagueOccurred = true;

          // Track plague event
          if (!playerEvents.has(player_id)) {
            playerEvents.set(player_id, { plague: [], famine: [] });
          }
          playerEvents.get(player_id).plague.push({ h3_index, population, maxCapacity, terrain_type });
          censusResults.plagueEvents++;

          logGameEvent(`[PESTE] Epidemia en ${h3_index} (${terrain_type}) por superar los ${maxCapacity} habitantes (población: ${population})`);
          console.log(`[Census] ☠️ PLAGUE in ${h3_index}: Population ${population} exceeds capacity ${maxCapacity}`);
        } else if (population > maxCapacity * 0.8) {
          // Moderate overcrowding - reduce growth
          if (growthFactor > 0) {
            growthFactor *= 0.5; // Reduce positive growth by 50%
            console.log(`[Census] ⚠️ Overcrowding in ${h3_index}: Growth reduced (${population}/${maxCapacity})`);
          }
        }

        // Calculate new population
        const populationChange = Math.floor(population * growthFactor);
        const newPopulation = Math.max(0, population + populationChange);

        // Update population
        await client.query(
          `UPDATE territory_details SET population = $1 WHERE h3_index = $2`,
          [newPopulation, h3_index]
        );

        censusResults.totalGrowth += populationChange;

        // Log detailed census data
        const statusEmoji = plagueOccurred ? '☠️' : (populationChange >= 0 ? '📈' : '📉');
        logGameEvent(
          `[CENSO] ${h3_index} (${terrain_type}): ${population} → ${newPopulation} (${populationChange >= 0 ? '+' : ''}${populationChange}) | ` +
          `${growthCategory} | ${daysOfProvisions} días autonomía | ${statusEmoji}`
        );
      }

      // Send notifications to affected players
      for (const [player_id, events] of playerEvents.entries()) {
        if (events.plague.length > 0 || events.famine.length > 0) {
          let subject = '⚠️ Censo Mensual - Eventos Críticos';
          let body = '📊 El censo mensual ha revelado situaciones críticas en tu reino:\n\n';

          if (events.plague.length > 0) {
            body += '☠️ EPIDEMIAS DE PESTE:\n';
            for (const plague of events.plague) {
              body += `- ${plague.terrain_type} (${plague.h3_index}): ${plague.population} habitantes superan la capacidad de ${plague.maxCapacity}. La peste ha causado bajas significativas.\n`;
            }
            body += '\n';
          }

          if (events.famine.length > 0) {
            body += '🍂 HAMBRUNAS SEVERAS:\n';
            for (const famine of events.famine) {
              body += `- ${famine.terrain_type} (${famine.h3_index}): ${famine.population} habitantes sin reservas de alimento. La población está muriendo de hambre.\n`;
            }
            body += '\n';
          }

          body += '⚡ ACCIONES RECOMENDADAS:\n';
          if (events.plague.length > 0) {
            body += '- Reduce la población mediante migración o evita el hacinamiento\n';
          }
          if (events.famine.length > 0) {
            body += '- Envía alimentos de emergencia desde otros feudos\n';
            body += '- Espera la próxima cosecha y prioriza la agricultura\n';
          }

          await client.query(
            `INSERT INTO messages (sender_id, receiver_id, subject, body)
             VALUES (NULL, $1, $2, $3)`,
            [player_id, subject, body]
          );
        }
      }

      console.log(`[Census] ✓ Census complete - Total growth: ${censusResults.totalGrowth}, Plagues: ${censusResults.plagueEvents}, Famines: ${censusResults.famineEvents}`);
      logGameEvent(`[CENSO COMPLETADO] Crecimiento total: ${censusResults.totalGrowth} | Pestes: ${censusResults.plagueEvents} | Hambrunas: ${censusResults.famineEvents}`);
    }

    // Step 4: Check if today is a harvest day (Day 75 = Spring, Day 180 = Summer)
    const isHarvestDay = dayOfYear === 75 || dayOfYear === 180;
    let harvestResults = null;
    let harvestMessage = '';

    if (isHarvestDay) {
      const harvestSeason = dayOfYear === 75 ? 'PRIMAVERA' : 'VERANO';
      console.log(`[Harvest] 🌾 ${harvestSeason} HARVEST DAY - Processing yields...`);

      // Get all player territories with fertility data
      const territoriesQuery = `
        SELECT
          td.h3_index,
          td.population,
          t.fertility
        FROM territory_details td
        JOIN h3_map m ON td.h3_index = m.h3_index
        JOIN terrain_types t ON m.terrain_type_id = t.terrain_type_id
        WHERE m.player_id IS NOT NULL
      `;
      const territories = await client.query(territoriesQuery);

      // Statistics counters
      const stats = { disastrous: 0, poor: 0, normal: 0, good: 0, excellent: 0 };

      // Track harvest yield per player (for detailed messages)
      const playerHarvestData = new Map();

      // Process each territory
      for (const territory of territories.rows) {
        const { h3_index, population, fertility } = territory;

        // Get player_id for this territory
        const ownerQuery = await client.query(
          'SELECT player_id FROM h3_map WHERE h3_index = $1',
          [h3_index]
        );
        const player_id = ownerQuery.rows[0]?.player_id;

        // Calculate Annual Need (NA)
        const annualNeed = (population / 100.0) * 0.01 * 365;

        // Roll dice (1-100)
        let roll = Math.floor(Math.random() * 100) + 1;

        // Fertility bonus: +10 if fertility > 80
        if (fertility > 80) {
          roll += 10;
          console.log(`[Harvest] ${h3_index}: Fertility bonus applied (+10)`);
        }

        // Determine yield multiplier based on probabilities
        let multiplier;
        let resultType;

        if (roll <= 5) {
          multiplier = 0.3;
          resultType = 'disastrous';
          stats.disastrous++;
        } else if (roll <= 25) {
          multiplier = 0.6;
          resultType = 'poor';
          stats.poor++;
        } else if (roll <= 45) {
          multiplier = 1.0;
          resultType = 'normal';
          stats.normal++;
        } else if (roll <= 80) {
          multiplier = 1.4;
          resultType = 'good';
          stats.good++;
        } else {
          multiplier = 1.8;
          resultType = 'excellent';
          stats.excellent++;
        }

        // Apply organic variation (±5%)
        const variation = 0.95 + Math.random() * 0.1; // Between 0.95 and 1.05
        const baseYield = annualNeed * multiplier;
        const finalYield = Math.floor(baseYield * variation);

        console.log(`[Harvest] ${h3_index}: Roll=${roll}, Fertility=${fertility}, Type=${resultType}, Yield=${finalYield}`);

        // Track yield per player
        if (player_id) {
          if (!playerHarvestData.has(player_id)) {
            playerHarvestData.set(player_id, 0);
          }
          playerHarvestData.set(player_id, playerHarvestData.get(player_id) + finalYield);
        }

        // Update territory food storage
        await client.query(
          `UPDATE territory_details
           SET food_stored = food_stored + $1
           WHERE h3_index = $2`,
          [finalYield, h3_index]
        );
      }

      harvestResults = stats;
      harvestMessage = ` 🌾 ¡Cosecha de ${harvestSeason}! (Desastrosa: ${stats.disastrous}, Mala: ${stats.poor}, Normal: ${stats.normal}, Buena: ${stats.good}, Excelente: ${stats.excellent})`;
      console.log(`[Harvest] Results: ${JSON.stringify(stats)}`);

      // Step 5: Send detailed harvest messages to all players
      console.log('[Harvest] Sending detailed harvest messages to players...');

      // Get all players with territories
      const playersQuery = `
        SELECT DISTINCT m.player_id
        FROM h3_map m
        WHERE m.player_id IS NOT NULL
      `;
      const players = await client.query(playersQuery);

      // Send personalized messages to each player
      for (const player of players.rows) {
        const { player_id } = player;

        // Get player's economic data
        const economyQuery = `
          SELECT
            COUNT(td.h3_index) as territory_count,
            COALESCE(SUM(td.food_stored), 0) as total_reserves,
            COALESCE(SUM(td.population), 0) as total_population
          FROM territory_details td
          JOIN h3_map m ON td.h3_index = m.h3_index
          WHERE m.player_id = $1
        `;
        const economyData = await client.query(economyQuery, [player_id]);
        const { territory_count, total_reserves, total_population } = economyData.rows[0];

        // Ensure numeric values (prevent .toFixed() errors)
        const reserves = Number(total_reserves || 0);
        const population = Number(total_population || 0);
        const harvested = Number(playerHarvestData.get(player_id) || 0);

        // Calculate daily consumption and autonomy
        const dailyConsumption = (population / 100.0) * 0.01;
        const daysOfProvisions = dailyConsumption > 0 ? Math.floor(reserves / dailyConsumption) : 999999;

        const messageSubject = `🌾 Informe de Cosecha de ${harvestSeason}`;
        const messageBody = `
La cosecha de ${harvestSeason} ha finalizado.

📦 PRODUCCIÓN:
Se han recolectado ${harvested.toFixed(1)} unidades de alimento en tus ${territory_count} territorios.

🏛️ RESERVAS TOTALES:
Tus graneros almacenan ${reserves.toFixed(1)} unidades tras la cosecha.

⏳ AUTONOMÍA:
Con un consumo diario de ${dailyConsumption.toFixed(2)} unidades (${population} habitantes), tus provisiones garantizan suministros para ${formatDaysToYearsAndDays(daysOfProvisions)} al ritmo actual.

Resumen de calidad de cosechas:
- Desastrosas: ${stats.disastrous}
- Malas: ${stats.poor}
- Normales: ${stats.normal}
- Buenas: ${stats.good}
- Excelentes: ${stats.excellent}

¡Que tus graneros estén llenos!
        `.trim();

        await client.query(
          `INSERT INTO messages (sender_id, receiver_id, subject, body)
           VALUES (NULL, $1, $2, $3)`,
          [player_id, messageSubject, messageBody]
        );

        console.log(`[Harvest] ✓ Sent detailed harvest message to player ${player_id} (Harvested: ${harvested.toFixed(1)}, Reserves: ${reserves.toFixed(1)}, Days: ${daysOfProvisions})`);

        // Log harvest summary
        logGameEvent(`[COSECHA] Jugador ${player_id}: ${harvested.toFixed(1)} recolectadas, ${reserves.toFixed(1)} en reservas, ${daysOfProvisions} días de autonomía`);
      }

      console.log(`[Harvest] ✓ Sent ${players.rows.length} detailed harvest messages`);

      // Log harvest completion
      logGameEvent(`[COSECHA COMPLETADA] ${harvestSeason} - ${players.rows.length} jugadores notificados. Resultados: ${JSON.stringify(stats)}`);
    }

    // Commit transaction
    await client.query('COMMIT');

    const baseMessage = `Turno ${newCurrentTurn} procesado. Día ${dayOfYear} de 365.`;
    const finalMessage = isHarvestDay ? baseMessage + harvestMessage : baseMessage;

    const result = {
      success: true,
      turn: newCurrentTurn,
      date: newGameDate,
      dayOfYear: dayOfYear,
      territories_processed: territoriesProcessed,
      isHarvestDay: isHarvestDay,
      harvestResults: harvestResults,
      message: finalMessage
    };

    client.release();
    return result;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Game Engine] Error processing turn:', error);
    client.release();
    throw error;
  }
}

/**
 * POST /api/game/next-turn
 * Manual turn advancement endpoint (optional - can be disabled in production)
 *
 * Response: {
 *   success: boolean,
 *   turn: number,
 *   date: string,
 *   dayOfYear: number,
 *   territories_processed: number,
 *   isHarvestDay: boolean,
 *   harvestResults?: object,
 *   message: string
 * }
 */
app.post('/api/game/next-turn', async (req, res) => {
  try {
    console.log('[API] Manual turn advancement requested');
    const result = await processGameTurn();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
});

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

/**
 * POST /api/admin/reset
 * Resets the game world to initial state
 * Requires admin role
 */
app.post('/api/admin/reset', requireAdmin, async (req, res) => {
  try {
    console.log('[Admin] Resetting game world...');

    await pool.query(`
      UPDATE world_state
      SET
        current_turn = 0,
        game_date = '1039-03-01',
        last_updated = CURRENT_TIMESTAMP
      WHERE id = 1
    `);

    console.log('[Admin] ✓ Game world reset successfully');

    res.json({
      success: true,
      message: 'Mundo del juego reseteado al turno 0 (1 de Marzo, 1039)'
    });
  } catch (error) {
    console.error('[Admin] Error resetting game:', error);
    res.status(500).json({
      success: false,
      message: 'Error al resetear el mundo',
      error: error.message
    });
  }
});

/**
 * POST /api/admin/config
 * Updates game configuration (turn interval)
 * Requires admin role
 */
app.post('/api/admin/config', requireAdmin, async (req, res) => {
  try {
    const { turn_interval_seconds } = req.body;

    if (!turn_interval_seconds || turn_interval_seconds < 5) {
      return res.status(400).json({
        success: false,
        message: 'El intervalo debe ser al menos 5 segundos'
      });
    }

    console.log(`[Admin] Changing turn interval to ${turn_interval_seconds} seconds`);

    // Note: This would require restarting the time engine
    // For now, we'll just log the change
    const newInterval = turn_interval_seconds * 1000;

    // Restart time engine with new interval
    stopTimeEngine();
    TURN_INTERVAL = newInterval;
    startTimeEngine();

    console.log(`[Admin] ✓ Turn interval updated to ${turn_interval_seconds}s`);

    res.json({
      success: true,
      message: `Intervalo de turno actualizado a ${turn_interval_seconds} segundos`,
      turn_interval_seconds: turn_interval_seconds
    });
  } catch (error) {
    console.error('[Admin] Error updating config:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar configuración',
      error: error.message
    });
  }
});

/**
 * GET /api/admin/stats
 * Returns game statistics
 * Requires admin role
 */
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const worldState = await pool.query('SELECT * FROM world_state WHERE id = 1');
    const playerCount = await pool.query('SELECT COUNT(*) FROM players');
    const territoryCount = await pool.query('SELECT COUNT(*) FROM h3_map WHERE player_id IS NOT NULL');
    const messageCount = await pool.query('SELECT COUNT(*) FROM messages');

    res.json({
      success: true,
      stats: {
        current_turn: worldState.rows[0].current_turn,
        game_date: worldState.rows[0].game_date,
        players: parseInt(playerCount.rows[0].count),
        territories: parseInt(territoryCount.rows[0].count),
        messages: parseInt(messageCount.rows[0].count),
        turn_interval_seconds: Math.floor(TURN_INTERVAL / 1000)
      }
    });
  } catch (error) {
    console.error('[Admin] Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener estadísticas'
    });
  }
});

// ============================================================================
// MESSAGING SYSTEM
// ============================================================================

/**
 * GET /api/messages
 * Get messages for a specific player
 */
app.get('/api/messages', requireAuth, async (req, res) => {
  try {
    const player_id = req.session.user.player_id; // Get from session
    const { unread_only, type } = req.query; // type can be 'received', 'sent', or 'all'

    let query = `
      SELECT
        m.*,
        sender.username AS sender_username,
        receiver.username AS receiver_username
      FROM messages m
      LEFT JOIN players sender ON m.sender_id = sender.player_id
      LEFT JOIN players receiver ON m.receiver_id = receiver.player_id
      WHERE 1=1
    `;

    const params = [player_id];

    // Filter by message type
    if (type === 'sent') {
      query += ' AND m.sender_id = $1';
    } else if (type === 'received') {
      query += ' AND m.receiver_id = $1';
    } else {
      // Default: show both sent and received
      query += ' AND (m.receiver_id = $1 OR m.sender_id = $1)';
    }

    if (unread_only === 'true') {
      query += ' AND m.receiver_id = $1 AND m.is_read = FALSE';
    }

    query += ' ORDER BY m.sent_at DESC LIMIT 100';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener mensajes'
    });
  }
});

/**
 * POST /api/messages
 * Send a message to another player
 */
app.post('/api/messages', requireAuth, async (req, res) => {
  try {
    const sender_id = req.session.user.player_id; // Get from session
    const { recipient_username, subject, body, h3_index, parent_id } = req.body;

    if (!recipient_username || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos: recipient_username, subject, body'
      });
    }

    // Look up receiver by username (case-insensitive)
    const receiverResult = await pool.query(
      `SELECT player_id FROM players WHERE LOWER(username) = LOWER($1)`,
      [recipient_username]
    );

    if (receiverResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Usuario "${recipient_username}" no encontrado`
      });
    }

    const receiver_id = receiverResult.rows[0].player_id;

    // Determine thread_id
    let thread_id = null;
    if (parent_id) {
      // This is a reply - get thread_id from parent message
      const parentResult = await pool.query(
        `SELECT thread_id FROM messages WHERE id = $1`,
        [parent_id]
      );
      if (parentResult.rows.length > 0) {
        thread_id = parentResult.rows[0].thread_id || parent_id;
      }
    }

    // Insert message
    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, subject, body, h3_index, thread_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [sender_id, receiver_id, subject, body, h3_index || null, thread_id]
    );

    // If no parent_id (new thread), set thread_id to its own ID
    if (!parent_id) {
      const messageId = result.rows[0].id;
      await pool.query(
        `UPDATE messages SET thread_id = $1 WHERE id = $1`,
        [messageId]
      );
      result.rows[0].thread_id = messageId;
    }

    // Get sender username for logging
    const senderResult = await pool.query(
      `SELECT username FROM players WHERE player_id = $1`,
      [sender_id]
    );
    const senderUsername = senderResult.rows[0]?.username || 'Unknown';

    // Log message sent
    logGameEvent(`[MENSAJE] De: ${senderUsername} Para: ${recipient_username} - Asunto: ${subject}`);

    res.json({
      success: true,
      message: '¡Mensajero enviado con éxito!',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Error al enviar mensaje'
    });
  }
});

/**
 * GET /api/messages/thread/:threadId
 * Get all messages in a thread
 */
app.get('/api/messages/thread/:threadId', requireAuth, async (req, res) => {
  try {
    const { threadId } = req.params;
    const player_id = req.session.user.player_id;

    const result = await pool.query(
      `SELECT
        m.*,
        sender.username AS sender_username,
        receiver.username AS receiver_username
      FROM messages m
      LEFT JOIN players sender ON m.sender_id = sender.player_id
      LEFT JOIN players receiver ON m.receiver_id = receiver.player_id
      WHERE m.thread_id = $1
        AND (m.receiver_id = $2 OR m.sender_id = $2)
      ORDER BY m.sent_at ASC`,
      [threadId, player_id]
    );

    res.json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error('Error fetching thread:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener hilo de mensajes'
    });
  }
});

/**
 * PUT /api/messages/:id/read
 * Mark a message as read
 */
app.put('/api/messages/:id/read', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const player_id = req.session.user.player_id; // Get from session

    // Verify message belongs to player
    const result = await pool.query(
      `UPDATE messages
       SET is_read = TRUE
       WHERE id = $1 AND receiver_id = $2
       RETURNING *`,
      [id, player_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Mensaje no encontrado'
      });
    }

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Error marking message as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error al marcar mensaje como leído'
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

// ============================================================================
// GAME TIME ENGINE - Autonomous Turn Processing
// ============================================================================

// Configuration
let TURN_INTERVAL = 15 * 1000; // 15 seconds for testing (use 300000 for 5 minutes in production)
let timeEngineIntervalId = null;

/**
 * Initialize and start the game time engine
 * Processes turns automatically at regular intervals
 */
function startTimeEngine() {
  console.log('⏰ [Time Engine] Starting autonomous time engine...');
  console.log(`⏰ [Time Engine] Turn interval: ${TURN_INTERVAL / 1000} seconds`);

  // Clear any existing interval
  if (timeEngineIntervalId) {
    clearInterval(timeEngineIntervalId);
  }

  // Start processing turns at regular intervals
  timeEngineIntervalId = setInterval(async () => {
    try {
      console.log('\n⏰ [Time Engine] ========== AUTO TURN TRIGGER ==========');
      const result = await processGameTurn();
      console.log(`⏰ [Time Engine] ✓ Turn ${result.turn} completed successfully`);
      console.log(`⏰ [Time Engine] Date: ${result.date}, Day ${result.dayOfYear}/365`);

      if (result.isHarvestDay) {
        console.log(`⏰ [Time Engine] 🌾 HARVEST DAY! Results:`, result.harvestResults);
      }
    } catch (error) {
      console.error('⏰ [Time Engine] ❌ Error processing automated turn:', error.message);
    }
  }, TURN_INTERVAL);

  console.log('⏰ [Time Engine] ✓ Time engine started successfully');
}

/**
 * Stop the game time engine
 */
function stopTimeEngine() {
  if (timeEngineIntervalId) {
    clearInterval(timeEngineIntervalId);
    timeEngineIntervalId = null;
    console.log('⏰ [Time Engine] Time engine stopped');
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏰ [Time Engine] Received SIGINT, stopping time engine...');
  stopTimeEngine();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏰ [Time Engine] Received SIGTERM, stopping time engine...');
  stopTimeEngine();
  process.exit(0);
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

    // Start the autonomous time engine
    console.log('');
    startTimeEngine();
  });
}

// Export app for testing
module.exports = app;
