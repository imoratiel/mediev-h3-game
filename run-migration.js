// Quick migration runner
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('📊 Connecting to database...');
    const sql = fs.readFileSync('./sql/009_fix_view_types.sql', 'utf8');
    console.log('🔄 Executing migration: 009_fix_view_types.sql');
    await client.query(sql);
    console.log('✅ Migration completed successfully!');
    console.log('📋 View v_map_display has been regenerated with proper type casting (BIGINT -> TEXT)');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
