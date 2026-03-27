import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// East Money K-line API (push2his)
// klt (K-line type): 1=1min, 5=5min, 10=10min, 15=15min, 30=30min, 60=60min, 101=daily, 102=weekly, 103=monthly
// fqt (right adjustment): 0=none, 1=forward, 2=backward
// lmt (limit): number of candles to return

// GET /api/kline/:code?period=1min&fq=1&lmt=120
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { period = 'd', fq = '1', lmt } = req.query;

    // Map period string to klt code
    const periodMap = {
      '1min': 1,
      '5min': 5,
      '10min': 10,
      '15min': 15,
      '30min': 30,
      '60min': 60,
      'd': 101,
      'w': 102,
      'm': 103
    };
    const klt = periodMap[period] || 101;

    // fqt: 0=不复权, 1=前复权, 2=后复权
    const fqtMap = { '0': 0, '1': 1, '2': 2 };
    const fqt = fqtMap[fq] !== undefined ? fqtMap[fq] : 1;

    // Limit per period type (default if not specified)
    const limitMap = {
      '1min': 500,
      '5min': 500,
      '10min': 500,
      '15min': 500,
      '30min': 500,
      '60min': 500,
      'd': 120,
      'w': 120,
      'm': 120
    };
    const limit = lmt ? parseInt(lmt) : (limitMap[period] || 120);

    // Convert code to East Money secid format
    // 1=上海 (sh), 0=深圳 (sz)
    let secid;
    if (/^[689]/.test(code)) {
      secid = `1.${code}`;  // 上海
    } else if (/^[02-3]/.test(code)) {
      secid = `0.${code}`;  // 深圳
    } else {
      secid = `1.${code}`;
    }

    // Build East Money API URL with ALL required parameters
    const apiUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&fqt=${fqt}&lmt=${limit}&end=20500101`;

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://finance.eastmoney.com/',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.data || !data.data.klines || data.data.klines.length === 0) {
      return res.json({ code, name: data.data?.name || '', klines: [], period, fqt, total: 0 });
    }

    const name = data.data.name || '';
    const klines = data.data.klines.map(item => {
      const parts = item.split(',');
      return {
        date: parts[0],
        open: parseFloat(parts[1]),
        close: parseFloat(parts[2]),
        high: parseFloat(parts[3]),
        low: parseFloat(parts[4]),
        volume: parseFloat(parts[5]),
        amount: parseFloat(parts[6]),
        // parts[7] = amplitude (振幅), parts[8] = change amount, parts[9] = change percent
        changePct: parseFloat(parts[9]) || 0
      };
    });

    res.json({
      code,
      name,
      klines,
      period,
      fqt,
      total: data.data.dktotal || klines.length
    });
  } catch (error) {
    console.error('Error fetching kline:', error.message);
    res.status(500).json({ error: 'Failed to fetch kline data: ' + error.message });
  }
});

export default router;
