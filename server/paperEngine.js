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
  max_consecutive_losses: '3',
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
// T+1 helpers (A 股当日买入，当日不可卖出)
// ============================================================

/**
 * 判断是否为交易日（周一~周五，非周末）
 */
function isTradingDay(dateStr) {
  // dateStr: 'YYYY-MM-DD'
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/**
 * 获取某持仓的最近买入日期（YYYY-MM-DD）
 */
function getPositionBuyDate(code) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT date(order_at) AS buy_date FROM paper_orders
       WHERE code=? AND type='buy'
       ORDER BY order_at DESC LIMIT 1`,
      [code],
      (err, row) => {
        if (err) reject(err);
        else resolve(row?.buy_date || null);
      }
    );
  });
}

/**
 * 检查某持仓今日是否受 T+1 限制（当日买入，当日不可卖）
 */
async function isT1Restricted(code) {
  const today = todayStr();
  const buyDate = await getPositionBuyDate(code);
  if (!buyDate) return false;
  // T+1: 买入当日不可卖，同一天不能卖
  return buyDate === today;
}

// ============================================================
// Notification
// ============================================================
async function sendCard({ title, content, template = 'blue' }) {
  try {
    const resp = await fetch('http://localhost:3001/api/notify/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, type: 'card', template }),
    });
    if (!resp.ok) console.warn('[paperEngine] Card send failed:', resp.status);
    else console.log(`[paperEngine] Card sent: ${title}`);
  } catch (e) {
    console.warn('[paperEngine] Card send error:', e.message);
  }
}

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
// Daily snapshot
// ============================================================
async function computePaperPositionsForSnapshot(config, quotesMap) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT code, name,
        SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares,
        SUM(CASE WHEN type='buy' THEN price * shares ELSE 0 END) AS total_buy_amount,
        SUM(CASE WHEN type='buy' THEN shares ELSE 0 END) AS total_buy_shares
      FROM paper_orders
      GROUP BY code
      HAVING net_shares > 0
    `, (err, rows) => {
      if (err) { reject(err); return; }
      const positions = rows.map(r => {
        const avgCost = r.total_buy_shares > 0 ? r.total_buy_amount / r.total_buy_shares : 0;
        const quote = quotesMap[r.code];
        const currentPrice = quote?.price || avgCost;
        const currentAmount = currentPrice * r.net_shares;
        return { code: r.code, net_shares: r.net_shares, currentAmount };
      });
      resolve(positions);
    });
  });
}

function computeCashFromDB(initialCash) {
  const db = getDb();
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

async function recordDailySnapshot() {
  try {
    const db = getDb();
    const cfg = await getConfig();
    const initialCash = parseFloat(cfg.initial_cash);

    // Get held codes for market value
    const held = await new Promise((resolve, reject) => {
      db.all(`
        SELECT code, SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares
        FROM paper_orders GROUP BY code HAVING net_shares > 0
      `, (err, rows) => { if (err) reject(err); else resolve(rows); });
    });

    let quotesMap = {};
    if (held.length > 0) {
      try {
        const resp = await fetch(`http://localhost:3001/api/quote/batch?codes=${held.map(h => h.code).join(',')}`);
        if (resp.ok) {
          const data = await resp.json();
          for (const q of data.results || []) quotesMap[q.code] = q;
        }
      } catch (_) {}
    }

    const positions = await computePaperPositionsForSnapshot(cfg, quotesMap);
    const marketValue = positions.reduce((s, p) => s + (p.currentAmount || 0), 0);
    const cash = await computeCashFromDB(initialCash);
    const totalValue = cash + marketValue;
    const totalProfit = totalValue - initialCash;
    const today = new Date().toISOString().slice(0, 10);

    db.run(
      `INSERT OR REPLACE INTO paper_daily (date, total_value, cash, market_value, total_profit, positions_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [today, totalValue, cash, marketValue, totalProfit, positions.length]
    );
    console.log(`[paperEngine] Daily snapshot: ${today} total=${totalValue.toFixed(2)} cash=${cash.toFixed(2)} mv=${marketValue.toFixed(2)}`);
  } catch (e) {
    console.warn('[paperEngine] recordDailySnapshot error:', e.message);
  }
}

// ============================================================
// Consecutive loss tracking
// ============================================================
async function getConsecutiveLossCount() {
  const db = getDb();
  const recentSells = await new Promise((resolve, reject) => {
    db.all(`
      SELECT po.*,
        (SELECT SUM(shares * price) FROM paper_orders
         WHERE code=po.code AND type='buy' AND order_at < po.order_at
         ORDER BY order_at DESC LIMIT 1) AS buy_cost_total,
        (SELECT SUM(shares) FROM paper_orders
         WHERE code=po.code AND type='buy' AND order_at < po.order_at
         ORDER BY order_at DESC LIMIT 1) AS buy_shares_total
      FROM paper_orders po
      WHERE po.type IN ('sell','stop_loss','take_profit')
      ORDER BY po.order_at DESC LIMIT 10
    `, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });

  let lossCount = 0;
  for (const sell of recentSells) {
    if (sell.buy_cost_total && sell.buy_shares_total && sell.buy_shares_total > 0) {
      const avgBuyCost = sell.buy_cost_total / sell.buy_shares_total;
      if (sell.price < avgBuyCost) lossCount++;
    }
  }
  return lossCount;
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
// Intraday scan — shared core logic
// ============================================================

/**
 * Core scan used by both intraday (5-min) and day-end engine.
 * Returns { bought, stopped, tookProfit } for notification aggregation.
 */
async function runScanCore(isIntraday = false) {
  const result = { bought: [], stopped: [], tookProfit: [] };

  const config = await getConfig();

  const enabledModes = Object.entries(STRATEGY_MAP)
    .filter(([key]) => config[key] === '1')
    .map(([, mode]) => mode);

  const strategyToKey = {};
  for (const [k, v] of Object.entries(STRATEGY_MAP)) {
    strategyToKey[v] = k;
  }

  if (enabledModes.length === 0) {
    console.log('[paperEngine] No strategies enabled, skipping.');
    return result;
  }

  // Screener call
  const screenerUrl = new URL('http://localhost:3001/api/screener/run');
  enabledModes.forEach(m => screenerUrl.searchParams.append('mode', m));
  screenerUrl.searchParams.set('limit', '20');

  const screenerResp = await fetch(screenerUrl.toString());
  if (!screenerResp.ok) {
    console.error('[paperEngine] Screener API error:', screenerResp.status);
    return result;
  }
  const screenerData = await screenerResp.json();
  const candidates = (screenerData.results || []).slice(0, 10);

  // Holdings
  const held = await getHeldCodes();
  const heldSet = new Set(held.map(h => h.code));
  const todayBought = new Set(await getTodayBoughtCodes());
  const availableCash = await getAvailableCash(config);

  const buyRatio = parseFloat(config.buy_ratio) / 100;
  const maxPosPct = parseFloat(config.max_position_pct) / 100;
  const maxPositions = parseInt(config.max_positions);

  // ---- Consecutive loss risk check ----
  const lossCount = await getConsecutiveLossCount();
  const maxLosses = parseInt(config.max_consecutive_losses || '3');
  const lossLimitHit = lossCount >= maxLosses;
  if (lossLimitHit) {
    await sendCard({
      title: '⏸️ 风控暂停',
      content: `连续亏损 ${lossCount} 次，已达上限（${maxLosses}次），暂停新买入信号\n\n今日将不再产生新的买入委托，请关注持仓风险。`,
      template: 'grey',
    });
    console.log(`[paperEngine] Risk limit hit: ${lossCount} consecutive losses, skipping buy signals`);
  }

  // ---- Buy signals ----
  for (const stock of candidates) {
    if (lossLimitHit) continue;  // skip all buys when risk limit is active
    if (heldSet.has(stock.code)) continue;
    if (todayBought.has(stock.code)) continue;
    if (held.length >= maxPositions) break;
    if ((stock.avgScore || 0) < 30) continue;

    const maxByPosition = availableCash * maxPosPct;
    const maxByRatio = availableCash * buyRatio;
    const buyAmount = Math.min(maxByPosition, maxByRatio);

    if (buyAmount < stock.price * 100) continue;

    const shares = Math.floor(buyAmount / stock.price / 100) * 100;
    if (shares < 100) continue;

    const strategyLabel = STRATEGY_LABELS[stock.strategies?.[0]] || stock.strategies?.[0] || '未知';

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

    result.bought.push({ name: stock.name, code: stock.code, price: stock.price, shares, strategyLabel, score: stock.avgScore });
    console.log(`[paperEngine] BUY: ${stock.name}(${stock.code}) ¥${stock.price} x ${shares}`);
  }

  // ---- Stop-loss / take-profit on existing positions ----
  if (held.length > 0) {
    const quotesMap = await fetchBatchQuotes(held.map(h => h.code));

    for (const { code, net_shares } of held) {
      const db = getDb();
      const buyRows = await new Promise((resolve, reject) => {
        db.all(
          `SELECT price, shares FROM paper_orders WHERE code=? AND type='buy' ORDER BY order_at ASC`,
          [code],
          (err, rows) => { if (err) reject(err); else resolve(rows); }
        );
      });
      if (buyRows.length === 0) continue;

      const totalCost = buyRows.reduce((s, r) => s + r.price * r.shares, 0);
      const avgCost = totalCost / buyRows.reduce((s, r) => s + r.shares, 0);

      const stopLossPrice = avgCost * (1 + parseFloat(config.stop_loss_pct) / 100);
      const takeProfitPrice = avgCost * (1 + parseFloat(config.take_profit_pct) / 100);

      const quote = quotesMap[code];
      if (!quote) continue;

      const currentPrice = quote.price;
      const name = quote.name || code;
      const t1Restricted = await isT1Restricted(code);

      if (t1Restricted) {
        console.log(`[paperEngine] T+1 限制: ${name}(${code}) 今日买入，跳过止损/止盈检查`);
        continue;
      }

      if (currentPrice <= stopLossPrice) {
        await insertOrder({
          code, name, type: 'stop_loss', price: currentPrice, shares: net_shares,
          reason: `触发止损（价格¥${currentPrice.toFixed(2)} ≤ 止损价¥${stopLossPrice.toFixed(2)}）`,
          strategy: null, signal_score: null,
        });
        result.stopped.push({ name, code, price: currentPrice, shares: net_shares, triggerPrice: stopLossPrice });
        console.log(`[paperEngine] STOP LOSS: ${name}(${code}) ¥${currentPrice}`);
      } else if (currentPrice >= takeProfitPrice) {
        await insertOrder({
          code, name, type: 'take_profit', price: currentPrice, shares: net_shares,
          reason: `触发止盈（价格¥${currentPrice.toFixed(2)} ≥ 止盈价¥${takeProfitPrice.toFixed(2)}）`,
          strategy: null, signal_score: null,
        });
        result.tookProfit.push({ name, code, price: currentPrice, shares: net_shares, triggerPrice: takeProfitPrice });
        console.log(`[paperEngine] TAKE PROFIT: ${name}(${code}) ¥${currentPrice}`);
      }
    }
  }

  return result;
}

// ============================================================
// Intraday scan — called every 5 minutes during trading hours
// ============================================================
async function runIntradayScan() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const totalMin = h * 60 + m;
  // Trading hours: 9:30–11:30 (570–690) and 13:00–15:00 (780–900)
  const inSession = (totalMin >= 570 && totalMin <= 690) || (totalMin >= 780 && totalMin <= 900);
  if (!inSession) {
    console.log(`[paperEngine] Outside trading hours (${h}:${m}), skipping intraday scan`);
    return;
  }

  const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  console.log(`[paperEngine] === Intraday scan starting at ${timeStr} ===`);

  try {
    const result = await runScanCore(true);

    // Send Feishu notifications only when there are actual actions
    for (const b of result.bought) {
      await sendCard({
        title: `🟢 盘中买入信号 ${timeStr}`,
        content: `**${b.name}**(${b.code})\n价格：¥${b.price.toFixed(2)} x ${b.shares}股\n策略：${b.strategyLabel} | 评分：${b.score}`,
        template: 'green',
      });
    }
    for (const s of result.stopped) {
      const lossPct = (((s.price - s.triggerPrice) / s.triggerPrice) * 100).toFixed(1);
      await sendCard({
        title: `🔴 触发止损 ${timeStr}`,
        content: `**${s.name}**(${s.code})\n价格：¥${s.price.toFixed(2)} x ${s.shares}股\n亏损：${lossPct}%（止损线 ¥${s.triggerPrice.toFixed(2)}）`,
        template: 'red',
      });
    }
    for (const t of result.tookProfit) {
      const gainPct = (((t.price - t.triggerPrice) / t.triggerPrice) * 100).toFixed(1);
      await sendCard({
        title: `🟡 触发止盈 ${timeStr}`,
        content: `**${t.name}**(${t.code})\n价格：¥${t.price.toFixed(2)} x ${t.shares}股\n盈利：+${gainPct}%（止盈线 ¥${t.triggerPrice.toFixed(2)}）`,
        template: 'yellow',
      });
    }

    const totalActions = result.bought.length + result.stopped.length + result.tookProfit.length;
    console.log(`[paperEngine] === Intraday scan done at ${timeStr}: ${totalActions} actions ===`);

    if (totalActions > 0) {
      await recordDailySnapshot();
    }
  } catch (error) {
    console.error('[paperEngine] Intraday scan error:', error.message);
  }
}

// ============================================================
// Day-end engine — runs at 15:20
// ============================================================
async function runPaperEngine() {
  console.log(`[paperEngine] === Day-end paper engine starting at ${new Date().toISOString()} ===`);

  try {
    const result = await runScanCore(false);

    // Day-end full report
    const buyLines = result.bought.map(b => `🟢 买入 **${b.name}**(${b.code}) ¥${b.price.toFixed(2)} x ${b.shares}股`);
    const stopLines = result.stopped.map(s => `🔴 止损 **${s.name}**(${s.code}) ¥${s.price.toFixed(2)} x ${s.shares}股`);
    const profitLines = result.tookProfit.map(t => `🟡 止盈 **${t.name}**(${t.code}) ¥${t.price.toFixed(2)} x ${t.shares}股`);

    const allLines = [...buyLines, ...stopLines, ...profitLines];

    if (allLines.length > 0) {
      await sendCard({
        title: '📊 收盘报告',
        content: allLines.join('\n'),
        template: 'blue',
      });
    } else {
      console.log('[paperEngine] No actions today.');
    }

    await recordDailySnapshot();

    console.log(`[paperEngine] === Day-end paper engine completed ===`);
  } catch (error) {
    console.error('[paperEngine] Fatal error:', error.message);
  }
}

// ============================================================
// Cron registration
// ============================================================
let paperEngineTask = null;
const intradayTasks = [];

// 交易日盘中每 5 分钟扫描：9:35~11:30, 13:00~14:55
const intradaySchedules = [
  '35 9 * * 1-5',   '40 9 * * 1-5',  '45 9 * * 1-5',  '50 9 * * 1-5',  '55 9 * * 1-5',
  '0 10 * * 1-5',   '5 10 * * 1-5',  '10 10 * * 1-5', '15 10 * * 1-5', '20 10 * * 1-5',
  '25 10 * * 1-5', '30 10 * * 1-5', '35 10 * * 1-5', '40 10 * * 1-5', '45 10 * * 1-5',
  '50 10 * * 1-5', '55 10 * * 1-5',
  '0 11 * * 1-5',   '5 11 * * 1-5',  '10 11 * * 1-5', '15 11 * * 1-5', '20 11 * * 1-5',
  '25 11 * * 1-5', '30 11 * * 1-5',
  '0 13 * * 1-5',   '5 13 * * 1-5',  '10 13 * * 1-5', '15 13 * * 1-5', '20 13 * * 1-5',
  '25 13 * * 1-5', '30 13 * * 1-5', '35 13 * * 1-5', '40 13 * * 1-5', '45 13 * * 1-5',
  '50 13 * * 1-5', '55 13 * * 1-5',
  '0 14 * * 1-5',   '5 14 * * 1-5',  '10 14 * * 1-5', '15 14 * * 1-5', '20 14 * * 1-5',
  '25 14 * * 1-5', '30 14 * * 1-5', '35 14 * * 1-5', '40 14 * * 1-5', '45 14 * * 1-5',
  '50 14 * * 1-5', '55 14 * * 1-5',
];

export function registerPaperEngine() {
  // Day-end: 15:20 Beijing time Mon-Fri
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

  console.log(`[paperEngine] Registered day-end cron: ${schedule} (15:20 Beijing Mon-Fri)`);

  // Register intraday 5-minute scans
  for (const intradaySchedule of intradaySchedules) {
    if (!cron.validate(intradaySchedule)) {
      console.error('[paperEngine] Invalid intraday cron schedule:', intradaySchedule);
      continue;
    }
    const task = cron.schedule(intradaySchedule, () => {
      runIntradayScan();
    }, {
      timezone: 'Asia/Shanghai',
    });
    intradayTasks.push(task);
  }

  console.log(`[paperEngine] Registered ${intradayTasks.length} intraday scan crons (9:35–11:30, 13:00–14:55)`);
}

export { runPaperEngine };
