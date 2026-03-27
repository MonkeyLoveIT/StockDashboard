import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// GET /api/market/overview
// Returns major index data for today's market summary
router.get('/overview', async (req, res) => {
  try {
    // Major A-share indices
    const secids = [
      '1.000001',  // 上证指数
      '0.399001',  // 深证成指
      '0.399006',  // 创业板指
      '1.000688',  // 科创50
      '1.000300',  // 沪深300
      '0.399005',  // 中小100
    ];

    const fields = 'f1,f2,f3,f4,f5,f6,f7,f12,f13,f14,f15,f16,f17,f18';
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${secids.join(',')}&ut=b2884a393a59ad64002292a3e90d46a5`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://finance.eastmoney.com/',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Connection': 'keep-alive'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.data?.diff) {
      return res.json({ indices: [], timestamp: new Date().toISOString() });
    }

    const indices = data.data.diff.map(item => ({
      code: item.f12,
      name: item.f14,
      price: item.f2,
      change: item.f3,
      changePct: item.f3,
      changeAmt: item.f4,
      volume: item.f5,       // 成交量（手）
      amount: item.f6,      // 成交额（元）
      open: item.f15,
      high: item.f17,
      low: item.f16,
      prevClose: item.f18,
      amplitude: item.f7,   // 振幅
    }));

    res.json({
      indices,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching market overview:', error.message);
    res.status(500).json({ error: 'Failed to fetch market overview: ' + error.message });
  }
});

export default router;
