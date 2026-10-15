import mysql from 'mysql2/promise'

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'polux',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

// Pool en lecture seule vers la base du dashboard principal, utilisé uniquement pour
// vérifier l'identité (table users) — jamais d'écriture dessus depuis polux-back.
export const sdpPool = mysql.createPool({
  host: process.env.SDP_DB_HOST || 'localhost',
  port: Number(process.env.SDP_DB_PORT) || 3306,
  user: process.env.SDP_DB_USER || 'root',
  password: process.env.SDP_DB_PASSWORD || '',
  database: process.env.SDP_DB_NAME || 'sdp_dashboard',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
})

export default pool
