const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', '..', 'server.log');

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

/**
 * Clear log file on server startup
 */
function initializeLogger() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            fs.unlinkSync(LOG_FILE);
            console.log('✓ Previous server.log cleared');
        }
        logGameEvent('========== SERVER STARTED (MODULAR) ==========');
    } catch (error) {
        console.error('Error clearing log file:', error);
    }
}

module.exports = {
    logGameEvent,
    initializeLogger
};
