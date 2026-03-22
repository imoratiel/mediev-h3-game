const fs = require('fs');
const path = require('path');

// Directorio de logs
const LOGS_DIR  = path.join(__dirname, '..', '..', 'logs');
const BOTS_DIR  = path.join(LOGS_DIR, 'bots');

// Archivos de log segregados
const LOG_FILES = {
    actions: path.join(LOGS_DIR, 'actions.log'),
    engine: path.join(LOGS_DIR, 'engine.log'),
    exceptions: path.join(LOGS_DIR, 'exceptions.log'),
    armies: path.join(LOGS_DIR, 'armies.log'), // Simulación de ejércitos
    legacy: path.join(LOGS_DIR, 'server.log') // Compatibilidad con código existente
};

// Archivo que guarda la fecha de la última rotación
const ROTATION_MARKER = path.join(LOGS_DIR, '.last_rotation');
// Días entre rotaciones
const ROTATION_DAYS = 15;
// Cuántas rotaciones históricas conservar por archivo (15 días × 2 = 30 días de historial)
const MAX_ROTATIONS = 2;

/**
 * Rota los archivos de log actuales añadiendo la fecha al nombre,
 * vacía los logs activos y elimina históricos más antiguos.
 */
function rotateLogs() {
    try {
        const dateTag = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        // Rotar archivos de log principales
        for (const [key, filePath] of Object.entries(LOG_FILES)) {
            if (!fs.existsSync(filePath)) continue;

            // Renombrar actual → archivo histórico con fecha
            const ext = path.extname(filePath);         // .log
            const base = filePath.slice(0, -ext.length); // ruta sin extensión
            const rotated = `${base}.${dateTag}${ext}`;
            fs.renameSync(filePath, rotated);

            // Eliminar históricos que superen MAX_ROTATIONS
            const dir = path.dirname(filePath);
            const baseName = path.basename(base);
            const oldFiles = fs.readdirSync(dir)
                .filter(f => f.startsWith(baseName + '.') && f.endsWith(ext) && f !== path.basename(filePath))
                .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
                .sort((a, b) => a.mtime - b.mtime); // más antiguo primero

            while (oldFiles.length > MAX_ROTATIONS) {
                fs.unlinkSync(path.join(dir, oldFiles.shift().name));
            }
        }

        // Limpiar logs de bots con más de ROTATION_DAYS días de antigüedad
        if (fs.existsSync(BOTS_DIR)) {
            const cutoff = Date.now() - ROTATION_DAYS * 24 * 60 * 60 * 1000;
            fs.readdirSync(BOTS_DIR)
                .filter(f => f.endsWith('.log'))
                .forEach(f => {
                    const full = path.join(BOTS_DIR, f);
                    if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
                });
        }

        // Guardar fecha de esta rotación
        fs.writeFileSync(ROTATION_MARKER, new Date().toISOString(), 'utf8');
        console.log(`✓ Logs rotated (${dateTag})`);
    } catch (error) {
        console.error('Error rotating logs:', error);
    }
}

/**
 * Comprueba si han pasado ROTATION_DAYS días desde la última rotación.
 * Si es así, ejecuta la rotación.
 */
function checkLogRotation() {
    try {
        if (fs.existsSync(ROTATION_MARKER)) {
            const last = new Date(fs.readFileSync(ROTATION_MARKER, 'utf8').trim());
            const daysSince = (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince < ROTATION_DAYS) return;
        }
        rotateLogs();
    } catch (error) {
        console.error('Error checking log rotation:', error);
    }
}

/**
 * Inicializar sistema de logging
 * Crea el directorio de logs si no existe
 */
function initializeLogger() {
    try {
        // Crear directorio de logs si no existe
        if (!fs.existsSync(LOGS_DIR)) {
            fs.mkdirSync(LOGS_DIR, { recursive: true });
            console.log('✓ Logs directory created');
        }

        // Crear subdirectorio de bots si no existe
        if (!fs.existsSync(BOTS_DIR)) {
            fs.mkdirSync(BOTS_DIR, { recursive: true });
            console.log('✓ Bots logs directory created');
        }

        // Rotar logs si han pasado 15 días desde la última rotación
        checkLogRotation();

        const startupMessage = `========== SERVER STARTED: ${new Date().toISOString()} ==========`;
        appendToLog(LOG_FILES.engine, startupMessage);
        appendToLog(LOG_FILES.legacy, startupMessage);

        console.log('✓ Logger initialized with segregated logs');
    } catch (error) {
        console.error('Error initializing logger:', error);
    }
}

/**
 * Escribir en un archivo de log
 * @param {string} filePath - Ruta del archivo de log
 * @param {string} message - Mensaje a escribir
 */
function appendToLog(filePath, message) {
    try {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(filePath, logEntry, 'utf8');
    } catch (error) {
        console.error(`Error writing to log file ${filePath}:`, error);
    }
}

/**
 * Registrar una acción manual del usuario
 * @param {string} message - Descripción de la acción
 * @param {number|string} userId - ID del usuario que ejecutó la acción
 * @param {Object} metadata - Datos adicionales opcionales
 */
function logAction(message, userId = null, metadata = {}) {
    const userInfo = userId ? `[USER:${userId}]` : '[SYSTEM]';
    const metaInfo = Object.keys(metadata).length > 0 ? ` | ${JSON.stringify(metadata)}` : '';
    const fullMessage = `${userInfo} ${message}${metaInfo}`;

    appendToLog(LOG_FILES.actions, fullMessage);
    appendToLog(LOG_FILES.legacy, `[ACTION] ${fullMessage}`);
}

/**
 * Registrar eventos automáticos del motor del juego
 * @param {string} message - Descripción del evento del sistema
 * @param {Object} metadata - Datos adicionales opcionales
 */
function logEngine(message, metadata = {}) {
    const metaInfo = Object.keys(metadata).length > 0 ? ` | ${JSON.stringify(metadata)}` : '';
    const fullMessage = `${message}${metaInfo}`;

    appendToLog(LOG_FILES.engine, fullMessage);
}

/**
 * Registrar eventos de simulación de ejércitos
 * Formato: [TIMESTAMP] [ARMY_ID] [EVENT_TYPE] - Mensaje detallado
 * @param {number|string} armyId - ID del ejército
 * @param {string} eventType - Tipo de evento (MOVE_START, MOVE_STEP, STAMINA_DECREASE, etc.)
 * @param {string} message - Mensaje detallado del evento
 * @param {Object} metadata - Datos adicionales opcionales
 */
function logArmy(armyId, eventType, message, metadata = {}) {
    const metaInfo = Object.keys(metadata).length > 0 ? ` | ${JSON.stringify(metadata)}` : '';
    const fullMessage = `[ARMY:${armyId}] [${eventType}] ${message}${metaInfo}`;

    appendToLog(LOG_FILES.armies, fullMessage);
}

/**
 * Registrar eventos de un agente IA en su propio archivo de log.
 * Archivo: logs/bots/bot_id{botId}.log
 * @param {number|string} botId   - player_id del agente IA
 * @param {string}        message - Mensaje a registrar
 * @param {Object}        [metadata] - Datos adicionales opcionales
 */
function logBot(botId, message, metadata = {}) {
    const botFile   = path.join(BOTS_DIR, `bot_id${botId}.log`);
    const metaInfo  = Object.keys(metadata).length > 0 ? ` | ${JSON.stringify(metadata)}` : '';
    const fullMessage = `${message}${metaInfo}`;
    appendToLog(botFile, fullMessage);
}

/**
 * Registrar errores con stack trace completo
 * @param {Error} error - Objeto de error
 * @param {Object} context - Contexto del error (req, payload, etc.)
 */
function logError(error, context = {}) {
    const errorLog = {
        timestamp: new Date().toISOString(),
        message: error.message || 'Unknown error',
        type: error.name || 'Error',
        stack: error.stack || 'No stack trace available',
        context: {}
    };

    // Agregar contexto relevante
    if (context.endpoint) {
        errorLog.context.endpoint = context.endpoint;
    }
    if (context.method) {
        errorLog.context.method = context.method;
    }
    if (context.userId) {
        errorLog.context.userId = context.userId;
    }
    if (context.payload) {
        // Sanitizar payload (remover datos sensibles)
        const sanitizedPayload = { ...context.payload };
        if (sanitizedPayload.password) sanitizedPayload.password = '[REDACTED]';
        errorLog.context.payload = sanitizedPayload;
    }

    // Extraer archivo y línea del stack trace
    const stackLines = error.stack?.split('\n') || [];
    if (stackLines.length > 1) {
        const firstFrame = stackLines[1];
        const match = firstFrame.match(/\((.+):(\d+):(\d+)\)/) || firstFrame.match(/at (.+):(\d+):(\d+)/);
        if (match) {
            errorLog.context.file = match[1];
            errorLog.context.line = match[2];
            errorLog.context.column = match[3];
        }
    }

    // Formatear el log de error de forma legible
    const errorMessage = [
        '=====================================',
        `ERROR: ${errorLog.message}`,
        `TYPE: ${errorLog.type}`,
        `FILE: ${errorLog.context.file || 'Unknown'}:${errorLog.context.line || '?'}`,
        errorLog.context.endpoint ? `ENDPOINT: ${errorLog.context.method} ${errorLog.context.endpoint}` : null,
        errorLog.context.userId ? `USER: ${errorLog.context.userId}` : null,
        errorLog.context.payload ? `PAYLOAD: ${JSON.stringify(errorLog.context.payload, null, 2)}` : null,
        'STACK TRACE:',
        errorLog.stack,
        '====================================='
    ].filter(line => line !== null).join('\n');

    appendToLog(LOG_FILES.exceptions, errorMessage);

    // También escribir versión corta en legacy log
    appendToLog(LOG_FILES.legacy, `[ERROR] ${errorLog.message} at ${errorLog.context.file}:${errorLog.context.line}`);

    // Siempre mostrar en consola también
    console.error('❌ ERROR LOGGED:', errorLog.message);
}

/**
 * Compatibilidad con código existente que usa logGameEvent
 * @param {string} message - Mensaje a registrar
 */
function logGameEvent(message) {
    // Determinar tipo de log según el mensaje
    if (message.includes('[RECLUTAMIENTO]') ||
        message.includes('[INFRAESTRUCTURA]') ||
        message.includes('[Claim]') ||
        message.includes('[EXPLORACIÓN]')) {
        // Es una acción de usuario
        const userMatch = message.match(/Jugador (\d+)/);
        const userId = userMatch ? userMatch[1] : null;
        logAction(message, userId);
    } else if (message.includes('[Census]') ||
               message.includes('[Regeneration]') ||
               message.includes('[Maintenance]')) {
        // Es un evento del motor
        logEngine(message);
    } else {
        // Por defecto, registrar como evento del motor
        appendToLog(LOG_FILES.legacy, message);
    }
}

/**
 * Middleware de Express para logging automático de errores
 * @param {Error} err - Error
 * @param {Object} req - Request de Express
 * @param {Object} res - Response de Express
 * @param {Function} next - Next middleware
 */
// TODO(dead-code): Sin referencias de uso en el proyecto; revisar y eliminar si no se reutiliza.
function errorLoggingMiddleware(err, req, res, next) {
    logError(err, {
        endpoint: req.originalUrl || req.url,
        method: req.method,
        userId: req.session?.user?.player_id,
        payload: req.body
    });

    // Pasar al siguiente middleware
    next(err);
}

/**
 * Logger unificado con métodos segregados
 */
const Logger = {
    /**
     * Registrar acción manual del usuario
     * @param {string} message - Mensaje
     * @param {number} userId - ID del usuario
     * @param {Object} metadata - Metadata adicional
     */
    action: logAction,

    /**
     * Registrar evento automático del motor
     * @param {string} message - Mensaje
     * @param {Object} metadata - Metadata adicional
     */
    engine: logEngine,

    /**
     * Registrar eventos de simulación de ejércitos
     * @param {number} armyId - ID del ejército
     * @param {string} eventType - Tipo de evento
     * @param {string} message - Mensaje detallado
     * @param {Object} metadata - Metadata adicional
     */
    army: logArmy,

    /**
     * Registrar un evento de un agente IA en su log individual (logs/bots/bot_id{id}.log)
     * @param {number|string} botId - player_id del agente IA
     * @param {string} message - Mensaje
     * @param {Object} [metadata] - Metadata adicional
     */
    bot: logBot,

    /**
     * Registrar error con stack trace
     * @param {Error} error - Error
     * @param {Object} context - Contexto del error
     */
    error: logError,

    /**
     * Compatibilidad con logGameEvent
     * @param {string} message - Mensaje
     */
    event: logGameEvent
};

module.exports = {
    Logger,
    logGameEvent,
    initializeLogger,
    rotateLogs,
    errorLoggingMiddleware
};
