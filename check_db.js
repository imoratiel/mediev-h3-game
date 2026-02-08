const pool = require('./server/db');

async function check() {
    try {
        console.log('=== WORLD STATE ===');
        const world = await pool.query('SELECT * FROM world_state WHERE id = 1');
        console.log(JSON.stringify(world.rows[0], null, 2));

        console.log('\n=== GAME CONFIG (gameplay) ===');
        const config = await pool.query(`SELECT * FROM game_config WHERE "group" = 'gameplay'`);
        console.log(JSON.stringify(config.rows, null, 2));

        await pool.end();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

check();
