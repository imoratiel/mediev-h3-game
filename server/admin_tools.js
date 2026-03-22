/**
 * Herramientas administrativas para control del motor del juego
 * Uso: node server/admin_tools.js <comando>
 */

const pool = require('./db');
const { processGameTurn, isEngineActive } = require('./src/logic/turn_engine');
const { CONFIG, loadGameConfig } = require('./src/config');
const { Logger, rotateLogs } = require('./src/utils/logger');

const commands = {
    async status() {
        console.log('\n🔍 ESTADO DEL MOTOR DEL JUEGO\n');

        const worldState = await pool.query('SELECT * FROM world_state WHERE id = 1');
        const state = worldState.rows[0];

        const config = await pool.query(`SELECT * FROM game_config WHERE "group" = 'gameplay'`);
        const turnDuration = config.rows.find(r => r.key === 'turn_duration_seconds');

        console.log('📊 Estado Mundial:');
        console.log(`   Turno Actual: ${state.current_turn}`);
        console.log(`   Fecha: ${state.game_date}`);
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

    async forceHarvest() {
        console.log('\n🌾 Forzando procesamiento de cosecha...\n');

        await loadGameConfig(pool, Logger.event);
        const { processHarvestManually } = require('./src/logic/turn_engine');

        const worldState = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
        const currentTurn = worldState.rows[0].current_turn;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await processHarvestManually(client, currentTurn, CONFIG);
            await client.query('COMMIT');

            console.log('✅ Cosecha procesada exitosamente');
            console.log(`   Turno: ${currentTurn}`);
            console.log('   Revisa los mensajes del juego para ver el resumen de cosecha.\n');
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async forceExploration() {
        console.log('\n🔍 Forzando procesamiento de exploraciones...\n');

        await loadGameConfig(pool, Logger.event);
        const { processExplorationsManually } = require('./src/logic/turn_engine');

        const worldState = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
        const currentTurn = worldState.rows[0].current_turn;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await processExplorationsManually(client, currentTurn, CONFIG);
            await client.query('COMMIT');

            console.log('✅ Exploraciones procesadas exitosamente');
            console.log(`   Turno: ${currentTurn}`);
            console.log('   Revisa los mensajes del juego para ver los resultados de exploración.\n');
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async forceMonthlyProduction() {
        console.log('\n🏭 Forzando producción mensual...\n');

        await loadGameConfig(pool, Logger.event);
        const { processMonthlyProductionManually } = require('./src/logic/turn_engine');

        const worldState = await pool.query('SELECT current_turn FROM world_state WHERE id = 1');
        const currentTurn = worldState.rows[0].current_turn;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await processMonthlyProductionManually(client, currentTurn, CONFIG);
            await client.query('COMMIT');

            console.log('✅ Producción mensual procesada exitosamente');
            console.log(`   Turno: ${currentTurn}`);
            console.log('   Revisa los mensajes del juego para ver el resumen de producción.\n');
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async rotateLogs() {
        console.log('\n🗂️  Rotando logs manualmente...\n');
        rotateLogs();
        console.log('✅ Rotación completada.\n');
    },

    async help() {
        console.log('\n🎮 HERRAMIENTAS ADMINISTRATIVAS DEL MOTOR DEL JUEGO\n');
        console.log('Uso: node server/admin_tools.js <comando>\n');
        console.log('Comandos disponibles:');
        console.log('  status                - Muestra el estado actual del juego y el motor');
        console.log('  pause                 - Pausa el procesamiento de turnos');
        console.log('  resume                - Reanuda el procesamiento de turnos');
        console.log('  forceTurn             - Fuerza el procesamiento de un turno inmediatamente');
        console.log('  forceHarvest          - Fuerza el procesamiento de cosecha (solo para pruebas)');
        console.log('  forceExploration      - Fuerza el procesamiento de exploraciones (solo para pruebas)');
        console.log('  forceMonthlyProduction - Fuerza la producción mensual (solo para pruebas)');
        console.log('  rotateLogs            - Fuerza la rotación de logs ahora mismo');
        console.log('  help                  - Muestra esta ayuda\n');
        console.log('Ejemplos:');
        console.log('  node server/admin_tools.js status');
        console.log('  node server/admin_tools.js resume');
        console.log('  node server/admin_tools.js forceTurn');
        console.log('  node server/admin_tools.js forceHarvest');
        console.log('  node server/admin_tools.js forceExploration');
        console.log('  node server/admin_tools.js forceMonthlyProduction');
        console.log('  node server/admin_tools.js rotateLogs\n');
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
