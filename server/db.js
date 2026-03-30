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
  const database = getDb()

  // 使用 serialize 确保所有初始化语句顺序执行
  database.serialize(() => {
    // ---- 新增：股票主表（名称缓存）----
    database.run(`
      CREATE TABLE IF NOT EXISTS stocks (
        code TEXT PRIMARY KEY,
        name TEXT
      )
    `)

    // ---- 新增：交易记录表（买/卖流水）----
    database.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        name TEXT,
        type TEXT NOT NULL CHECK(type IN ('buy', 'sell')),
        price REAL NOT NULL,
        shares INTEGER NOT NULL,
        fee REAL DEFAULT 0,
        note TEXT,
        traded_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // ---- 旧版 positions 表（保留，只用于迁移后兼容）----
    database.run(`
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

    // ---- 迁移：先创建 meta 表，再检查是否已迁移 ----
    database.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`)

    // 检查是否已迁移
    let alreadyMigrated = false
    try {
      const row = database.prepare('SELECT value FROM meta WHERE key = ?').get('migrated')
      alreadyMigrated = row && row.value === '1'
    } catch (_) {
      alreadyMigrated = false
    }

    if (!alreadyMigrated) {
      // 从旧 positions 表迁移数据到 transactions
      const insertTx = database.prepare(`
        INSERT INTO transactions (code, name, type, price, shares, fee, note, traded_at)
        VALUES (?, ?, 'buy', ?, ?, 0, '迁移自旧持仓', ?)
      `)
      database.each('SELECT code, name, cost, shares, created_at FROM positions', (err, row) => {
        if (err) {
          console.error('[Migration] Error reading legacy position:', err.message)
          return
        }
        try {
          insertTx.run(row.code, row.name, row.cost, row.shares, row.created_at || new Date().toISOString())
        } catch (e) {
          console.error('[Migration] Error inserting:', e.message)
        }
      }, (err, count) => {
        if (err) {
          console.error('[Migration] Migration error:', err.message)
        } else {
          console.log(`[Migration] Migrated ${count} legacy positions to transactions`)
        }
        database.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated', '1')`)
      })
    }
  })

  console.log('Database initialized successfully')
  return database
}

// Promisify helper
const promisify = (fn) => (...args) =>
  new Promise((resolve, reject) => {
    fn(...args, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })

// ============================================================
// 旧版 positionOps（保留，routes 中部分接口仍引用）
// ============================================================
export const positionOps = {
  getAll: () => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.all('SELECT * FROM positions ORDER BY created_at DESC', (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })
  },

  getById: (id) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.get('SELECT * FROM positions WHERE id = ?', [id], (err, row) => {
        if (err) reject(err)
        else resolve(row)
      })
    })
  },

  create: ({ code, name, cost, shares, position_pct }) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.run(
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
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.run(
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
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.run('DELETE FROM positions WHERE id = ?', [id], function(err) {
        if (err) reject(err)
        else resolve({ success: true })
      })
    })
  }
}

// ============================================================
// 新增：transactionOps — 交易流水操作层
// ============================================================
export const transactionOps = {
  // 获取全部交易记录（可选按 code 过滤）
  getAll: (code) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      const sql = code
        ? 'SELECT * FROM transactions WHERE code = ? ORDER BY traded_at DESC'
        : 'SELECT * FROM transactions ORDER BY traded_at DESC'
      const params = code ? [code] : []
      database.all(sql, params, (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })
  },

  // 按 code 查单只股票的交易历史
  getByCode: (code) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.all(
        'SELECT * FROM transactions WHERE code = ? ORDER BY traded_at ASC',
        [code],
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        }
      )
    })
  },

  // 新增一笔交易（买入或卖出）
  create: ({ code, name, type, price, shares, fee = 0, note, traded_at }) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.run(
        `INSERT INTO transactions (code, name, type, price, shares, fee, note, traded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, name || null, type, price, shares, fee, note || null, traded_at || null],
        function(err) {
          if (err) reject(err)
          else resolve({ id: this.lastID, code, name, type, price, shares, fee, note, traded_at })
        }
      )
    })
  },

  // 删除一笔交易
  delete: (id) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.run('DELETE FROM transactions WHERE id = ?', [id], function(err) {
        if (err) reject(err)
        else resolve({ success: true })
      })
    })
  },

  // 根据 code 删除某只股票的全部交易记录（清仓/删除持仓）
  deleteByCode: (code) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.run('DELETE FROM transactions WHERE code = ?', [code], function(err) {
        if (err) reject(err)
        else resolve({ success: true, deleted: this.changes })
      })
    })
  },

  // 更新某笔交易的备注（仅允许修改 note）
  updateNote: (id, note) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.run(
        'UPDATE transactions SET note = ? WHERE id = ?',
        [note, id],
        function(err) {
          if (err) reject(err)
          else resolve({ id, note })
        }
      )
    })
  },

  // 计算某只股票的当前持仓汇总
  // 返回 { code, name, shares, cost, costAmount }
  computePosition: (code) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.all(
        'SELECT type, price, shares FROM transactions WHERE code = ? ORDER BY traded_at ASC',
        [code],
        (err, rows) => {
          if (err) { reject(err); return }
          let shares = 0
          let costAmount = 0
          for (const tx of rows) {
            if (tx.type === 'buy') {
              shares += tx.shares
              costAmount += tx.price * tx.shares
            } else {
              shares -= tx.shares
            }
          }
          const avgCost = shares > 0 ? costAmount / shares : 0
          resolve({ code, shares, cost: avgCost, costAmount })
        }
      )
    })
  },

  // 获取所有有持仓的股票代码（shares > 0）
  getHeldCodes: () => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.all(`
        SELECT code,
          SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares
        FROM transactions
        GROUP BY code
        HAVING net_shares > 0
      `, (err, rows) => {
        if (err) reject(err)
        else resolve(rows.map(r => r.code))
      })
    })
  },

  // 批量计算所有持仓（不含实时行情）
  computeAllPositions: () => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      // 按股票分组，计算净持仓
      database.all(`
        SELECT
          code,
          SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares,
          SUM(CASE WHEN type='buy' THEN price * shares ELSE 0 END) AS total_buy_amount,
          SUM(CASE WHEN type='buy' THEN shares ELSE 0 END) AS total_buy_shares
        FROM transactions
        GROUP BY code
        HAVING net_shares > 0
      `, (err, rows) => {
        if (err) { reject(err); return }
        const positions = rows.map(r => {
          const avgCost = r.total_buy_shares > 0 ? r.total_buy_amount / r.total_buy_shares : 0
          return {
            code: r.code,
            shares: r.net_shares,
            cost: avgCost,
            costAmount: avgCost * r.net_shares
          }
        })
        resolve(positions)
      })
    })
  }
}

// ============================================================
// stocks 表操作（名称缓存）
// ============================================================
export const stockOps = {
  upsert: (code, name) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.run(
        'INSERT OR REPLACE INTO stocks (code, name) VALUES (?, ?)',
        [code, name],
        function(err) {
          if (err) reject(err)
          else resolve({ code, name })
        }
      )
    })
  },

  getName: (code) => {
    const database = getDb()
    return new Promise((resolve, reject) => {
      database.get('SELECT name FROM stocks WHERE code = ?', [code], (err, row) => {
        if (err) reject(err)
        else resolve(row ? row.name : null)
      })
    })
  }
}
