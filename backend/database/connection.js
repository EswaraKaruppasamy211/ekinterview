const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' && process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
  max: Number(process.env.DATABASE_POOL_SIZE || 10)
});

pool.on('error', error => {
  console.error('PostgreSQL pool error:', error && error.message ? error.message : error);
});

let schemaPromise;
async function init() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!schemaPromise) {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    schemaPromise = pool.query(sql).catch(error => { schemaPromise = null; throw error; });
  }
  await schemaPromise;
  return pool;
}

module.exports = { pool, query: (...args) => pool.query(...args), init, close: () => pool.end() };
