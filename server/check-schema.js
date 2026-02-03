// Check table schemas
require('dotenv').config({ path: '../.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
  const client = await pool.connect();
  try {
    console.log('📊 Checking table schemas...\n');

    // Check h3_map
    console.log('=== h3_map ===');
    const h3map = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'h3_map' AND column_name = 'h3_index'
    `);
    console.log(h3map.rows);

    // Check settlements
    console.log('\n=== settlements ===');
    const settlements = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'settlements' AND column_name = 'h3_index'
    `);
    console.log(settlements.rows);

    // Check custom_map_names
    console.log('\n=== custom_map_names ===');
    const custom = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'custom_map_names' AND column_name = 'h3_index'
    `);
    console.log(custom.rows);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkSchema();
