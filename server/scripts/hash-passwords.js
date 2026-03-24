/**
 * hash-passwords.js
 * Rehashea todas las contraseñas en texto plano de la tabla players.
 * Ejecutar UNA SOLA VEZ tras implementar bcrypt:
 *   node server/scripts/hash-passwords.js
 */
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = new Pool({
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host:     process.env.DB_HOST || 'localhost',
    port:     process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    ssl: false,
});

const SALT_ROUNDS = 12;

async function run() {
    const client = await pool.connect();
    try {
        const { rows } = await client.query(
            `SELECT player_id, username, password FROM players
             WHERE password IS NOT NULL AND is_ai = FALSE`
        );

        console.log(`Encontrados ${rows.length} jugadores con contraseña.`);

        for (const player of rows) {
            // Si ya es un hash bcrypt, lo saltamos
            if (player.password?.startsWith('$2')) {
                console.log(`  ✓ ${player.username} — ya hasheado, saltando`);
                continue;
            }
            const hash = await bcrypt.hash(player.password, SALT_ROUNDS);
            await client.query(
                'UPDATE players SET password = $1 WHERE player_id = $2',
                [hash, player.player_id]
            );
            console.log(`  ✓ ${player.username} — hasheado`);
        }

        console.log('Listo.');
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => { console.error(err); process.exit(1); });
