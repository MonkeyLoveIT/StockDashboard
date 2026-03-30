/**
 * 模拟实盘引擎 Paper Trading Engine
 * 每交易日 15:20 自动执行
 */

import cron from 'node-cron';
import { getDb } from './db.js';

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
  strategy_oversold: '1',
  strategy_uptrend: '1',
  strategy_hot: '1',
  strategy_breakthrough: '1',
  strategy_longvalue: '1',
};

const STRATEGY_MAP = {
  strategy_oversold: 'oversold_rebound',
  strategy_uptrend: 'uptrend',
  strategy_hot: 'hot_money',
  strategy_breakthrough: 'breakthrough',
  strategy_longvalue: 'long_value',
};

const STRATEGY_LABELS = {
  oversold_rebound: '底部反弹',
  uptrend: '趋势上涨',
  hot_money: '热门资金',
  breakthrough: '突破拉升',
  long_value: '长线价值',
};

// ============================================================
// Config helpers
// ============================================================
function getConfig() {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all('SELECT key, value FROM paper_config', (err, rows) => {
      if (err) reject(err);
      else {
        const cfg = {};
        for (const row of rows) cfg[row.key] = row.value;
        for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
          if (cfg[k] === undefined) cfg[k] = v;
        }
        resolve(cfg);
      }
    });
  });
}

function insertOrder({ code, name, type, price, shares, reason, strategy, signal_score }) {
  const db = getDb();
  const amount = price * shares;
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO paper_orders (code, name, type, price, shares, amount, reason, strategy, signal_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, name, type, price, shares, amount, reason || null, strategy || null, signal_score || null],
      function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, code, name, type, price, shares, amount, reason, strategy, signal_score });
      }
    );
  });
}

// ============================================================
// Computations
// ============================================================

// Get today's date string (YYYY-MM-DD in local timezone)
function todayStr() {
  const d = new Date();
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
}

function getHeldCodes() {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT code, SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares
      FROM paper_orders
      GROUP BY code
      HAVING net_shares > 0
    `, (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => ({ code: r.code, net_shares: r.net_shares })));
    });
  });
}

function getAvailableCash(config) {
  const db = getDb();
  const initialCash = parseFloat(config.initial_cash);
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT
        SUM(CASE WHEN type='buy' THEN price * shares ELSE 0 END) AS total_buy,
        SUM(CASE WHEN type IN ('sell','stop_loss','take_profit') THEN price * shares ELSE 0 END) AS total_sell
      FROM paper_orders
    `, (err, rows) => {
      if (err) reject(err);
      else {
        const t = rows[0] || { total_buy: 0, total_sell: 0 };
        resolve(initialCash - (t.total_buy || 0) + (t.total_sell || 0));
      }
    });
  });
}

function getTodayBoughtCodes() {
  const db = getDb();
  const today = todayStr();
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT DISTINCT code FROM paper_orders WHERE type='buy' AND date(order_at) = ?`,
      [today],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.code));
      }
    );
  });
}

// ============================================================
// Notification
// ============================================================
async function sendNotify(title, content) {
  try {
    const resp = await fetch('http://localhost:3001/api/notify/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    if (!resp.ok) console.warn('[paperEngine] Notify failed:', resp.status);
    else console.log(`[paperEngine] Notification sent: ${title}`);
  } catch (e) {
    console.warn('[paperEngine] Notify error:', e.message);
  }
}

// ============================================================
// Quote fetch
// ============================================================
async function fetchQuote(code) {
  try {
    const resp = await fetch(`http://localhost:3001/api/quote/${code}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function fetchBatchQuotes(codes) {
  if (codes.length === 0) return {};
  try {
    const resp = await fetch(`http://localhost:3001/api/quote/batch?codes=${codes.join(',')}`);
    if (!resp.ok) return {};
    const data = await resp.json();
    const map = {};
    for (const q of data.results || []) {
      map[q.code] = q;
    }
    return map;
  } catch {
    return {};
  }
}

// ============================================================
// Main engine
// ============================================================
async function runPaperEngine() {
  console.log(`[paperEngine] === Starting paper engine at ${new Date().toISOString()} ===`);

  try {
    // 1. Read risk config
    const config = await getConfig();
    console.log('[paperEngine] Config loaded:', config);

    // 2. Get enabled strategies
    const enabledModes = Object.entries(STRATEGY_MAP)
      .filter(([key]) => config[key] === '1')
      .map(([, mode]) => mode);

    // Map: strategy_oversold → oversold_rebound, etc.
    const strategyToKey = {};
    for (const [k, v] of Object.entries(STRATEGY_MAP)) {
      strategyToKey[v] = k;
    }

    if (enabledModes.length === 0) {
      console.log('[paperEngine] No strategies enabled, skipping.');
      return;
    }

    // 3. Call screener with enabled modes
    const screenerUrl = new URL('http://localhost:3001/api/screener/run');
    enabledModes.forEach(m => screenerUrl.searchParams.append('mode', m));
    screenerUrl.searchParams.set('limit', '20');

    console.log('[paperEngine] Calling screener:', screenerUrl.toString());
    const screenerResp = await fetch(screenerUrl.toString());
    if (!screenerResp.ok) {
      console.error('[paperEngine] Screener API error:', screenerResp.status);
      return;
    }
    const screenerData = await screenerResp.json();
    const candidates = (screenerData.results || []).slice(0, 10);
    console.log(`[paperEngine] Screener returned ${candidates.length} candidates`);

    // 4. Get current holdings
    const held = await getHeldCodes();
    const heldSet = new Set(held.map(h => h.code));
    const positionsCount = held.length;

    // 5. Get today's already-bought codes (prevent duplicate buy)
    const todayBought = new Set(await getTodayBoughtCodes());

    // 6. Get available cash
    const availableCash = await getAvailableCash(config);
    console.log(`[paperEngine] Available cash: ${availableCash.toFixed(2)}, Positions: ${positionsCount}/${config.max_positions}`);

    // 7. Process buy signals
    const buyRatio = parseFloat(config.buy_ratio) / 100;
    const maxPosPct = parseFloat(config.max_position_pct) / 100;
    const maxPositions = parseInt(config.max_positions);

    let boughtCount = 0;

    for (const stock of candidates) {
      // Skip conditions
      if (heldSet.has(stock.code)) continue;  // already held
      if (todayBought.has(stock.code)) continue;  // already bought today
      if (positionsCount + boughtCount >= maxPositions) {
        console.log(`[paperEngine] Max positions reached (${maxPositions}), skipping remaining buys`);
        break;
      }
      if ((stock.avgScore || 0) < 30) continue;  // low score

      // Calculate buy amount
      const maxByPosition = availableCash * maxPosPct;
      const maxByRatio = availableCash * buyRatio;
      const buyAmount = Math.min(maxByPosition, maxByRatio);

      if (buyAmount < stock.price * 100) {
        console.log(`[paperEngine] Insufficient cash for ${stock.code} (need ${(stock.price * 100).toFixed(2)})`);
        continue;
      }

      // Round to nearest 100 shares
      const shares = Math.floor(buyAmount / stock.price / 100) * 100;
      if (shares < 100) continue;

      const actualAmount = shares * stock.price;

      // Determine which strategy triggered
      const strategyKey = strategyToKey[stock.strategies?.[0]] || 'strategy_oversold';
      const strategyLabel = STRATEGY_LABELS[stock.strategies?.[0]] || stock.strategies?.[0] || '未知';

      // Insert buy order
      await insertOrder({
        code: stock.code,
        name: stock.name,
        type: 'buy',
        price: stock.price,
        shares,
        reason: '策略信号',
        strategy: strategyLabel,
        signal_score: stock.avgScore,
      });

      boughtCount++;
      console.log(`[paperEngine] BUY SIGNAL: ${stock.name}(${stock.code}) ¥${stock.price} x ${shares} shares, strategy: ${strategyLabel}, score: ${stock.avgScore}`);

      // Send Feishu notification
      await sendNotify(
        '🟢 买入信号',
        `${stock.name}(${stock.code})\n价格: ¥${stock.price.toFixed(2)}\n数量: ${shares}股\n策略: ${strategyLabel}\n评分: ${stock.avgScore}\n金额: ¥${actualAmount.toFixed(2)}`
      );
    }

    if (boughtCount === 0) {
      console.log('[paperEngine] No buy signals triggered.');
    }

    // 8. Check existing positions for stop-loss / take-profit
    if (held.length > 0) {
      const quotesMap = await fetchBatchQuotes(held.map(h => h.code));

      for (const { code, net_shares } of held) {
        const db = getDb();
        // Get cost from buy orders
        const buyRows = await new Promise((resolve, reject) => {
          db.all(
            `SELECT price, shares FROM paper_orders WHERE code=? AND type='buy' ORDER BY order_at ASC`,
            [code],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            }
          );
        });

        if (buyRows.length === 0) continue;

        const totalShares = buyRows.reduce((s, r) => s + r.shares, 0);
        const totalCost = buyRows.reduce((s, r) => s + r.price * r.shares, 0);
        const avgCost = totalCost / totalShares;

        const stopLossPrice = avgCost * (1 + parseFloat(config.stop_loss_pct) / 100);
        const takeProfitPrice = avgCost * (1 + parseFloat(config.take_profit_pct) / 100);

        const quote = quotesMap[code];
        if (!quote) continue;

        const currentPrice = quote.price;
        const name = quote.name || code;

        // Stop-loss
        if (currentPrice <= stopLossPrice) {
          await insertOrder({
            code,
            name,
            type: 'stop_loss',
            price: currentPrice,
            shares: net_shares,
            reason: `触发止损（价格¥${currentPrice.toFixed(2)} ≤ 止损价¥${stopLossPrice.toFixed(2)}）`,
            strategy: null,
            signal_score: null,
          });
          console.log(`[paperEngine] STOP LOSS: ${name}(${code}) ¥${currentPrice}`);
          await sendNotify(
            '🔴 止损卖出',
            `${name}(${code})\n价格: ¥${currentPrice.toFixed(2)}\n数量: ${net_shares}股\n原因: 触发止损（≤ ¥${stopLossPrice.toFixed(2)}）`
          );
        }
        // Take-profit
        else if (currentPrice >= takeProfitPrice) {
          await insertOrder({
            code,
            name,
            type: 'take_profit',
            price: currentPrice,
            shares: net_shares,
            reason: `触发止盈（价格¥${currentPrice.toFixed(2)} ≥ 止盈价¥${takeProfitPrice.toFixed(2)}）`,
            strategy: null,
            signal_score: null,
          });
          console.log(`[paperEngine] TAKE PROFIT: ${name}(${code}) ¥${currentPrice}`);
          await sendNotify(
            '🟡 止盈卖出',
            `${name}(${code})\n价格: ¥${currentPrice.toFixed(2)}\n数量: ${net_shares}股\n原因: 触发止盈（≥ ¥${takeProfitPrice.toFixed(2)}）`
          );
        }
      }
    }

    console.log(`[paperEngine] === Paper engine completed at ${new Date().toISOString()} ===`);
  } catch (error) {
    console.error('[paperEngine] Fatal error:', error.message);
  }
}

// ============================================================
// Cron registration
// ============================================================
let paperEngineTask = null;

export function registerPaperEngine() {
  // Schedule: 15:20 Beijing time on weekdays
  // Beijing 15:20 = UTC 07:20
  const schedule = '20 15 * * 1-5';

  if (!cron.validate(schedule)) {
    console.error('[paperEngine] Invalid cron schedule:', schedule);
    return;
  }

  if (paperEngineTask) {
    paperEngineTask.stop();
  }

  paperEngineTask = cron.schedule(schedule, () => {
    runPaperEngine();
  }, {
    timezone: 'Asia/Shanghai',
  });

  console.log(`[paperEngine] Registered paper engine cron: ${schedule} (15:20 Beijing Mon-Fri)`);
}

export { runPaperEngine };
