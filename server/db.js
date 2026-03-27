import sqlite3 from 'sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = path.join(__dirname, 'stock.db')

let db

export function getDb() {
  if (!db) {
    db = new sqlite3.Database(dbPath)
  }
  return db
}

export function initDb() {
  const db = getDb()

  // Create positions table
  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT,
      cost REAL NOT NULL,
      shares INTEGER NOT NULL,
      position_pct REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  console.log('Database initialized successfully')
  return db
}

// Promisify helper
const promisify = (fn) => (...args) =>
  new Promise((resolve, reject) => {
    fn(...args, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })

// Position CRUD operations
export const positionOps = {
  getAll: () => {
    const db = getDb()
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM positions ORDER BY created_at DESC', (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })
  },

  getById: (id) => {
    const db = getDb()
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM positions WHERE id = ?', [id], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })
  },

  create: ({ code, name, cost, shares, position_pct }) => {
    const db = getDb()
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO positions (code, name, cost, shares, position_pct) VALUES (?, ?, ?, ?, ?)',
        [code, name, cost, shares, position_pct || null],
        function(err) {
          if (err) reject(err)
          else resolve({ id: this.lastID, code, name, cost, shares, position_pct })
        }
      )
    })
  },

  update: (id, { code, name, cost, shares, position_pct }) => {
    const db = getDb()
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE positions
         SET code = ?, name = ?, cost = ?, shares = ?, position_pct = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [code, name, cost, shares, position_pct || null, id],
        function(err) {
          if (err) reject(err)
          else resolve({ id, code, name, cost, shares, position_pct })
        }
      )
    })
  },

  delete: (id) => {
    const db = getDb()
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM positions WHERE id = ?', [id], function(err) {
        if (err) reject(err)
        else resolve({ success: true })
      })
    })
  }
}
