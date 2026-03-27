import express from 'express';
import https from 'node:https';

const router = express.Router();

// Helper: HTTP GET with TLS 1.2 + retry with exponential backoff
async function httpsGetWithRetry(url, retries = 3, baseDelayMs = 500) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = https.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://finance.eastmoney.com/',
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
          secureProtocol: 'TLS_client_method', // Force TLS 1.2
        }, (res) => {
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('Invalid JSON')); }
          });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
      });
      return result;
    } catch (error) {
      lastError = error;
      // Only retry on network/server errors, not client errors (4xx)
      const isRetryable = !error.message.includes('HTTP 4');
      if (isRetryable && attempt < retries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }

  throw lastError;
}

// GET /api/kline/:code?period=d&fq=1&lmt=120
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { period = 'd', fq = '1', lmt } = req.query;

    const periodMap = {
      '1min': 1, '5min': 5, '10min': 10, '15min': 15, '30min': 30, '60min': 60,
      'd': 101, 'w': 102, 'm': 103
    };
    const klt = periodMap[period] || 101;

    const fqtMap = { '0': 0, '1': 1, '2': 2 };
    const fqt = fqtMap[fq] !== undefined ? fqtMap[fq] : 1;

    const limitMap = {
      '1min': 500, '5min': 500, '10min': 500, '15min': 500, '30min': 500, '60min': 500,
      'd': 120, 'w': 120, 'm': 120
    };
    const limit = lmt ? parseInt(lmt) : (limitMap[period] || 120);

    let secid;
    if (/^[689]/.test(code)) secid = `1.${code}`;
    else if (/^[02-3]/.test(code)) secid = `0.${code}`;
    else secid = `1.${code}`;

    const apiUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&fqt=${fqt}&lmt=${limit}&end=20500101`;

    const data = await httpsGetWithRetry(apiUrl);

    if (!data.data || !data.data.klines || data.data.klines.length === 0) {
      return res.json({ code, name: data.data?.name || '', klines: [], period, fqt, total: 0 });
    }

    const name = data.data.name || '';
    const klines = data.data.klines.map(item => {
      const parts = item.split(',');
      return {
        date:     parts[0],
        open:     parseFloat(parts[1]),
        close:    parseFloat(parts[2]),
        high:     parseFloat(parts[3]),
        low:      parseFloat(parts[4]),
        volume:   parseFloat(parts[5]),
        amount:   parseFloat(parts[6]),
        changePct: parseFloat(parts[9]) || 0
      };
    });

    res.json({ code, name, klines, period, fqt, total: data.data.dktotal || klines.length });
  } catch (error) {
    console.error('Error fetching kline:', error.message);
    res.status(500).json({ error: 'Failed to fetch kline data: ' + error.message });
  }
});

export default router;
