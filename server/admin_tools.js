/**
 * Herramientas administrativas para control del motor del juego
 * Uso: node server/admin_tools.js <comando>
 */

const pool = require('./db');
const { processGameTurn, isEngineActive } = require('./src/logic/turn_engine');
const { CONFIG, loadGameConfig } = require('./src/config');
const { Logger } = require('./src/utils/logger');

const commands = {
    async status() {
        console.log('\n🔍 ESTADO DEL MOTOR DEL JUEGO\n');

        const worldState = await pool.query('SELECT * FROM world_state WHERE id = 1');
        const state = worldState.rows[0];

        const config = await pool.query(`SELECT * FROM game_config WHERE "group" = 'gameplay'`);
        const turnDuration = config.rows.find(r => r.key === 'turn_duration_seconds');

        console.log('📊 Estado Mundial:');
        console.log(`   Turno Actual: ${state.current_turn}`);
        console.log(`   Fecha: ${new Date(state.game_date).toLocaleDateString()}`);
        console.log(`   Última Actualización: ${new Date(state.last_updated).toLocaleString()}`);
        console.log(`   Estado: ${state.is_paused ? '⏸️  PAUSADO' : '▶️  ACTIVO'}`);
        console.log(`\n⚙️  Configuración:`);
        console.log(`   Duración del turno: ${turnDuration?.value || 'N/A'} segundos`);
        console.log(`   Motor corriendo: ${isEngineActive() ? '✅ SÍ' : '❌ NO (requiere reinicio del servidor)'}`);
    },

    async pause() {
        console.log('\n⏸️  Pausando juego...\n');

        await pool.query('UPDATE world_state SET is_paused = true WHERE id = 1');
        Logger.action('Juego pausado manualmente desde admin_tools.js', 'SYSTEM');

        console.log('✅ Juego pausado exitosamente');
        console.log('   El motor seguirá corriendo pero no procesará turnos.');
        console.log('   Usa "node server/admin_tools.js resume" para reanudar.\n');
    },

    async resume() {
        console.log('\n▶️  Reanudando juego...\n');

        await pool.query('UPDATE world_state SET is_paused = false WHERE id = 1');
        Logger.action('Juego reanudado manualmente desde admin_tools.js', 'SYSTEM');

        console.log('✅ Juego reanudado exitosamente');
        console.log('   El motor procesará turnos según el intervalo configurado.\n');
    },

    async forceTurn() {
        console.log('\n⚡ Forzando procesamiento de turno...\n');

        await loadGameConfig(pool, Logger.event);

        const result = await processGameTurn(pool, CONFIG);

        if (result.paused) {
            console.log('❌ ERROR: El juego está pausado');
            console.log('   Usa "node server/admin_tools.js resume" primero.\n');
            return;
        }

        if (result.success) {
            console.log('✅ Turno procesado exitosamente');
            console.log(`   Turno: ${result.turn}`);
            console.log(`   Fecha: ${new Date(result.date).toLocaleDateString()}`);
            console.log(`   Día del año: ${result.dayOfYear}\n`);
        } else {
            console.log('❌ ERROR: No se pudo procesar el turno\n');
        }
    },

    async help() {
        console.log('\n🎮 HERRAMIENTAS ADMINISTRATIVAS DEL MOTOR DEL JUEGO\n');
        console.log('Uso: node server/admin_tools.js <comando>\n');
        console.log('Comandos disponibles:');
        console.log('  status     - Muestra el estado actual del juego y el motor');
        console.log('  pause      - Pausa el procesamiento de turnos');
        console.log('  resume     - Reanuda el procesamiento de turnos');
        console.log('  forceTurn  - Fuerza el procesamiento de un turno inmediatamente');
        console.log('  help       - Muestra esta ayuda\n');
        console.log('Ejemplos:');
        console.log('  node server/admin_tools.js status');
        console.log('  node server/admin_tools.js resume');
        console.log('  node server/admin_tools.js forceTurn\n');
    }
};

async function main() {
    const command = process.argv[2];

    if (!command || !commands[command]) {
        await commands.help();
        process.exit(command ? 1 : 0);
    }

    try {
        await commands[command]();
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error(error.stack);
        await pool.end();
        process.exit(1);
    }
}

main();
