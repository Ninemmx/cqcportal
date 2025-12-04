import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


dotenv.config({
  path: path.resolve(__dirname, '../.env') 
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  multipleStatements: true,
  connectionLimit: 100,
  queueLimit: 0,
  charset: 'utf8mb4',
  namedPlaceholders: true,
  flags: '+PLUGIN_AUTH',
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('DB Error:', err.message);
});

export default pool;
