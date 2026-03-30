import express from 'express';
import { getDb } from '../db.js';

const router = express.Router();

// ============================================================
// Default config
// ============================================================
const DEFAULT_CONFIG = {
  initial_cash: '1000000',
  max_position_pct: '20',
  stop_loss_pct: '-5',
  take_profit_pct: '15',
  max_positions: '8',
  buy_ratio: '50',
  max_consecutive_losses: '3',
  strategy_oversold: '1',
  strategy_uptrend: '1',
  strategy_hot: '1',
  strategy_breakthrough: '1',
  strategy_longvalue: '1',
};

// ============================================================
// DB helpers
// ============================================================
function getConfig() {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT key, value FROM paper_config', (err, rows) => {
      if (err) reject(err);
      else {
        const cfg = {};
        for (const row of rows) cfg[row.key] = row.value;
        // Fill defaults
        for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
          if (cfg[k] === undefined) cfg[k] = v;
        }
        resolve(cfg);
      }
    });
  });
}

function saveConfig(key, value) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO paper_config (key, value) VALUES (?, ?)',
      [key, String(value)],
      function(err) {
        if (err) reject(err);
        else resolve({ key, value });
      }
    );
  });
}

function getPaperOrders(page = 1, pageSize = 20) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    const offset = (page - 1) * pageSize;
    db.all(
      'SELECT * FROM paper_orders ORDER BY order_at DESC LIMIT ? OFFSET ?',
      [pageSize, offset],
      (err, rows) => {
        if (err) reject(err);
        else {
          db.get('SELECT COUNT(*) as total FROM paper_orders', (err2, countRow) => {
            if (err2) reject(err2);
            else resolve({ orders: rows, total: countRow?.total || 0 });
          });
        }
      }
    );
  });
}

function computePaperPositions(config, quotesMap) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT code, name,
        SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares,
        SUM(CASE WHEN type='buy' THEN price * shares ELSE 0 END) AS total_buy_amount,
        SUM(CASE WHEN type='buy' THEN shares ELSE 0 END) AS total_buy_shares,
        MIN(CASE WHEN type='buy' THEN order_at ELSE NULL END) AS first_buy_at,
        MAX(CASE WHEN type='buy' THEN signal_score ELSE NULL END) AS signal_score,
        MAX(CASE WHEN type='buy' THEN strategy ELSE NULL END) AS strategy
      FROM paper_orders
      GROUP BY code
      HAVING net_shares > 0
    `, (err, rows) => {
      if (err) { reject(err); return; }

      const today = new Date();
      const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const positions = rows.map(r => {
        const avgCost = r.total_buy_shares > 0 ? r.total_buy_amount / r.total_buy_shares : 0;
        const quote = quotesMap[r.code];
        const currentPrice = quote?.price || avgCost;
        const currentAmount = currentPrice * r.net_shares;
        const profit = (currentPrice - avgCost) * r.net_shares;
        const profitPct = avgCost > 0 ? (currentPrice - avgCost) / avgCost * 100 : 0;
        const stopLossPrice = avgCost * (1 + parseFloat(config.stop_loss_pct) / 100);
        const takeProfitPrice = avgCost * (1 + parseFloat(config.take_profit_pct) / 100);

        // buyDate: YYYY-MM-DD 格式（从 datetime 中提取）
        const buyDate = r.first_buy_at ? r.first_buy_at.slice(0, 10) : null;
        // T+1: 当日买入当日不可卖
        const todayBought = buyDate === todayYMD;
        const canSell = !buyDate || buyDate < todayYMD;

        return {
          code: r.code,
          name: r.name || quote?.name || r.code,
          shares: r.net_shares,
          cost: avgCost,
          costAmount: avgCost * r.net_shares,
          currentPrice,
          currentAmount,
          profit,
          profitPct,
          strategy: r.strategy,
          signalScore: r.signal_score,
          buyDate,
          todayBought,
          canSell,
          stopLossPrice,
          takeProfitPrice,
        };
      });
      resolve(positions);
    });
  });
}

// ============================================================
// Routes
// ============================================================

// GET /api/paper/config
router.get('/config', async (req, res) => {
  try {
    const config = await getConfig();
    res.json(config);
  } catch (error) {
    console.error('Paper config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/paper/config
router.patch('/config', async (req, res) => {
  try {
    const updates = req.body;
    const results = [];
    for (const [key, value] of Object.entries(updates)) {
      if (DEFAULT_CONFIG.hasOwnProperty(key)) {
        await saveConfig(key, value);
        results.push({ key, value });
      }
    }
    res.json({ success: true, updated: results });
  } catch (error) {
    console.error('Paper config update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/paper/positions
router.get('/positions', async (req, res) => {
  try {
    const config = await getConfig();
    const db = getDb();

    // Get held codes first
    const heldRows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT code,
          SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares
        FROM paper_orders
        GROUP BY code
        HAVING net_shares > 0
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    if (heldRows.length === 0) {
      return res.json([]);
    }

    // Fetch real-time quotes
    const codes = heldRows.map(r => r.code);
    let quotesMap = {};
    try {
      const quoteResp = await fetch(`http://localhost:3001/api/quote/batch?codes=${codes.join(',')}`);
      if (quoteResp.ok) {
        const quoteData = await quoteResp.json();
        for (const q of quoteData.results || []) {
          quotesMap[q.code] = q;
        }
      }
    } catch (e) {
      console.warn('[paper/positions] Quote fetch failed:', e.message);
    }

    const positions = await computePaperPositions(config, quotesMap);
    res.json(positions);
  } catch (error) {
    console.error('Paper positions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/paper/orders
router.get('/orders', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
    const result = await getPaperOrders(page, pageSize);
    res.json({ ...result, page, pageSize });
  } catch (error) {
    console.error('Paper orders error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/paper/summary
router.get('/summary', async (req, res) => {
  try {
    const config = await getConfig();
    const db = getDb();
    const initialCash = parseFloat(config.initial_cash);

    // Compute total spent on buys and received from sells
    const cashInfo = await new Promise((resolve, reject) => {
      db.all(`
        SELECT
          SUM(CASE WHEN type='buy' THEN price * shares ELSE 0 END) AS total_buy,
          SUM(CASE WHEN type='sell' OR type='stop_loss' OR type='take_profit' THEN price * shares ELSE 0 END) AS total_sell
        FROM paper_orders
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows[0] || { total_buy: 0, total_sell: 0 });
      });
    });

    const currentCash = initialCash - (cashInfo.total_buy || 0) + (cashInfo.total_sell || 0);

    // Compute positions with real-time quotes
    const heldRows = await new Promise((resolve, reject) => {
      db.all(`
        SELECT code,
          SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares,
          SUM(CASE WHEN type='buy' THEN price * shares ELSE 0 END) AS total_buy_amount,
          SUM(CASE WHEN type='buy' THEN shares ELSE 0 END) AS total_buy_shares
        FROM paper_orders
        GROUP BY code
        HAVING net_shares > 0
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Fetch quotes
    let quotesMap = {};
    if (heldRows.length > 0) {
      try {
        const codes = heldRows.map(r => r.code);
        const quoteResp = await fetch(`http://localhost:3001/api/quote/batch?codes=${codes.join(',')}`);
        if (quoteResp.ok) {
          const quoteData = await quoteResp.json();
          for (const q of quoteData.results || []) {
            quotesMap[q.code] = q;
          }
        }
      } catch (e) {
        console.warn('[paper/summary] Quote fetch failed:', e.message);
      }
    }

    let totalMarketValue = 0;
    let winCount = 0;
    let loseCount = 0;

    for (const r of heldRows) {
      const avgCost = r.total_buy_shares > 0 ? r.total_buy_amount / r.total_buy_shares : 0;
      const quote = quotesMap[r.code];
      const currentPrice = quote?.price || avgCost;
      totalMarketValue += currentPrice * r.net_shares;
      if (currentPrice > avgCost) winCount++;
      else if (currentPrice < avgCost) loseCount++;
    }

    const totalProfit = totalMarketValue + currentCash - initialCash;
    const totalProfitPct = initialCash > 0 ? (totalProfit / initialCash) * 100 : 0;

    // Order stats
    const orderStats = await new Promise((resolve, reject) => {
      db.all(`
        SELECT type, COUNT(*) as cnt FROM paper_orders GROUP BY type
      `, (err, rows) => {
        if (err) reject(err);
        else {
          const stats = {};
          for (const row of rows) stats[row.type] = row.cnt;
          resolve(stats);
        }
      });
    });

    const totalOrders = Object.values(orderStats).reduce((a, b) => a + b, 0);
    const signalCount = orderStats.buy || 0;
    const winRate = (winCount + loseCount) > 0 ? (winCount / (winCount + loseCount)) * 100 : 0;

    res.json({
      initialCash,
      currentCash,
      totalMarketValue,
      totalProfit,
      totalProfitPct,
      totalOrders,
      winCount,
      loseCount,
      winRate,
      positionsCount: heldRows.length,
      signalCount,
    });
  } catch (error) {
    console.error('Paper summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/paper/reset
router.post('/reset', async (req, res) => {
  try {
    const db = getDb();
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM paper_orders', (err) => {
        if (err) reject(err);
        else resolve({ success: true });
      });
    });
    res.json({ success: true, message: '模拟账户已重置' });
  } catch (error) {
    console.error('Paper reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/paper/quote/:code — proxy to /api/quote/:code
router.get('/quote/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const quoteResp = await fetch(`http://localhost:3001/api/quote/${code}`);
    if (!quoteResp.ok) {
      return res.status(quoteResp.status).json({ error: 'Quote fetch failed' });
    }
    const data = await quoteResp.json();
    res.json(data);
  } catch (error) {
    console.error('Paper quote proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/paper/daily — 记录每日净值
router.post('/daily', async (req, res) => {
  try {
    const db = getDb();
    const { total_value, cash, market_value, total_profit, positions_count } = req.body;
    const today = new Date().toISOString().slice(0, 10);
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO paper_daily (date, total_value, cash, market_value, total_profit, positions_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [today, total_value, cash, market_value, total_profit, positions_count || 0],
        function(err) { if (err) reject(err); else resolve(); }
      );
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Paper daily error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/paper/equity_curve — 获取历史净值
router.get('/equity_curve', async (req, res) => {
  try {
    const db = getDb();
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM paper_daily ORDER BY date ASC', (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });
    res.json({ data: rows });
  } catch (error) {
    console.error('Paper equity_curve error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
