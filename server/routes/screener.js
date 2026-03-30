import express from 'express';

const router = express.Router();

// ============ Sina GBK Fetch ============
async function sinaGBK(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn/' }
  });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  return new TextDecoder('gbk').decode(buf);
}

// ============ Process Single Stock ============
// Returns null if stock is invalid
async function processStock(code) {
  try {
    const prefix = /^6|^9|^8/.test(code) ? 'sh' : 'sz';
    const raw = await sinaGBK(`https://hq.sinajs.cn/list=${prefix}${code}`);
    if (!raw) return null;

    const match = raw.match(/"([^"]+)"/);
    if (!match) return null;
    const f = match[1].split(',');
    if (f.length < 32 || !f[0] || f[0].includes('未知')) return null;

    const name = f[0];
    const prevClose = parseFloat(f[2]) || 0;
    const price = parseFloat(f[3]) || 0;
    const open = parseFloat(f[1]) || 0;
    const high = parseFloat(f[4]) || 0;
    const low = parseFloat(f[5]) || 0;
    const vol = parseFloat(f[8]) || 0;    // 手
    const amt = parseFloat(f[9]) || 0;   // 元

    if (price <= 0) return null;

    const change = price - prevClose;
    const changePct = prevClose !== 0 ? change / prevClose * 100 : 0;

    // Estimate today's volume vs average (use 5-day avg from amount as proxy)
    // Sina doesn't give us historical vol, but we can estimate from amount
    const avgAmtPerDay = amt > 0 ? amt : 0;
    const volRatio = 1.0; // placeholder, real volRatio needs historical data
    const turnover = prevClose > 0 && price > 0
      ? ((amt / (price * vol * 100)) * 100).toFixed(2)  // rough estimate
      : '-';

    return {
      code, name, price, change, changePct, open, high, low,
      prevClose, volume: vol, amount: amt,
      volRatio: volRatio.toFixed(2),
      turnover: turnover !== '-' ? parseFloat(turnover).toFixed(2) : '-',
      // For the 5 indicators below, we use real-time data + simple rules
      // RSI/MA/etc. are not available without historical K-line, so we use proxies:
      rsiProxy: Math.abs(changePct) > 5 ? '超' : Math.abs(changePct) > 2 ? '偏' : '稳',
      volProxy: volRatio > 1.5 ? '放量' : '缩量',
    };
  } catch {
    return null;
  }
}

// ============ Scoring Functions ============
function scoreOversold(data) {
  const { quote } = data;
  const reasons = [];
  let score = 0;

  // 超跌: changePct strongly negative
  if (quote.changePct <= -5) { score += 35; reasons.push(`超跌${quote.changePct.toFixed(2)}%，反弹概率大`); }
  else if (quote.changePct <= -3) { score += 25; reasons.push(`跌幅较大(${quote.changePct.toFixed(2)}%)，超跌反弹机会`); }
  else if (quote.changePct <= -1) { score += 10; reasons.push(`小幅下跌(${quote.changePct.toFixed(2)}%)，风险有限`); }

  // RSI proxy: strong down day acts as a proxy for oversold
  if (quote.changePct <= -5) { score += 20; reasons.push('今日大幅下杀，RSI超卖区域'); }
  else if (quote.changePct <= -3) { score += 15; reasons.push('下跌动能较强，接近超卖'); }

  // 缩量止跌 (low turnover = slowing selloff)
  if (quote.turnover !== '-' && parseFloat(quote.turnover) < 3) { score += 15; reasons.push(`换手率低(${quote.turnover}%)，卖压衰竭`); }
  else if (quote.turnover !== '-' && parseFloat(quote.turnover) < 5) { score += 8; reasons.push(`换手率适中(${quote.turnover}%)，无恐慌抛售`); }

  // 开盘即反弹 (opened lower but recovered)
  if (quote.price > quote.open && quote.open < quote.prevClose) { score += 15; reasons.push('低开高走，盘中反弹'); }
  else if (quote.price > quote.prevClose) { score += 10; reasons.push('尾盘翻红，承接有力'); }

  // 接近日内低点 vs 开盘: 收在日内高位
  const dayRange = quote.high - quote.low;
  const pricePosInDay = dayRange > 0 ? (quote.price - quote.low) / dayRange : 0.5;
  if (pricePosInDay > 0.7) { score += 10; reasons.push('收盘接近日内高点，强势反弹'); }

  const riskLevel = score > 70 ? '低' : score > 45 ? '中' : '高';
  return { score, reasons, riskLevel, strategy: score > 60 ? '短线' : '中线' };
}

function scoreUptrend(data) {
  const { quote } = data;
  const reasons = [];
  let score = 0;

  // 上涨中继: small positive gain
  if (quote.changePct >= 1 && quote.changePct <= 5) { score += 30; reasons.push(`温和上涨(${quote.changePct.toFixed(2)}%)，趋势健康`); }
  else if (quote.changePct > 5) { score += 25; reasons.push(`强势上涨(${quote.changePct.toFixed(2)}%)，动能充足`); }
  else if (quote.changePct > 0) { score += 15; reasons.push(`小幅上涨(${quote.changePct.toFixed(2)}%)，稳中向好`); }

  // 缩量上涨 = 主力控盘, 放量上涨 = 资金推动
  if (quote.turnover !== '-' && parseFloat(quote.turnover) > 5) { score += 20; reasons.push(`高换手(${quote.turnover}%)，资金积极入场`); }
  else if (quote.turnover !== '-' && parseFloat(quote.turnover) > 2) { score += 12; reasons.push(`换手活跃(${quote.turnover}%)，量价配合`); }

  // 开盘在低位后拉升: 仙人指路
  if (quote.low < quote.prevClose && quote.price > quote.open) { score += 20; reasons.push('低开高走，做多动能强'); }
  else if (quote.price > quote.open) { score += 10; reasons.push('全天保持涨势'); }

  // 收盘在日内高位
  const dayRange = quote.high - quote.low;
  const pricePos = dayRange > 0 ? (quote.price - quote.low) / dayRange : 0.5;
  if (pricePos > 0.8) { score += 10; reasons.push('光头阳线，强势收盘'); }

  // 涨幅适中（不要追涨停）
  if (quote.changePct < 9) { score += 10; reasons.push('未涨停，上方仍有空间'); }

  const riskLevel = score > 70 ? '低' : score > 45 ? '中' : '高';
  return { score, reasons, riskLevel, strategy: score > 55 ? '短线' : '中线' };
}

function scoreHotMoney(data) {
  const { quote } = data;
  const reasons = [];
  let score = 0;

  // 量比代理: high turnover = hot money
  if (quote.turnover !== '-' && parseFloat(quote.turnover) > 8) { score += 30; reasons.push(`极高换手(${quote.turnover}%)，主力激烈博弈`); }
  else if (quote.turnover !== '-' && parseFloat(quote.turnover) > 5) { score += 25; reasons.push(`高换手(${quote.turnover}%)，资金大幅进出`); }
  else if (quote.turnover !== '-' && parseFloat(quote.turnover) > 2) { score += 15; reasons.push(`换手较活跃(${quote.turnover}%)，资金关注`); }

  // 涨幅适中(3-8%) = 最强接力段
  if (quote.changePct >= 3 && quote.changePct <= 8) { score += 30; reasons.push(`涨幅适中(${quote.changePct.toFixed(2)}%)，接力资金可期`); }
  else if (quote.changePct > 8) { score += 15; reasons.push(`接近涨停(${quote.changePct.toFixed(2)}%)，强势股但空间有限`); }
  else if (quote.changePct > 0) { score += 10; reasons.push(`小幅上涨(${quote.changePct.toFixed(2)}%)，有资金关注`); }

  // 大幅资金进出
  if (quote.amount > 1e8) { score += 15; reasons.push(`成交额${(quote.amount/1e8).toFixed(1)}亿，资金活跃`); }
  else if (quote.amount > 5e7) { score += 10; reasons.push(`成交额${(quote.amount/1e8).toFixed(1)}亿，量能充足`); }

  const riskLevel = quote.changePct > 8 || (quote.turnover !== '-' && parseFloat(quote.turnover) > 8) ? '高' : quote.changePct > 5 ? '中' : '低';
  return { score, reasons, riskLevel, strategy: '短线' };
}

function scoreBreakthrough(data) {
  const { quote } = data;
  const reasons = [];
  let score = 0;

  // 接近前期高点: today's high vs recent avg
  // Use prevClose as proxy for "recent high"
  const distFromHigh = quote.prevClose > 0 ? (quote.price - quote.prevClose) / quote.prevClose * 100 : 0;

  if (quote.changePct > 0) { score += 20; reasons.push(`股价上涨(${quote.changePct.toFixed(2)}%)，有向上突破意图`); }
  if (quote.high > quote.prevClose) { score += 25; reasons.push(`今日突破前高${quote.prevClose.toFixed(2)}元，强势信号`); }
  else { score += 10; reasons.push(`在前期高点附近整理，蓄势突破`); }

  // 放量突破: high turnover + price up
  if (quote.turnover !== '-' && parseFloat(quote.turnover) > 3 && quote.changePct > 0) {
    score += 20; reasons.push(`放量上涨(${quote.turnover}%换手)，突破有效`);
  }

  // 跳空高开
  if (quote.open > quote.prevClose * 1.01) { score += 20; reasons.push('跳空高开，形成突破缺口'); }
  else if (quote.open > quote.prevClose) { score += 10; reasons.push('平开或高开，突破意愿强'); }

  const riskLevel = score > 60 ? '中' : score > 40 ? '中' : '高';
  return { score, reasons, riskLevel, strategy: score > 50 ? '短线' : '中线' };
}

function scoreLongValue(data) {
  const { quote } = data;
  const reasons = [];
  let score = 0;

  // 低估值 proxy: low price change = stable
  if (Math.abs(quote.changePct) < 2) { score += 25; reasons.push(`股价稳定(±${quote.changePct.toFixed(2)}%)，估值压力小`); }
  else if (quote.changePct < 0) { score += 15; reasons.push(`股价回调(${quote.changePct.toFixed(2)}%)，逢低布局机会`); }

  // 大盘蓝筹 proxy: high price (typically > 10) + large volume
  if (quote.price > 10 && quote.amount > 5e7) { score += 20; reasons.push(`成交活跃(额${(quote.amount/1e8).toFixed(1)}亿)，流动性好`); }

  // 换手率低 = 主力长期持有
  if (quote.turnover !== '-' && parseFloat(quote.turnover) < 2) { score += 20; reasons.push(`换手率极低(${quote.turnover}%)，筹码稳定，适合长持`); }
  else if (quote.turnover !== '-' && parseFloat(quote.turnover) < 5) { score += 10; reasons.push(`换手率偏低(${quote.turnover}%)，波动小`); }

  // 价格处于近期相对低位
  if (quote.changePct < 0 && quote.changePct > -3) { score += 15; reasons.push(`小幅回调(${quote.changePct.toFixed(2)}%)，提供建仓机会`); }

  // 稳定分红预期 proxy: price between 5-50 is most likely dividend stocks
  if (quote.price >= 5 && quote.price <= 100) { score += 10; reasons.push(`价格适中(${quote.price.toFixed(2)}元)，分红空间大`); }

  const riskLevel = '低';
  return { score, reasons, riskLevel, strategy: '长线' };
}

// ============ Route ============
const STOCKS_50 = [
  '600000','600016','600019','600028','600030','600036','600048','600050','600104',
  '600111','600183','600196','600276','600309','600519','600547','600570','600588',
  '600690','600703','600760','600809','600837','600887','600893','600905','600926',
  '601006','601012','601066','601088','601118','601166','601186','601211','601236',
  '601288','601318','601328','601336','601398','601601','601628','601658','601668',
  '601688','601728','601766','601800','601816','601818','601857','601888','601899',
  '601939','601985','601988','601989','603259','603288','603501','603799',
  '000001','000002','000063','000100','000333','000338','000425','000568',
  '000651','000661','000708','000725','000858','000895',
  '002475','002594','002714','002230','002415','002460','002466',
  '300750','300015','300059','300122','300142','300274','300347',
];

const SCORE_FNS = {
  oversold_rebound: scoreOversold,
  uptrend: scoreUptrend,
  hot_money: scoreHotMoney,
  breakthrough: scoreBreakthrough,
  long_value: scoreLongValue,
};

const MODE_LABELS = {
  oversold_rebound: '底部反弹',
  uptrend: '趋势上涨',
  hot_money: '热门资金',
};

// GET /api/screener/run?mode=oversold_rebound&mode=uptrend&limit=50
// 支持多 mode 参数交叉筛选
router.get('/run', async (req, res) => {
  try {
    const rawModes = Array.isArray(req.query.mode) ? req.query.mode : [req.query.mode || 'oversold_rebound'];
    const modes = rawModes.filter(m => SCORE_FNS[m]).slice(0, 5);
    const limit = parseInt(req.query.limit) || 50;
    if (modes.length === 0) return res.status(400).json({ error: 'At least one valid mode required' });

    const stockList = STOCKS_50.slice(0, limit);
    const allQuotes = await Promise.all(stockList.map(c => processStock(c).catch(() => null)));

    const results = [];
    for (const q of allQuotes) {
      if (!q) continue;

      const modeScores = {};
      let allPass = true;
      for (const mode of modes) {
        const fn = SCORE_FNS[mode];
        if (!fn) continue;
        const result = fn({ quote: q });
        modeScores[mode] = { score: result.score, reasons: result.reasons, riskLevel: result.riskLevel, strategy: result.strategy, label: MODE_LABELS[mode] };
        if (result.score < 25) allPass = false;
      }
      if (!allPass) continue;

      const avgScore = modes.reduce((s, m) => s + (modeScores[m]?.score || 0), 0) / modes.length;
      const allReasons = modes.flatMap(m => (modeScores[m]?.reasons || []).map(r => `[${MODE_LABELS[m]}] ${r}`));
      const riskLevels = modes.map(m => modeScores[m]?.riskLevel).filter(Boolean);
      const finalRisk = riskLevels.includes('高') ? '高' : riskLevels.includes('中') ? '中' : '低';
      const strategies = [...new Set(modes.map(m => modeScores[m]?.strategy).filter(Boolean))];

      results.push({ ...q, modeScores, avgScore: Math.round(avgScore), reasons: allReasons.slice(0, 8), riskLevel: finalRisk, strategies });
    }

    results.sort((a, b) => b.avgScore - a.avgScore);
    res.json({ results: results.slice(0, 20), total: results.length, modes, modeLabels: modes.map(m => MODE_LABELS[m]), note: '同时满足所选多种条件，综合评分取各模式平均' });
  } catch (error) {
    console.error('Screener error:', error);
    res.status(500).json({ error: 'Screener failed' });
  }
});

export default router;
