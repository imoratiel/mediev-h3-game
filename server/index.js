const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pool = require('./db');

const { CONFIG, loadGameConfig } = require('./src/config');
const { initializeLogger, logGameEvent, Logger } = require('./src/utils/logger');
const { startTimeEngine } = require('./src/logic/turn_engine');
const { loadGeoCultureCache } = require('./src/services/PlayerService');

const economy = require('./src/logic/economy');
const territory = require('./src/logic/territory');
const infrastructure = require('./src/logic/infrastructure');
const discovery = require('./src/logic/discovery');
const conquest = require('./src/logic/conquest');

// --- SANITY CHECK: ENVIRONMENT VARIABLES ---
console.log('--- Environment Variable Check ---');
console.log(`GEMINI_API_KEY present: ${process.env.GEMINI_API_KEY ? "SÍ" : "NO"}`);
console.log(`OPENAI_API_KEY present: ${process.env.OPENAI_API_KEY ? "SÍ" : "NO"}`);
console.log('---------------------------------');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Logger
initializeLogger();

// Orígenes CORS permitidos: configurables desde el entorno para soportar
// tanto el servidor Vite de desarrollo (5173) como el contenedor Docker (8080).
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map(o => o.trim());

// Middleware
app.use(cors({
    origin: (origin, callback) => {
        // Sin origin = petición same-origin, Postman o curl → permitir
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origen no permitido: ${origin}`));
    },
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser()); // Parse cookies for JWT extraction

// Serve static files (map-inspector.html and other debug tools)
app.use(express.static(path.join(__dirname, 'public')));

// Serve generated H3 tiles
const tilesDir = path.join(__dirname, 'tiles');

// Metadata ANTES del static para evitar que express.static intercepte /tiles/meta
app.get('/tiles/meta', (req, res) => {
  const fs = require('fs');
  try {
    const exists = fs.existsSync(tilesDir);
    Logger.engine(`[tiles/meta] tilesDir=${tilesDir} exists=${exists}`);
    if (!exists) return res.json({ minZoom: null, maxZoom: null });
    const entries = fs.readdirSync(tilesDir);
    Logger.engine(`[tiles/meta] entries=${JSON.stringify(entries)}`);
    const zooms = entries.map(d => parseInt(d)).filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (!zooms.length) return res.json({ minZoom: null, maxZoom: null });
    res.json({ minZoom: zooms[0], maxZoom: zooms[zooms.length - 1] });
  } catch (err) {
    Logger.error(err, { endpoint: '/tiles/meta', method: 'GET' });
    res.status(500).json({ minZoom: null, maxZoom: null, error: err.message });
  }
});

app.use('/tiles', express.static(tilesDir, {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  fallthrough: true,
}));

// Routes
const apiRoutes = require('./routes/api')();
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', database: 'connected' }));

// Start Server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await loadGameConfig(pool, logGameEvent);
  await loadGeoCultureCache();

  // Respect engine_auto_start flag persisted in game_config.
  // Defaults to true (start engine) unless an admin explicitly stopped it.
  const shouldAutoStart = CONFIG.system?.engine_auto_start !== false;
  if (shouldAutoStart) {
    startTimeEngine(pool, CONFIG);
  } else {
    console.log('⏸️  Engine auto-start disabled — use the admin panel to start it manually.');
  }
});

module.exports = app;
