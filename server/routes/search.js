import express from 'express';
import https from 'node:https';

const router = express.Router();

// Helper: HTTPS GET with TLS 1.2
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://finance.eastmoney.com/',
        'Accept': '*/*',
      },
      secureProtocol: 'TLS_client_method',
    }, (res) => {
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = Buffer.alloc(0);
      res.on('data', d => { data = Buffer.concat([data, d]); });
      res.on('end', () => {
        try { resolve(JSON.parse(data.toString('utf8'))); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// GET /api/search?code=xxx
router.get('/', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'code parameter is required' });

    const query = code.trim();

    // 6位数字代码 → 新浪实时行情
    if (/^\d{6}$/.test(query)) {
      const results = await searchByCode(query);
      return res.json({ results, query });
    }

    // 中文名或英文字符 → 新浪 suggest3 API
    const results = await searchByName(query);
    return res.json({ results, query });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// 按代码精确搜索（新浪 GBK 行情）
async function searchByCode(code) {
  const prefix = /^6|^9|^8/.test(code) ? 'sh' : 'sz';
  const url = `https://hq.sinajs.cn/list=${prefix}${code}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://finance.sina.com.cn/',
    }
  });

  if (!response.ok) return [];
  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder('gbk');
  const raw = decoder.decode(buffer);
  const match = raw.match(/"([^"]+)"/);

  if (!match) return [];
  const fields = match[1].split(',');
  if (!fields[0]) return [];

  return [{
    code,
    name: fields[0],
    market: code.startsWith('6') || code.startsWith('9') || code.startsWith('8') ? 'Shanghai' : 'Shenzhen',
    type: 'Stock'
  }];
}

// 按中文/英文名称模糊搜索（新浪 suggest3 API，GBK编码）
async function searchByName(name) {
  const url = `https://suggest3.sinajs.cn/suggest/type=11,12,13,14&key=${encodeURIComponent(name)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://finance.sina.com.cn/',
    }
  });

  if (!response.ok) return [];

  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder('gbk');
  const raw = decoder.decode(buffer);

  const match = raw.match(/="([^"]+)"/);
  if (!match) return [];

  const items = match[1].split(';');
  const results = [];

  for (const item of items) {
    if (!item.trim()) continue;
    const parts = item.split(',');
    // 格式: name,type,code,marketCode,name,...
    if (parts.length < 4) continue;
    const [n, , , marketCode] = parts;
    if (!n || !marketCode) continue;

    // 提取6位代码
    const pureCode = marketCode.replace(/^(sh|sz|bj)/i, '').trim();
    if (!/^\d{6}$/.test(pureCode)) continue;

    results.push({
      code: pureCode,
      name: n.trim(),
      market: marketCode.startsWith('sh') ? 'Shanghai' : marketCode.startsWith('sz') ? 'Shenzhen' : 'Beijing',
      type: 'Stock'
    });
  }

  return results.slice(0, 20);
}

export default router;
