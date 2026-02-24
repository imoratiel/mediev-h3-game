const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const pool = require('./db');
const path = require('path');

const { CONFIG, loadGameConfig } = require('./src/config');
const { initializeLogger, logGameEvent } = require('./src/utils/logger');
const { startTimeEngine } = require('./src/logic/turn_engine');

const economy = require('./src/logic/economy');
const territory = require('./src/logic/territory');
const infrastructure = require('./src/logic/infrastructure');
const discovery = require('./src/logic/discovery');
const conquest = require('./src/logic/conquest');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Logger
initializeLogger();

// Middleware
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser()); // Parse cookies for JWT extraction

// Serve static files (map-inspector.html and other debug tools)
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const apiRoutes = require('./routes/api')();
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', database: 'connected' }));

// Start Server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await loadGameConfig(pool, logGameEvent);

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
