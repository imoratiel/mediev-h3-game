const { Pool } = require('pg');
const path = require('path');

// Load environment variables from root .env file
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const isLocal = process.env.NODE_ENV === 'development';

// Create PostgreSQL connection pool
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'db',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

// Test connection
pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

module.exports = pool;
