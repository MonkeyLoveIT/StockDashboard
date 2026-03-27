import fetch from 'node-fetch';

// Sina Finance real-time quote API
// Returns comma-separated fields, GBK encoding

function parseSinaQuote(raw, code) {
  try {
    // raw format: "name,open,close,current,high,low,bid1,ask1,...,volume,amount,...,date,time,status"
    const fields = raw.split(',');
    if (fields.length < 32) return { error: 'Invalid data format', code };

    const name = fields[0];
    const open = parseFloat(fields[1]) || 0;
    const yesterdayClose = parseFloat(fields[2]) || 0;
    const current = parseFloat(fields[3]) || 0;
    const high = parseFloat(fields[4]) || 0;
    const low = parseFloat(fields[5]) || 0;
    const buy1 = parseFloat(fields[6]) || 0;
    const sell1 = parseFloat(fields[7]) || 0;
    const volume = parseInt(fields[8]) || 0;      // in 100 shares (手)
    const amount = parseFloat(fields[9]) || 0;    // in yuan
    const date = fields[30];
    const time = fields[31];

    const change = current - yesterdayClose;
    const changePct = yesterdayClose !== 0 ? (change / yesterdayClose * 100) : 0;

    //涨跌停上限（10%）
    const highLimit = yesterdayClose * 1.1;
    const lowLimit = yesterdayClose * 0.9;

    return {
      code,
      name,
      price: current,
      change,
      changePct,
      open,
      high,
      low,
      close: yesterdayClose,
      volume,
      amount,
      highLimit,
      lowLimit,
      date,
      time,
      todayOpen: open   // 今日开盘价（供Dashboard计算当日盈亏）
    };
  } catch (error) {
    return { error: error.message, code };
  }
}

export async function getQuote(code) {
  // Determine market prefix: sz=深圳, sh=上海
  let prefix = 'sh';
  if (code.startsWith('0') || code.startsWith('3') || code.startsWith('002') || code.startsWith('301')) {
    prefix = 'sz';
  } else if (code.startsWith('6') || code.startsWith('9') || code.startsWith('8')) {
    prefix = 'sh';
  }

  const url = `https://hq.sinajs.cn/list=${prefix}${code}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://finance.sina.com.cn/'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    // Sina returns GBK encoding
    // Use Response.arrayBuffer + manual decode, or use iconv-lite if available
    // Fallback: try to extract from raw buffer
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder('gbk');
    const raw = decoder.decode(buffer);

    // Extract quoted string: var hq_str_xxx="..."
    const match = raw.match(/"([^"]+)"/);
    if (!match) {
      return { error: 'No data found', code };
    }

    return parseSinaQuote(match[1], code);
  } catch (error) {
    console.error(`Error fetching quote for ${code}:`, error.message);
    return { error: error.message, code };
  }
}

// Get multiple quotes
export async function getQuotes(codes) {
  if (!codes || codes.length === 0) return [];

  // Sina supports batch: hq.sinajs.cn/list=sz300753,sh600000
  const batchCodes = codes.map(code => {
    if (code.startsWith('0') || code.startsWith('3') || code.startsWith('002') || code.startsWith('301')) {
      return `sz${code}`;
    }
    return `sh${code}`;
  }).join(',');

  const url = `https://hq.sinajs.cn/list=${batchCodes}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://finance.sina.com.cn/'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder('gbk');
    const raw = decoder.decode(buffer);

    // Parse all matches: var hq_str_xxx="..."
    const regex = /hq_str_[a-z]{2}(\d+)="([^"]+)"/g;
    const results = [];
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const code = match[1];
      const data = parseSinaQuote(match[2], code);
      results.push(data);
    }

    // If batch failed, fall back to individual calls
    if (results.length === 0) {
      return Promise.all(codes.map(code => getQuote(code)));
    }

    return results;
  } catch (error) {
    console.error('Batch quote fetch failed:', error.message);
    // Fallback to individual calls
    return Promise.all(codes.map(code => getQuote(code)));
  }
}
