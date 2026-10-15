import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  })

  const dbName = process.env.DB_NAME || 'polux'
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``)
  await connection.changeUser({ database: dbName })

  await connection.query(
    `CREATE TABLE IF NOT EXISTS _migrations (name VARCHAR(255) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
  )
  const [applied] = await connection.query<any[]>('SELECT name FROM _migrations')
  const appliedNames = new Set(applied.map((r) => r.name))

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (appliedNames.has(file)) {
      console.log(`⏭  ${file} (déjà appliquée)`)
      continue
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    console.log(`▶  ${file}`)
    await connection.query(sql)
    await connection.query('INSERT INTO _migrations (name) VALUES (?)', [file])
  }

  console.log('Migrations terminées.')
  await connection.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
